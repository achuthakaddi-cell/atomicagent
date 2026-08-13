/**
 * Verify-only x402 gate.
 *
 * Identical in structure to the other two services, with ONE critical
 * difference: OUR_PAYMENT_INDEX is 3. This service is paid from slot 3 of the
 * shared atomic group and will reject a payment pointed at any other slot.
 *
 * WHY THIS IS NOT THE STOCK MIDDLEWARE
 * ------------------------------------
 * @x402-avm/express ships paymentMiddlewareFromConfig, which runs
 * verify -> serve -> settle inside a single request. AtomicAgent needs the
 * three services to confirm a payment is VALID without any money moving, so
 * this middleware calls verify() and stops. Settlement happens once, later,
 * from the orchestrator, for the entire group.
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
import { logger } from '../config/logger.js';
import { facilitatorClient, buildPaymentRequirements } from '../config/x402.js';

/** The slot in the atomic group this service is paid from. Constant: 3. */
const OUR_PAYMENT_INDEX = PAYMENT_INDEX_BY_CHECK.verification;

/** What the middleware attaches to the request for the route to use. */
export interface X402Context {
  payload: PaymentPayload;
  avmPayload: ExactAvmPayloadV2;
  verifyResponse: VerifyResponse;
  /** Address that signed the payment, when the facilitator reports it. */
  payer: string | undefined;
}

/** Express Request with our verified payment context attached. */
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
 * @returns the JSON body for a 402 response
 */
function build402Body() {
  return {
    x402Version: 2,
    error: 'Payment required',
    accepts: [buildPaymentRequirements()],
    // Not part of the x402 spec. Our own hint, so the orchestrator can build
    // the group without hardcoding slot numbers in three separate places.
    atomicAgent: {
      paymentIndex: OUR_PAYMENT_INDEX,
      checkId: 'verification' as const,
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

      // ---- 4. Network and asset must match what we accept ----
      const requirements = buildPaymentRequirements();

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