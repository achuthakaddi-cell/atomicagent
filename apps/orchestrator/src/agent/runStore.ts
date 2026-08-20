/**
 * Run lifecycle and state machine.
 *
 * A "run" is one complete journey: quote, sign, verify, then settle or abort.
 *
 * WHY A STATE MACHINE RATHER THAN LOOSE FLAGS
 * -------------------------------------------
 * The single most damaging bug this project could ship is settling twice, or
 * settling a run whose checks failed. Loose booleans make that a one-line
 * mistake. An explicit phase machine makes it impossible: settle() is reachable
 * only from `verifying`, and only when every verdict passed.
 *
 * STORAGE
 * -------
 * In-memory Map with TTL eviction. Adequate for a single-process demo and
 * deliberately behind a small interface so swapping in SQLite or Redis is a
 * contained change. Stated plainly rather than hidden: a restart loses
 * in-flight runs.
 */

import { randomUUID } from 'node:crypto';
import {
  AppError,
  ERROR_CODE,
  DEFAULT_POLICY,
  type CheckId,
  type DiscoveredService,
  type CheckQuote,
  type RunPhase,
  type SourcingRequest,
  type Tier,
} from '@atomicagent/shared';
import type { SpendLedger, TieredVerdict } from './spendPlanner.js';
import { logger } from '../config/logger.js';

/** Everything known about one run. */
export interface Run {
  id: string;
  phase: RunPhase;
  createdAt: number;
  updatedAt: number;

  /** What the buyer asked for. */
  request: SourcingRequest;
  /** The wallet that will sign and pay. */
  buyerAddress: string;

  /** Quotes harvested from the three 402 challenges. */
  quotes: CheckQuote[];
  /** Fee-payer address the facilitator will use for slot 0. */
  feePayer: string | null;

  /** Unsigned group, base64 msgpack, in slot order. Rebuilt on each round. */
  unsignedGroup: string[];
  /** Signed group returned from the wallet. */
  signedGroup: string[] | null;
  /** Base64 group id, for cross-checking every slot. */
  groupId: string | null;

  /** Order total for the final slot, atomic units. */
  orderTotalAtomic: string;
  /** Sum of the three built-in check fees, atomic units. */
  totalFeesAtomic: string;

  /** Verdicts collected during the most recent verify round. */
  verdicts: TieredVerdict[];

  /** Which tier each check is currently being paid for. */
  tiers: Record<CheckId, Tier>;

  /**
   * What each built-in check is owed this round, in atomic units.
   *
   * Exactly the current tier's fee, never a running total. A service identifies
   * which tier a client paid for by matching the amount against its price list,
   * and a cumulative figure matches no tier and is rejected outright.
   */
  cumulativeFees: Record<CheckId, string>;

  /** The spend audit trail: every decision, with its rationale. */
  ledger: SpendLedger;

  /**
   * Services registered at runtime from their own 402 challenges.
   *
   * Captured when the run is created, not read live, because a service
   * registering mid-run would change the group after the user had signed it.
   */
  externalServices: DiscoveredService[];

  /**
   * How many transactions this run's group contains.
   *
   * Four built-in slots, one per external service, and the order payment last.
   * A hardcoded size would reject any group carrying an external service.
   */
  groupSize: number;

  /**
   * Which slot the order payment occupies.
   *
   * Always last, so registering a service does not renumber it.
   */
  orderSlot: number;

  /** Transaction id, present only after a successful settle. */
  txId: string | null;
  /** Why the run aborted, if it did. */
  abortReason: string | null;

  /**
   * Guards against double settlement.
   *
   * Set the instant a settle attempt begins, before any await. Two concurrent
   * requests cannot both pass this check, so the group can only ever be
   * submitted once.
   */
  settleLocked: boolean;
}

/** Runs older than this are evicted. */
const RUN_TTL_MS = 30 * 60 * 1000;

/** Ceiling on stored runs, so a flood cannot exhaust memory. */
const MAX_RUNS = 500;

