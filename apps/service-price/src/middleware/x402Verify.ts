/**
 * Verify-only x402 gate. The most important file in this service.
 *
 * WHY THIS IS NOT THE STOCK MIDDLEWARE
 * ------------------------------------
 * @x402-avm/express ships paymentMiddlewareFromConfig, which runs
 * verify -> serve -> settle inside a single request. That is correct for a
 * normal paid API: one call, one payment, one settlement.
 *
 * AtomicAgent needs something different. Three services must each confirm that
 * a payment is VALID, but no money may move until ALL THREE have passed. So
 * this middleware calls verify() and stops there. Settlement happens once,
 * later, from the orchestrator, for the entire group.
 *
 * That split is native to the protocol, not a workaround: FacilitatorClient
 * declares verify() and settle() as two independent methods.
 *
 * WHAT THIS MIDDLEWARE GUARANTEES
 * -------------------------------
 * By the time a route runs, we know:
 *   - the X-PAYMENT header decoded and matched our schema
 *   - the payload is a well-formed ExactAvmPayloadV2
 *   - paymentIndex points at a real slot inside paymentGroup
 *   - the declared network and asset match what this service accepts
 *   - the facilitator simulated the group and found our payment valid
 * and crucially, that NO money has moved.
 */

import type { RequestHandler, Request } from 'express';
import {
  AppError,
  ERROR_CODE,
  PAYMENT_INDEX_BY_CHECK,
  paymentPayloadSchema,
  exactAvmPayloadSchema,
  type ExactAvmPayloadV2,
  type PaymentPayload,
  type VerifyResponse,
} from '@atomicagent/shared';
import type { Tier } from '@atomicagent/shared';
import { logger } from '../config/logger.js';
import { facilitatorClient } from '../config/x402.js';
import { buildAllTierRequirements } from '../config/x402.js';
import { buildTierRequirements } from '../config/x402.js';
import { tierForAmount } from '../config/x402.js';

/** The slot in the atomic group this service is paid from. Constant: 1. */
const OUR_PAYMENT_INDEX = PAYMENT_INDEX_BY_CHECK.price;

/** What the middleware attaches to the request for the route to use. */
export interface X402Context {
  payload: PaymentPayload;
  avmPayload: ExactAvmPayloadV2;
  verifyResponse: VerifyResponse;
  /** Address that signed the payment, when the facilitator reports it. */
  payer: string | undefined;
  /**
   * Which tier the client actually paid for.
   *
   * Derived from the amount, not from any label the client supplied. A client
   * that pays the shallow fee gets a shallow answer regardless of what it asks
   * for.
   */
  tier: Tier;
}

/**
 * Express Request with our verified payment context attached.
 * Declared as an interface rather than a global augmentation so the type stays
 * local to this service and cannot silently leak elsewhere.
 */
export interface PaidRequest extends Request {
  x402?: X402Context;
}

/**
 * Decodes the base64 X-PAYMENT header into an object.
 *
 * @param header - raw header value
 * @returns the decoded object
 * @throws AppError if the header is not valid base64 JSON
 */
function decodePaymentHeader(header: string): unknown {
  let json: string;
  try {
    json = Buffer.from(header, 'base64').toString('utf8');
  } catch {
    throw new AppError(
      ERROR_CODE.PAYMENT_INVALID,
      'X-PAYMENT header is not valid base64',
    );
  }

  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new AppError(
      ERROR_CODE.PAYMENT_INVALID,
      'X-PAYMENT header does not contain valid JSON',
    );
  }
}

/**
 * Builds the 402 response body.
 *
 * Advertises all three tiers. The `accepts` array is a list by design in x402;
 * a client picks whichever entry it is willing to pay for.
 *
 * @returns the JSON body for a 402 response
 */
function build402Body() {
  return {
    x402Version: 2,
    error: 'Payment required',
    accepts: buildAllTierRequirements(),
    // Not part of the x402 spec. Our own hint, so the orchestrator can build
    // the group without hardcoding slot numbers in three separate places.
    atomicAgent: {
      paymentIndex: OUR_PAYMENT_INDEX,
      checkId: 'price' as const,
      tiered: true,
    },
  };
}

/**
 * The verify-only x402 gate.
 *
 * @returns an express middleware
 */
