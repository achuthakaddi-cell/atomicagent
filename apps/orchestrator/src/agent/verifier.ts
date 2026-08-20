/**
 * The verify fan-out, tier-aware.
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
 * TIERS
 * -----
 * Each service is paid at whichever tier the agent chose for it this round.
 * A service determines the tier from the amount received, never from a label,
 * so the agent cannot ask for a deep answer at a shallow price.
 *
 * FAILURE IS THE DEFAULT
 * ----------------------
 * A timeout, an unreachable service, a malformed response, or a missing
 * verdict all count as FAILURE. Silence is never read as consent to spend
 * money.
 */

import { AppError } from '@atomicagent/shared';
import { ERROR_CODE } from '@atomicagent/shared';
import { PAYMENT_INDEX_BY_CHECK } from '@atomicagent/shared';
import { X402_VERSION } from '@atomicagent/shared';
import { TIER_SPECS } from '@atomicagent/shared';
import type { CheckId } from '@atomicagent/shared';
import type { Caip2Network } from '@atomicagent/shared';
import type { DiscoveredService } from '@atomicagent/shared';
import type { PaymentPayload } from '@atomicagent/shared';
import type { SourcingRequest } from '@atomicagent/shared';
import type { Tier } from '@atomicagent/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { requestVerification } from '../clients/serviceClient.js';
import { buildCheckBody } from './quoteCollector.js';
import type { TieredVerdict } from './spendPlanner.js';

/** Result of verifying one check, including failures. */
export interface VerifyOutcome {
  checkId: CheckId;
  verdict: TieredVerdict | null;
  /** Set when the call itself failed rather than the check returning a verdict. */
  error: string | null;
}

/** Everything the fan-out needs. */
export interface VerifyInput {
  runId: string;
  request: SourcingRequest;
  /** Which tier each check is being paid for this round. */
  tiers: Record<CheckId, Tier>;
  /** Where each service is paid. */
  payTo: Record<CheckId, string>;
  /** The signed group, base64, in slot order. Identical for all three calls. */
  signedGroup: string[];
    /**
   * Services registered at runtime from their own 402 challenges.
   *
   * Each is verified alongside the built-in three, using the slot it was
   * assigned at registration. A refusal from any of them blocks settlement
   * exactly like a built-in check, which is what makes the registration real
   * rather than decorative.
   */
    externalServices?: DiscoveredService[];
}

/**
 * Builds the X-PAYMENT header for one service.
 *
 * The paymentGroup is the SAME array for every service. Only paymentIndex and
 * the accepted requirements change. That single difference is what lets one
 * signature pay three independent parties at three different price points.
 *
 * @param checkId - which service this header is for
 * @param tier - the tier being paid for
 * @param payTo - that service's payee address
 * @param signedGroup - the full signed group
 * @returns base64 X-PAYMENT header value
 */
