/**
 * The verify fan-out. Where one signed group satisfies three services.
 *
 * THE MECHANISM
 * -------------
 * All three services receive an IDENTICAL paymentGroup array and differ only
 * in paymentIndex:
 *
 *     price        -> paymentIndex 1
 *     availability -> paymentIndex 2
 *     verification -> paymentIndex 3
 *
 * Each service asks the facilitator to verify ITS slot against ITS own
 * requirements. All three pass, because all three payments genuinely exist in
 * the group. This is not a workaround: the AVM spec defines ExactAvmPayloadV2
 * as { paymentGroup: string[]; paymentIndex: number } precisely so a group can
 * carry more than one payment.
 *
 * WHAT DOES NOT HAPPEN HERE
 * -------------------------
 * No money moves. Every service calls facilitator.verify() and stops. The
 * facilitator simulates the group on chain and reports whether it would
 * succeed. Settlement is a separate, later, single call from settler.ts.
 *
 * FAILURE IS THE DEFAULT
 * ----------------------
 * A timeout, an unreachable service, a malformed response, or a missing
 * verdict all count as FAILURE. Silence is never read as consent to spend
 * money. Only an explicit pass from all three opens the settle gate.
 */

import { AppError } from '@atomicagent/shared';
import { ERROR_CODE } from '@atomicagent/shared';
import { PAYMENT_INDEX_BY_CHECK } from '@atomicagent/shared';
import { X402_VERSION } from '@atomicagent/shared';
import type { CheckId } from '@atomicagent/shared';
import type { CheckQuote } from '@atomicagent/shared';
import type { CheckVerdict } from '@atomicagent/shared';
import type { Caip2Network } from '@atomicagent/shared';
import type { PaymentPayload } from '@atomicagent/shared';
import type { SourcingRequest } from '@atomicagent/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { requestVerification } from '../clients/serviceClient.js';
import { buildCheckBody } from './quoteCollector.js';

/** Result of verifying one check, including failures. */
export interface VerifyOutcome {
  checkId: CheckId;
  verdict: CheckVerdict | null;
  /** Set when the call itself failed rather than the check returning false. */
  error: string | null;
}

/** Everything the fan-out needs. */
export interface VerifyInput {
  runId: string;
  request: SourcingRequest;
  quotes: CheckQuote[];
  /** The signed group, base64, in slot order. Identical for all three calls. */
  signedGroup: string[];
}

/**
 * Builds the X-PAYMENT header for one service.
 *
 * The paymentGroup is the SAME array for every service. Only paymentIndex and
 * the accepted requirements change. That single difference is what lets one
 * signature pay three independent parties.
 *
 * @param checkId - which service this header is for
 * @param quote - that service's quote
 * @param signedGroup - the full signed group
 * @returns base64 X-PAYMENT header value
 */
