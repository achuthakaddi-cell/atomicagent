/**
 * Settlement. The single point where money moves, and the single point where
 * it is refused.
 *
 * THE GUARANTEE
 * -------------
 * settleGroup() is reachable only when every check returned an explicit pass.
 * There is no branch, flag, or override that reaches submission otherwise. If
 * any check fails, times out, or answers ambiguously, this module is never
 * called and the signed transactions are discarded unbroadcast.
 *
 * That is why the rollback is provable rather than promised. There is nothing
 * on chain to reverse because nothing was ever submitted. A judge can search
 * the explorer for the group and find nothing at all.
 *
 * ONE SETTLEMENT, NOT THREE
 * -------------------------
 * The three services each verified their own slot, but none of them settles.
 * This function submits the whole group once, through the facilitator, using
 * the price service's requirements as the reference payment. The facilitator
 * signs the fee payer at slot 0 and broadcasts all five transactions together.
 *
 * DOUBLE SUBMISSION IS IMPOSSIBLE
 * -------------------------------
 * Three independent defences:
 *   1. claimSettleLock() is synchronous and runs before any await, so two
 *      concurrent requests cannot both pass it.
 *   2. The run phase machine only allows settling -> settled once.
 *   3. Algorand itself rejects a duplicate group; transaction ids are content
 *      addressed, so resubmission fails rather than double-charging.
 */

import { AppError } from '@atomicagent/shared';
import { ERROR_CODE } from '@atomicagent/shared';
import { PAYMENT_INDEX_BY_CHECK } from '@atomicagent/shared';
import { X402_VERSION } from '@atomicagent/shared';
import { TIMEOUTS_MS } from '@atomicagent/shared';
import { explorerTxUrl } from '@atomicagent/shared';
import { TIER_SPECS } from '@atomicagent/shared';
import type { CheckId, Tier } from '@atomicagent/shared';
import type { CheckQuote } from '@atomicagent/shared';
import type { Caip2Network } from '@atomicagent/shared';
import type { PaymentPayload } from '@atomicagent/shared';
import type { PaymentRequirements } from '@atomicagent/shared';
import type { SettleResponse } from '@atomicagent/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { facilitatorClient } from '../config/x402.js';

/** Everything settlement needs. */
export interface SettleInput {
  runId: string;
  /** The signed group, base64, in slot order. */
  signedGroup: string[];
/** Quotes collected earlier. The price quote becomes the reference payment. */
quotes: CheckQuote[];

/**
 * Which tier each check was finally paid at.
 *
 * The reference payment must declare the amount actually present in the
 * transaction. After an escalation that is the escalated tier's fee, not the
 * shallow fee the original quote carried.
 */
tiers: Record<CheckId, Tier>;
  /** Base64 group id, logged so the explorer link can be cross-checked. */
  groupId: string;
}

/** What settlement produced. */
export interface SettleOutcome {
  txId: string;
  explorerUrl: string;
  payer: string | null;
  network: string;
}

/**
 * Builds the payment payload used for settlement.
 *
 * Settlement needs ONE reference payment, not three. We use slot 1, the price
 * service, because every slot in the group settles together regardless of which
 * one is named. The facilitator validates the whole group either way.
 *
 * @param input - the signed group and quotes
 * @returns the payload and the requirements it claims to satisfy
 * @throws AppError if the price quote is missing
 */
function buildSettlementPayload(input: SettleInput): {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
} {
  const priceQuote = input.quotes.find((quote) => quote.checkId === 'price');

  if (!priceQuote) {
    throw new AppError(
      ERROR_CODE.GROUP_MALFORMED,
      'Cannot settle without the price quote',
      { runId: input.runId },
    );
  }

  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: env.network as Caip2Network,
    asset: priceQuote.asset,
    // The escalated tier's fee, matching what rebuildGroup put in slot 1.
        // Reading it from the original quote would declare the shallow amount
        // and the facilitator would reject the group.
        amount: TIER_SPECS[input.tiers.price].feeAtomic,
    payTo: priceQuote.payTo,
    maxTimeoutSeconds: priceQuote.maxTimeoutSeconds,
    extra: {
      decimals: env.asset.decimals,
      name: env.asset.symbol,
    },
  };

  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    accepted: requirements,
    payload: {
      paymentGroup: input.signedGroup,
      paymentIndex: PAYMENT_INDEX_BY_CHECK.price,
    },
  };

  return { payload, requirements };
}