const runs = new Map<string, Run>();

/**
 * Which phases may follow which.
 *
 * Any transition not listed here is rejected. That is the point: the machine
 * refuses illegal moves rather than trusting callers to sequence correctly.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<RunPhase, readonly RunPhase[]>> = {
  idle: ['quoting', 'error'],
  quoting: ['awaiting_signature', 'aborted', 'error'],
  awaiting_signature: ['verifying', 'aborted', 'error'],
  // verifying -> awaiting_signature is the escalation path: the agent decided
  // a cheap answer was too uncertain, so the group is rebuilt at a higher tier
  // and the user is asked to approve the extra spend.
  verifying: ['settling', 'awaiting_signature', 'aborted', 'error'],
  settling: ['settled', 'aborted', 'error'],
  settled: [],
  aborted: [],
  error: [],
};

/**
 * Removes expired runs, and the oldest runs if the map is over capacity.
 */
function evictStale(): void {
  const now = Date.now();

  for (const [id, run] of runs) {
    if (now - run.updatedAt > RUN_TTL_MS) {
      runs.delete(id);
      logger.debug({ runId: id }, 'evicted expired run');
    }
  }

  if (runs.size > MAX_RUNS) {
    const sorted = [...runs.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    const excess = runs.size - MAX_RUNS;
    for (let index = 0; index < excess; index += 1) {
      const entry = sorted[index];
      if (entry) runs.delete(entry[0]);
    }
    logger.warn({ evicted: excess }, 'run store over capacity, evicted oldest');
  }
}

/**
 * Creates a new run in the `quoting` phase.
 *
 * @param request - what the buyer wants to source
 * @param buyerAddress - the wallet that will sign
 * @returns the new run
 */
export function createRun(
  request: SourcingRequest,
  buyerAddress: string,
): Run {
  evictStale();

  const now = Date.now();
  const run: Run = {
    id: randomUUID(),
    phase: 'quoting',
    createdAt: now,
    updatedAt: now,
    request,
    buyerAddress,
    quotes: [],
    feePayer: null,
    unsignedGroup: [],
    signedGroup: null,
    groupId: null,
    orderTotalAtomic: '0',
    totalFeesAtomic: '0',
    verdicts: [],
    tiers: {
      price: 'shallow',
      availability: 'shallow',
      verification: 'shallow',
    },
    cumulativeFees: {
      price: '0',
      availability: '0',
      verification: '0',
    },
    ledger: {
      policy: DEFAULT_POLICY,
      decisions: [],
      spentAtomic: '0',
      remainingAtomic: DEFAULT_POLICY.budgetAtomic,
      rounds: 0,
    },
    externalServices: [],
    // Four built-in slots plus the order payment. Grows when services register.
    groupSize: 5,
    orderSlot: 4,
    txId: null,
    abortReason: null,
    settleLocked: false,
  };

  runs.set(run.id, run);
  logger.info({ runId: run.id, sku: request.sku }, 'run created');

  return run;
}

/**
 * Fetches a run by id.
 *
 * @param runId - the run id
 * @returns the run
 * @throws AppError if unknown or expired
 */
export function getRun(runId: string): Run {
  const run = runs.get(runId);
  if (!run) {
    throw new AppError(ERROR_CODE.RUN_NOT_FOUND, 'Run not found or expired', {
      runId,
    });
  }
  return run;
}

/**
 * Moves a run to a new phase, rejecting illegal transitions.
 *
 * @param run - the run to move
 * @param next - the phase to move to
 * @throws AppError if the transition is not permitted
 */
export function transition(run: Run, next: RunPhase): void {
  const allowed = ALLOWED_TRANSITIONS[run.phase];

  if (!allowed.includes(next)) {
    throw new AppError(
      ERROR_CODE.RUN_STATE_INVALID,
      `Cannot move from ${run.phase} to ${next}`,
      {
        runId: run.id,
        detail: `allowed from ${run.phase}: ${allowed.join(', ') || 'none'}`,
      },
    );
  }

  logger.info({ runId: run.id, from: run.phase, to: next }, 'run phase changed');

  run.phase = next;
  run.updatedAt = Date.now();
}

/**
 * Requires a run to be in a specific phase.
 *
 * @param run - the run to check
 * @param expected - the phase it must be in
 * @throws AppError if it is in any other phase
 */
export function requirePhase(run: Run, expected: RunPhase): void {
  if (run.phase !== expected) {
    throw new AppError(
      ERROR_CODE.RUN_STATE_INVALID,
      `This run is ${run.phase}, not ${expected}`,
      { runId: run.id },
    );
  }
}

/**
 * Claims the settle lock for a run.
 *
 * Synchronous and set before any await, so two concurrent settle requests
 * cannot both succeed. This is the last line of defence against submitting
 * the same atomic group twice.
 *
 * @param run - the run to lock
 * @throws AppError if settlement is already under way or complete
 */
export function claimSettleLock(run: Run): void {
  if (run.settleLocked) {
    throw new AppError(
      ERROR_CODE.ALREADY_SETTLED,
      'Settlement is already in progress or complete for this run',
      { runId: run.id, detail: run.txId ? `txId ${run.txId}` : undefined },
    );
  }
  run.settleLocked = true;
  run.updatedAt = Date.now();
}

/**
 * Records why a run was abandoned and moves it to `aborted`.
 *
 * @param run - the run to abort
 * @param reason - plain-language explanation for the rollback screen
 */
export function abortRun(run: Run, reason: string): void {
  run.abortReason = reason;
  transition(run, 'aborted');

  // Drop the signed transactions. They were never broadcast and never will be;
  // holding them serves no purpose and keeping signatures around is careless.
  run.signedGroup = null;

  logger.warn({ runId: run.id, reason }, 'run aborted, nothing settled');
}

/**
 * Whether every check reached a confirmed answer.
 *
 * An ambiguous answer is NOT a pass. If the agent ran out of budget before
 * resolving one, the run must abort rather than settle on a guess — spending
 * real money on an uncertain verification is precisely the failure mode this
 * project exists to prevent.
 *
 * @param run - the run to inspect
 * @returns true only if all three confirmed
 */
export function allChecksPassed(run: Run): boolean {
  const required: readonly CheckId[] = ['price', 'availability', 'verification'];

  for (const checkId of required) {
    const verdict = run.verdicts.find((entry) => entry.checkId === checkId);
    if (!verdict || verdict.confidence !== 'confirmed') return false;
  }

  return true;
}

/**
 * Lists the checks that did not confirm.
 *
 * @param run - the run to inspect
 * @returns ids of unresolved or missing checks
 */
export function failedChecks(run: Run): CheckId[] {
  const required: readonly CheckId[] = ['price', 'availability', 'verification'];

  return required.filter((checkId) => {
    const verdict = run.verdicts.find((entry) => entry.checkId === checkId);
    return !verdict || verdict.confidence !== 'confirmed';
  });
}

/**
 * Adds a round's fees to the cumulative total for each check.
 *
 * Retained for the audit trail. The group itself carries only the current
 * tier's fee, because a service matches the amount it receives against its own
 * price list and a running total matches no tier.
 *
 * @param run - the run to update, mutated in place
 * @param fees - fee paid this round, per check
 */
export function addRoundFees(
  run: Run,
  fees: Partial<Record<CheckId, string>>,
): void {
  for (const checkId of ['price', 'availability', 'verification'] as const) {
    const fee = fees[checkId];
    if (fee === undefined || fee === '0') continue;
    run.cumulativeFees[checkId] = (
      BigInt(run.cumulativeFees[checkId]) + BigInt(fee)
    ).toString();
  }
  run.updatedAt = Date.now();
}

/**
 * Current store size. Used by the health endpoint.
 *
 * @returns number of runs held in memory
 */
export function runCount(): number {
  return runs.size;
}