export function x402VerifyOnly(): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const header = req.header('X-PAYMENT');

      // ---- No payment attached: this is the normal 402 path, not an error ----
      if (!header) {
        logger.info({ path: req.path }, 'no payment attached, returning 402');
        res.status(402).json(build402Body());
        return;
      }

      // ---- 1. Decode and shape-check the header ----
      const decoded = decodePaymentHeader(header);
      const parsed = paymentPayloadSchema.safeParse(decoded);

      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new AppError(
          ERROR_CODE.PAYMENT_INVALID,
          'X-PAYMENT header failed validation',
          { detail },
        );
      }

      const payload = parsed.data as PaymentPayload;

      // ---- 2. Validate the AVM-specific payload ----
      const avmParsed = exactAvmPayloadSchema.safeParse(payload.payload);

      if (!avmParsed.success) {
        const detail = avmParsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new AppError(ERROR_CODE.GROUP_MALFORMED, 'Malformed payment group', {
          detail,
        });
      }

      const avmPayload: ExactAvmPayloadV2 = avmParsed.data;

      // ---- 3. The payment must be in OUR slot ----
      // Without this, a client could point every service at the same cheap
      // transaction and pay once for three checks.
      if (avmPayload.paymentIndex !== OUR_PAYMENT_INDEX) {
        throw new AppError(
          ERROR_CODE.PAYMENT_INDEX_OUT_OF_RANGE,
          'Payment is not in the slot this service is paid from',
          {
            detail: `expected paymentIndex ${OUR_PAYMENT_INDEX}, received ${avmPayload.paymentIndex}`,
          },
        );
      }

      // ---- 4. Which tier did they pay for? ----
      //
      // Determined by the amount, never by a label. A client paying the
      // shallow fee gets a shallow answer whatever it claims to want.
      const tier = tierForAmount(payload.accepted.amount);

      if (tier === null) {
        throw new AppError(
          ERROR_CODE.PAYMENT_INVALID,
          'Payment amount does not match any offered tier',
          { detail: 'offered ' + payload.accepted.amount },
        );
      }

      const requirements = buildTierRequirements(tier);

      if (payload.accepted.network !== requirements.network) {
        throw new AppError(
          ERROR_CODE.PAYMENT_INVALID,
          'Payment declares a different network than this service accepts',
          {
            detail: `expected ${requirements.network}, received ${payload.accepted.network}`,
          },
        );
      }

      if (payload.accepted.asset !== requirements.asset) {
        throw new AppError(
          ERROR_CODE.PAYMENT_INVALID,
          'Payment declares a different asset than this service accepts',
          {
            detail: `expected asset ${requirements.asset}, received ${payload.accepted.asset}`,
          },
        );
      }

      if (payload.accepted.payTo !== requirements.payTo) {
        throw new AppError(
          ERROR_CODE.PAYMENT_INVALID,
          'Payment is addressed to a different account',
          { detail: 'payTo does not match this service' },
        );
      }

      if (BigInt(payload.accepted.amount) < BigInt(requirements.amount)) {
        throw new AppError(
          ERROR_CODE.PAYMENT_INVALID,
          'Payment amount is below this service fee',
          {
            detail: `required ${requirements.amount}, offered ${payload.accepted.amount}`,
          },
        );
      }

      // ---- 5. Ask the facilitator to verify. Still no money moves. ----
      logger.info(
        {
          groupSize: avmPayload.paymentGroup.length,
          paymentIndex: avmPayload.paymentIndex,
        },
        'verifying payment with facilitator',
      );

      let verifyResponse: VerifyResponse;
      try {
        verifyResponse = (await facilitatorClient.verify(
          payload as never,
          requirements as never,
        )) as VerifyResponse;
      } catch (cause) {
        throw new AppError(
          ERROR_CODE.UPSTREAM_UNAVAILABLE,
          'Could not reach the payment facilitator',
          {
            detail: cause instanceof Error ? cause.message : 'unknown error',
            cause,
          },
        );
      }

      if (!verifyResponse.isValid) {
        logger.warn(
          { reason: verifyResponse.invalidReason },
          'facilitator rejected payment',
        );
        throw new AppError(ERROR_CODE.PAYMENT_INVALID, 'Payment was not valid', {
          detail:
            verifyResponse.invalidMessage ??
            verifyResponse.invalidReason ??
            'facilitator did not accept the payment',
        });
      }

      logger.info({ payer: verifyResponse.payer }, 'payment verified, not settled');

      // ---- 6. Hand control to the route ----
      (req as PaidRequest).x402 = {
        payload,
        avmPayload,
        verifyResponse,
        payer: verifyResponse.payer,
        tier,
      };

      next();
    })().catch(next);
  };
}

/**
 * Reads the verified payment context from a request.
 *
 * Throws rather than returning undefined: if a route reaches this call without
 * a context, the middleware was not applied, and that is a wiring bug we want
 * to hear about loudly.
 *
 * @param req - the express request
 * @returns the verified payment context
 */
export function requirePaymentContext(req: Request): X402Context {
  const context = (req as PaidRequest).x402;
  if (!context) {
    throw new AppError(
      ERROR_CODE.INTERNAL,
      'Route ran without a verified payment context',
    );
  }
  return context;
}