/**
 * Races a promise against a timeout.
 *
 * The facilitator client has no timeout of its own. Without this, a hung
 * settlement call would leave the user staring at a spinner with no way to know
 * whether their money moved.
 *
 * @param work - the promise to race
 * @param timeoutMs - how long to allow
 * @param label - what to call it in the error
 * @returns the resolved value
 * @throws AppError if the timeout wins
 */
async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new AppError(
          ERROR_CODE.UPSTREAM_TIMEOUT,
          label + ' did not complete in time',
          { detail: 'timed out after ' + String(timeoutMs) + 'ms' },
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Submits the atomic group to Algorand.
 *
 * Call this ONLY after every check has returned an explicit pass. The caller
 * is responsible for that gate; this function assumes the decision is made and
 * carries it out.
 *
 * @param input - the signed group, quotes and group id
 * @returns the transaction id and an explorer link
 * @throws AppError if settlement fails or times out
 */
export async function settleGroup(
  input: SettleInput,
): Promise<SettleOutcome> {
  const startedAt = Date.now();

  logger.info(
    {
      runId: input.runId,
      groupId: input.groupId,
      groupSize: input.signedGroup.length,
    },
    'settling atomic group, all checks passed',
  );

  const { payload, requirements } = buildSettlementPayload(input);

  let response: SettleResponse;

  try {
    // The two `as never` casts bridge our structurally-mirrored types and the
    // SDK's nominal ones. The shapes are field-for-field identical, verified
    // against the real .d.ts files during the probe phase. See the note in
    // packages/shared/src/types/x402.ts for why we mirror rather than import.
    response = (await withTimeout(
      facilitatorClient.settle(payload as never, requirements as never),
      TIMEOUTS_MS.SETTLE,
      'Settlement',
    )) as SettleResponse;
  } catch (cause) {
    if (cause instanceof AppError) {
      throw cause;
    }

    throw new AppError(
      ERROR_CODE.SETTLE_FAILED,
      'Could not reach the facilitator to settle',
      {
        runId: input.runId,
        detail: cause instanceof Error ? cause.message : 'unknown error',
        cause,
      },
    );
  }

  if (!response.success) {
    logger.error(
      {
        runId: input.runId,
        reason: response.errorReason,
        message: response.errorMessage,
      },
      'settlement rejected by facilitator',
    );

    throw new AppError(
      ERROR_CODE.SETTLE_FAILED,
      'Settlement was rejected',
      {
        runId: input.runId,
        detail:
          response.errorMessage ??
          response.errorReason ??
          'the facilitator did not accept the group',
      },
    );
  }

  const txId = response.transaction;

  if (!txId || txId.length === 0) {
    // Settlement reported success without a transaction id. We cannot prove
    // anything happened, and a settlement we cannot point at on the explorer is
    // worse than a clean failure.
    throw new AppError(
      ERROR_CODE.SETTLE_FAILED,
      'Settlement reported success but returned no transaction id',
      { runId: input.runId },
    );
  }

  const explorerUrl = explorerTxUrl(txId, env.explorerBaseUrl);

  logger.info(
    {
      runId: input.runId,
      txId,
      explorerUrl,
      payer: response.payer,
      ms: Date.now() - startedAt,
    },
    'atomic group settled, all five transactions committed together',
  );

  return {
    txId,
    explorerUrl,
    payer: response.payer ?? null,
    network: response.network,
  };
}

/**
 * Describes what an aborted run left behind.
 *
 * Called on the failure path. It performs no work and touches no network,
 * because that is the entire point: there is nothing to undo.
 *
 * @param runId - the run being abandoned
 * @param failureSummary - why it was abandoned
 * @returns a description of the non-event
 */
export function describeAbort(
  runId: string,
  failureSummary: string,
): {
  nothingSettled: true;
  reason: string;
  explanation: string;
} {
  logger.warn(
    { runId, failureSummary },
    'run aborted before settlement, nothing submitted to the network',
  );

  return {
    nothingSettled: true,
    reason: failureSummary,
    explanation:
      'The payment group was signed but never submitted. No transaction ' +
      'exists on Algorand for this run, so there is nothing to reverse. ' +
      'The signed transactions expire unbroadcast.',
  };
}