function buildPaymentHeader(
  checkId: CheckId,
  tier: Tier,
  payTo: string,
  signedGroup: string[],
): string {
  const paymentIndex = PAYMENT_INDEX_BY_CHECK[checkId];
  const spec = TIER_SPECS[tier];

  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    accepted: {
      scheme: 'exact',
      network: env.network as Caip2Network,
      asset: env.asset.id,
      amount: spec.feeAtomic,
      payTo,
      maxTimeoutSeconds: 120,
      extra: {
        decimals: env.asset.decimals,
        name: env.asset.symbol,
        tier: spec.tier,
        method: spec.method,
        confidence: spec.confidence,
        latencyMs: spec.latencyMs,
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
): TieredVerdict {
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
    const errorBody = body as { message?: string };
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

  const data = envelope.data as Partial<TieredVerdict>;

  if (
    data.checkId !== checkId ||
    typeof data.confidence !== 'string' ||
    typeof data.certainty !== 'number' ||
    typeof data.reason !== 'string' ||
    typeof data.detailHash !== 'string' ||
    typeof data.tier !== 'string'
  ) {
    throw new AppError(
      ERROR_CODE.UPSTREAM_UNAVAILABLE,
      'The ' + checkId + ' service returned a malformed verdict',
    );
  }

  return {
    checkId,
    tier: data.tier as Tier,
    confidence: data.confidence as TieredVerdict['confidence'],
    certainty: data.certainty,
    passed: data.confidence === 'confirmed',
    reason: data.reason,
    wouldResolve: data.wouldResolve ?? null,
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
 * @param input - the run, request, tiers and signed group
 * @returns the outcome, whether it succeeded or not
 */
async function verifyOne(
  checkId: CheckId,
  input: VerifyInput,
): Promise<VerifyOutcome> {
  const tier = input.tiers[checkId];
  const payTo = input.payTo[checkId];

  if (!tier || !payTo) {
    return {
      checkId,
      verdict: null,
      error: 'No tier or payee on file for this check',
    };
  }

  try {
    const header = buildPaymentHeader(checkId, tier, payTo, input.signedGroup);
    const body = buildCheckBody(checkId, input.request);

    const response = await requestVerification(checkId, body, header);
    const verdict = parseVerdict(checkId, response.status, response.body);

    logger.info(
      {
        runId: input.runId,
        checkId,
        tier: verdict.tier,
        confidence: verdict.confidence,
        certainty: verdict.certainty,
      },
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
  verdicts: TieredVerdict[];
  outcomes: VerifyOutcome[];
  /** True only when all three returned an explicit confirmed answer. */
  allConfirmed: boolean;
  /** Checks that did not confirm, whether refuted, ambiguous or absent. */
  unresolved: CheckId[];
  /** Human-readable summary of why the run cannot settle yet. */
  summary: string | null;
}

/**
 * Runs all three checks in parallel against the same signed group.
 *
 * @param input - the run, request, tiers and signed group
 * @returns verdicts and whether settlement may proceed
 */
export async function verifyAll(
  input: VerifyInput,
): Promise<VerifyFanOutResult> {
  const startedAt = Date.now();

  logger.info(
    {
      runId: input.runId,
      groupSize: input.signedGroup.length,
      tiers: input.tiers,
    },
    'verifying all three checks against one signed group',
  );

  const outcomes = await Promise.all([
    verifyOne('price', input),
    verifyOne('availability', input),
    verifyOne('verification', input),
  ]);

  const verdicts: TieredVerdict[] = [];
  const unresolved: CheckId[] = [];
  const reasons: string[] = [];

  for (const outcome of outcomes) {
    if (outcome.verdict) {
      verdicts.push(outcome.verdict);

      if (outcome.verdict.confidence !== 'confirmed') {
        unresolved.push(outcome.checkId);
        reasons.push(outcome.checkId + ': ' + outcome.verdict.reason);
      }
    } else {
      // No verdict at all. Counts as unresolved, never as an unknown to be
      // resolved optimistically.
      unresolved.push(outcome.checkId);
      reasons.push(outcome.checkId + ': ' + (outcome.error ?? 'no response'));
    }
  }

  const allConfirmed = unresolved.length === 0 && verdicts.length === 3;

  logger.info(
    {
      runId: input.runId,
      ms: Date.now() - startedAt,
      allConfirmed,
      unresolved,
    },
    allConfirmed
      ? 'all checks confirmed, settlement may proceed'
      : 'checks unresolved, settlement blocked',
  );
  

  return {
    verdicts,
    outcomes,
    allConfirmed,
    unresolved,
    summary: allConfirmed ? null : reasons.join('; '),
  };
}
/**
 * Verifies one externally registered service.
 *
 * Everything needed to build its payment header came out of that service's own
 * 402 challenge: the amount, the payee, the asset, the network. Nothing here is
 * specific to any provider, which is the claim the whole feature exists to make.
 *
 * The request body is an empty object. A generic caller cannot know what fields
 * a particular service wants, and pretending otherwise would make the claim
 * false. A service requiring specific input will say so, and that is a fair
 * limitation to state plainly.
 *
 * @param service - the discovered service
 * @param signedGroup - the signed group, identical for every call
 * @param runId - for logging
 * @returns the outcome, whether it succeeded or not
 */
async function verifyExternal(
  service: DiscoveredService,
  signedGroup: string[],
  runId: string,
): Promise<VerifyOutcome> {
  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    accepted: {
      scheme: service.chosen.scheme,
      network: service.chosen.network as Caip2Network,
      asset: service.chosen.asset,
      amount: service.chosen.amount,
      payTo: service.chosen.payTo,
      maxTimeoutSeconds: service.chosen.maxTimeoutSeconds,
      extra: service.chosen.extra ?? {},
    },
    payload: {
      paymentGroup: signedGroup,
      paymentIndex: service.paymentIndex,
    },
  };

  const header = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(service.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': header,
      },
      body: '{}',
      signal: controller.signal,
    });

    const text = await response.text();

    // A 200 means the service accepted the payment and served its resource.
    // Anything else is a refusal, and a refusal blocks the group.
    if (response.status !== 200) {
      let detail = text.slice(0, 200);

      try {
        const body = JSON.parse(text) as { message?: string; error?: string };
        detail = body.message ?? body.error ?? detail;
      } catch {
        // Not JSON. Use the raw text, truncated.
      }

      logger.warn(
        { runId, url: service.url, status: response.status, detail },
        'external service refused',
      );

      return {
        checkId: service.id as CheckId,
        verdict: null,
        error:
          'returned HTTP ' + String(response.status) +
          (detail ? ': ' + detail : ''),
      };
    }

    logger.info(
      { runId, url: service.url, slot: service.paymentIndex },
      'external service verified its own slot',
    );

    return {
      checkId: service.id as CheckId,
      verdict: {
        checkId: service.id as CheckId,
        tier: 'standard',
        confidence: 'confirmed',
        certainty: 1,
        passed: true,
        reason:
          'Externally registered service accepted payment at slot ' +
          String(service.paymentIndex) + ' and served its resource.',
        wouldResolve: null,
        detailHash: '',
      },
      error: null,
    };
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';

    const message = aborted
      ? 'did not respond within 25 seconds'
      : cause instanceof Error
        ? cause.message
        : 'unknown error';

    logger.warn({ runId, url: service.url, error: message }, 'external service failed');

    return {
      checkId: service.id as CheckId,
      verdict: null,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifies every registered external service in parallel.
 *
 * @param input - the run, signed group and registered services
 * @returns outcomes, one per service
 */
export async function verifyExternalServices(
  input: VerifyInput,
): Promise<VerifyOutcome[]> {
  const services = input.externalServices ?? [];

  if (services.length === 0) return [];

  logger.info(
    { runId: input.runId, count: services.length },
    'verifying externally registered services',
  );

  return Promise.all(
    services.map((service) =>
      verifyExternal(service, input.signedGroup, input.runId),
    ),
  );
}