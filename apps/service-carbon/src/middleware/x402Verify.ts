/**
 * x402 payment gate — SLOT-AGNOSTIC.
 *
 * THE ONE THING THAT MATTERS IN THIS FILE
 * ---------------------------------------
 * AtomicAgent's own three services each pin themselves to a fixed slot:
 *
 *     const OUR_PAYMENT_INDEX = PAYMENT_INDEX_BY_CHECK.price;   // always 1
 *
 * ...and reject a payment pointed anywhere else. That is correct for them: they
 * were designed as parts of a known group and the pin prevents a client paying
 * once and claiming three answers.
 *
 * This service has no such pin. It reads whichever `paymentIndex` the client
 * declares and verifies the transaction at that position. It cannot pin itself,
 * because it does not know what group it is in — it does not know AtomicAgent
 * exists.
 *
 * That is exactly how the AVM exact scheme is specified to work. The payload is
 * `{ paymentGroup: string[]; paymentIndex: number }`, the CLIENT chooses the
 * index, and the server verifies the slot it is pointed at against its own
 * requirements. Nothing else in the group concerns it.
 *
 * WHAT STILL PROTECTS THIS SERVICE
 * --------------------------------
 * Dropping the slot pin is not the same as dropping the checks. This service
 * still verifies that the payment is on its network, in its asset, for its
 * amount, addressed to its account — and then asks the facilitator to confirm
 * the signature genuinely commits those funds. A client pointing it at a slot
 * paying someone else fails at the payee check, and one pointing it at a
 * cheaper transaction fails on the amount.
 *
 * The slot pin buys AtomicAgent's own services one extra guarantee that a
 * general-purpose service cannot have and does not need.
 */

import type { RequestHandler, Request } from 'express';
import {
  AppError,
  ERROR_CODE,
  paymentPayloadSchema,
  exactAvmPayloadSchema,
  type ExactAvmPayloadV2,
  type PaymentPayload,
  type VerifyResponse,
} from '@atomicagent/shared';
import { logger } from '../config/logger.js';
import { facilitatorClient, buildPaymentRequirements } from '../config/x402.js';

/** What the middleware attaches to the request. */
export interface X402Context {
  payload: PaymentPayload;
  avmPayload: ExactAvmPayloadV2;
  verifyResponse: VerifyResponse;
  payer: string | undefined;
  /** Which slot the client asked us to verify. Read, never assumed. */
  paymentIndex: number;
}

/** Express Request with our verified payment context attached. */
export interface PaidRequest extends Request {
  x402?: X402Context;
}

/**
 * Decodes the base64 X-PAYMENT header.
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
 * One payment option, and a description for the Bazaar catalogue. No hint about
 * which slot to use, because this service has no opinion about that.
 *
 * @returns the JSON body for a 402 response
 */
function build402Body() {
  return {
    x402Version: 2,
    error: 'Payment required',
    accepts: [buildPaymentRequirements()],
    description:
      'Estimates the carbon footprint of a shipment from origin, destination, ' +
      'weight and transport mode. Returns kilograms of CO2 equivalent, the ' +
      'emissions factor applied, and whether the figure falls within EU CBAM ' +
      'reporting thresholds.',
  };
}

/**
 * The payment gate.
 *
 * @returns an express middleware
 */
export function x402Verify(): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const header = req.header('X-PAYMENT');

      // ---- No payment: return the terms. This is the normal path. ----
      if (!header) {
        logger.info({ path: req.path }, 'no payment attached, returning 402');
        res.status(402).json(build402Body());
        return;
      }

      // ---- 1. Decode and shape-check ----
      const decoded = decodePaymentHeader(header);
      const parsed = paymentPayloadSchema.safeParse(decoded);

      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((issue) => issue.path.join('.') + ': ' + issue.message)
          .join('; ');

        throw new AppError(
          ERROR_CODE.PAYMENT_INVALID,
          'X-PAYMENT header failed validation',
          { detail },
        );
      }

      const payload = parsed.data as PaymentPayload;

      // ---- 2. Validate the AVM payload ----
      const avmParsed = exactAvmPayloadSchema.safeParse(payload.payload);

      if (!avmParsed.success) {
        const detail = avmParsed.error.issues
          .map((issue) => issue.path.join('.') + ': ' + issue.message)
          .join('; ');

        throw new AppError(ERROR_CODE.GROUP_MALFORMED, 'Malformed payment group', {
          detail,
        });
      }

      const avmPayload: ExactAvmPayloadV2 = avmParsed.data;

      // ---- 3. The index must be within the group ----
      //
      // The ONLY thing checked about the index. Which slot it is does not
      // matter; that it exists does.
      if (
        avmPayload.paymentIndex < 0 ||
        avmPayload.paymentIndex >= avmPayload.paymentGroup.length
      ) {
        throw new AppError(
          ERROR_CODE.PAYMENT_INDEX_OUT_OF_RANGE,
          'Payment index is outside the group',
          {
            detail:
              'index ' + String(avmPayload.paymentIndex) + ' in a group of ' +
              String(avmPayload.paymentGroup.length),
          },
        );
      }

      // ---- 4. Terms must match ours ----
      const requirements = buildPaymentRequirements();

      if (payload.accepted.network !== requirements.network) {
        throw new AppError(
          ERROR_CODE.PAYMENT_INVALID,
          'Payment is on a different network than this service accepts',
          {
            detail:
              'expected ' + requirements.network + ', received ' +
              payload.accepted.network,
          },
        );
      }

      if (payload.accepted.asset !== requirements.asset) {
        throw new AppError(
          ERROR_CODE.PAYMENT_INVALID,
          'Payment is in a different asset than this service accepts',
          {
            detail:
              'expected asset ' + requirements.asset + ', received ' +
              payload.accepted.asset,
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
          'Payment is less than this service charges',
          {
            detail:
              'expected ' + requirements.amount + ', offered ' +
              payload.accepted.amount,
          },
        );
      }

      // ---- 5. Ask the facilitator to verify ----
      logger.info(
        {
          groupSize: avmPayload.paymentGroup.length,
          paymentIndex: avmPayload.paymentIndex,
        },
        'verifying payment at the slot the client declared',
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

      logger.info(
        {
          payer: verifyResponse.payer,
          paymentIndex: avmPayload.paymentIndex,
          groupSize: avmPayload.paymentGroup.length,
        },
        'payment verified — this service was paid from a slot it did not choose',
      );

      (req as PaidRequest).x402 = {
        payload,
        avmPayload,
        verifyResponse,
        payer: verifyResponse.payer,
        paymentIndex: avmPayload.paymentIndex,
      };

      next();
    })().catch(next);
  };
}

/**
 * Reads the verified payment context from a request.
 *
 * Throws rather than returning undefined: reaching a route without a context
 * means the middleware was not applied, and that is a wiring bug worth hearing
 * about loudly.
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