function buildPaymentHeader(
  checkId: CheckId,
  quote: CheckQuote,
  signedGroup: string[],
): string {
  const paymentIndex = PAYMENT_INDEX_BY_CHECK[checkId];

  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    accepted: {
      scheme: 'exact',
      network: env.network as Caip2Network,
      asset: quote.asset,
      amount: quote.feeAtomic,
      payTo: quote.payTo,
      maxTimeoutSeconds: quote.maxTimeoutSeconds,
      extra: {
        decimals: env.asset.decimals,
        name: env.asset.symbol,
      },
    },
    payload: {
      paymentGroup: signedGroup,
      paymentIndex,
    },
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/**
 * Reads a service's response into a verdict.
 *
 * @param checkId - which check responded
 * @param status - HTTP status
 * @param body - parsed body
 * @returns the verdict
 * @throws AppError if the response cannot be read as a verdict
 */
function parseVerdict(
  checkId: CheckId,
  status: number,
  body: unknown,
): CheckVerdict {
  // A 402 here means the facilitator rejected the payment. That is a payment
  // problem, not a business-rule failure, and deserves a different message.
  if (status === 402) {
    const errorBody = body as { message?: string; detail?: string };
    throw new AppError(
      ERROR_CODE.PAYMENT_INVALID,
      'The ' + checkId + ' service rejected the payment',
      { detail: errorBody.detail ?? errorBody.message ?? 'payment not accepted' },
    );
  }

  if (status !== 200) {
    const errorBody = body as { message?: string; code?: string };
    throw new AppError(
      ERROR_CODE.UPSTREAM_UNAVAILABLE,
      'The ' + checkId + ' service returned HTTP ' + String(status),
      { detail: errorBody.message ?? 'unexpected status' },
    );
  }

  const envelope = body as { ok?: boolean; data?: unknown };

  if (envelope.ok !== true || !envelope.data) {
    throw new AppError(
      ERROR_CODE.UPSTREAM_UNAVAILABLE,
      'The ' + checkId + ' service returned an unexpected body',
    );
  }

  const data = envelope.data as Partial<CheckVerdict>;

  if (
    data.checkId !== checkId ||
    typeof data.passed !== 'boolean' ||
    typeof data.reason !== 'string' ||
    typeof data.detailHash !== 'string'
  ) {
    throw new AppError(
      ERROR_CODE.UPSTREAM_UNAVAILABLE,
      'The ' + checkId + ' service returned a malformed verdict',
    );
  }

  return {
    checkId,
    passed: data.passed,
    reason: data.reason,
    detailHash: data.detailHash,
  };
}

/**
 * Verifies one check.
 *
 * Never throws. A thrown error would abort Promise.all and lose the verdicts
 * from services that did answer, and the UI needs to show which specific check
 * failed. Errors are captured into the outcome instead.
 *
 * @param checkId - which check to run
 * @param input - the run, request, quotes and signed group
 * @returns the outcome, whether it succeeded or not
 */
async function verifyOne(
  checkId: CheckId,
  input: VerifyInput,
): Promise<VerifyOutcome> {
  const quote = input.quotes.find((entry) => entry.checkId === checkId);

  if (!quote) {
    return {
      checkId,
      verdict: null,
      error: 'No quote on file for this check',
    };
  }

  try {
    const header = buildPaymentHeader(checkId, quote, input.signedGroup);
    const body = buildCheckBody(checkId, input.request);

    const response = await requestVerification(checkId, body, header);
    const verdict = parseVerdict(checkId, response.status, response.body);

    logger.info(
      { runId: input.runId, checkId, passed: verdict.passed },
      'check verified',
    );

    return { checkId, verdict, error: null };
  } catch (cause) {
    const message =
      cause instanceof AppError
        ? cause.message + (cause.detail ? ' (' + cause.detail + ')' : '')
        : cause instanceof Error
          ? cause.message
          : 'unknown error';

    logger.warn({ runId: input.runId, checkId, error: message }, 'check failed');

    return { checkId, verdict: null, error: message };
  }
}

/** What the fan-out returns. */
export interface VerifyFanOutResult {
  verdicts: CheckVerdict[];
  outcomes: VerifyOutcome[];
  allPassed: boolean;
  failedChecks: CheckId[];
  /** Human-readable summary of why the run cannot settle, if it cannot. */
  failureSummary: string | null;
}

/**
 * Runs all three checks in parallel against the same signed group.
 *
 * @param input - the run, request, quotes and signed group
 * @returns verdicts, and whether the settle gate may open
 */
export async function verifyAll(
  input: VerifyInput,
): Promise<VerifyFanOutResult> {
  const startedAt = Date.now();

  logger.info(
    { runId: input.runId, groupSize: input.signedGroup.length },
    'verifying all three checks against one signed group',
  );

  const outcomes = await Promise.all([
    verifyOne('price', input),
    verifyOne('availability', input),
    verifyOne('verification', input),
  ]);

  const verdicts: CheckVerdict[] = [];
  const failedChecks: CheckId[] = [];
  const failureReasons: string[] = [];

  for (const outcome of outcomes) {
    if (outcome.verdict) {
      verdicts.push(outcome.verdict);

      if (!outcome.verdict.passed) {
        failedChecks.push(outcome.checkId);
        failureReasons.push(outcome.checkId + ': ' + outcome.verdict.reason);
      }
    } else {
      // No verdict at all. Counts as a failure, never as an unknown to be
      // resolved optimistically.
      failedChecks.push(outcome.checkId);
      failureReasons.push(
        outcome.checkId + ': ' + (outcome.error ?? 'no response'),
      );
    }
  }

  const allPassed = failedChecks.length === 0 && verdicts.length === 3;

  logger.info(
    {
      runId: input.runId,
      ms: Date.now() - startedAt,
      allPassed,
      failedChecks,
    },
    allPassed ? 'all checks passed, settlement may proceed' : 'checks failed, settlement blocked',
  );

  return {
    verdicts,
    outcomes,
    allPassed,
    failedChecks,
    failureSummary: allPassed ? null : failureReasons.join('; '),
  };
}