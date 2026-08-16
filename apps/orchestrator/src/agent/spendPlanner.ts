/**
 * The adaptive spend planner.
 *
 * WHAT THIS DOES
 * --------------
 * Given a budget, the agent decides which tier to buy for each check, reads the
 * answers, and decides whether any of them are uncertain enough to be worth
 * paying more to resolve. Every decision is recorded with a written rationale.
 *
 * WHY THIS IS ONLY POSSIBLE WITH PER-REQUEST PAYMENT
 * --------------------------------------------------
 * Under a subscription every call is prepaid, so the marginal cost of the
 * deepest check is zero and the rational move is always to run it. There is
 * nothing to decide. Escalating BECAUSE a cheap answer was uncertain only makes
 * sense when each request costs money and the budget is finite.
 *
 * That is the behaviour x402 enables and a prepaid model cannot express, and it
 * is the reason this project needs the protocol rather than merely using it.
 *
 * WHY THE POLICY IS FOUR SIMPLE RULES
 * -----------------------------------
 * An autonomous spender nobody can audit is worse than no autonomy at all. A
 * judge should be able to read the rules and predict exactly what the agent
 * will do with their money. Sophistication here would cost trust and buy
 * nothing.
 */

import {
  DEFAULT_POLICY,
  TIER_SPECS,
  decideEscalation,
  sumAtomicAmounts,
} from '@atomicagent/shared';
import type {
  CheckId,
  SpendDecision,
  SpendPolicy,
  Tier,
  TierResult,
} from '@atomicagent/shared';
import { logger } from '../config/logger.js';

/** The three checks, in fixed order. Order defines the group slots. */
const CHECK_IDS: readonly CheckId[] = ['price', 'availability', 'verification'];

/** A verdict as returned by a service, including its tier and certainty. */
export interface TieredVerdict {
  checkId: CheckId;
  tier: Tier;
  confidence: 'confirmed' | 'ambiguous' | 'refuted';
  certainty: number;
  passed: boolean;
  reason: string;
  wouldResolve: string | null;
  detailHash: string;
}

/** The plan for one round of checks. */
export interface SpendPlan {
  /** Which tier to buy for each check this round. */
  tiers: Record<CheckId, Tier>;
  /** What this round costs in total, atomic units. */
  roundCostAtomic: string;
  /** Decisions taken to arrive at this plan, with rationales. */
  decisions: SpendDecision[];
}

/** The full audit trail for a run. */
export interface SpendLedger {
  policy: SpendPolicy;
  /** Every decision across every round, in order. */
  decisions: SpendDecision[];
  /** Total committed so far, atomic units. */
  spentAtomic: string;
  /** Budget remaining, atomic units. */
  remainingAtomic: string;
  /** How many escalation rounds have run. */
  rounds: number;
}

/**
 * Builds the opening plan.
 *
 * Always starts at the cheapest tier for every check. Buying certainty before
 * knowing whether it is needed is exactly the waste this design avoids — and
 * for most runs the shallow answers are sufficient.
 *
 * @param policy - the spend policy
 * @returns the first round's plan
 */
export function openingPlan(policy: SpendPolicy = DEFAULT_POLICY): SpendPlan {
  const tiers: Record<CheckId, Tier> = {
    price: 'shallow',
    availability: 'shallow',
    verification: 'shallow',
  };

  const decisions: SpendDecision[] = CHECK_IDS.map((checkId) => ({
    checkId,
    tier: 'shallow' as Tier,
    feeAtomic: TIER_SPECS.shallow.feeAtomic,
    rationale:
      'Opening at shallow tier. Certainty is only worth buying once we know a ' +
      'cheap answer is insufficient.',
    remainingAtomic: policy.budgetAtomic,
    escalated: false,
  }));

  const roundCostAtomic = sumAtomicAmounts(
    CHECK_IDS.map(() => TIER_SPECS.shallow.feeAtomic),
  );

  return { tiers, roundCostAtomic, decisions };
}

/**
 * Decides whether to run another round, and at which tiers.
 *
 * Only checks that came back uncertain are escalated. A confirmed answer is
 * bought once and never revisited, and a refuted one cannot be changed by
 * paying more.
 *
 * @param options - current verdicts, ledger state and policy
 * @returns the next plan, or null if the run should proceed to settlement
 */
export function planEscalation(options: {
  verdicts: TieredVerdict[];
  ledger: SpendLedger;
  currentTiers: Record<CheckId, Tier>;
}): SpendPlan | null {
  const { verdicts, ledger, currentTiers } = options;

  const nextTiers: Record<CheckId, Tier> = { ...currentTiers };
  const decisions: SpendDecision[] = [];
  const escalatedFees: string[] = [];

  let runningSpent = ledger.spentAtomic;

  for (const verdict of verdicts) {
    const result: TierResult = {
      tier: verdict.tier,
      confidence: verdict.confidence,
      certainty: verdict.certainty,
      reason: verdict.reason,
    };

    const decision = decideEscalation({
      result,
      spentAtomic: runningSpent,
      policy: ledger.policy,
      checkId: verdict.checkId,
    });

    if (!decision.escalate || decision.nextTier === null) {
      decisions.push({
        checkId: verdict.checkId,
        tier: verdict.tier,
        feeAtomic: '0',
        rationale: decision.rationale,
        remainingAtomic: (
          BigInt(ledger.policy.budgetAtomic) - BigInt(runningSpent)
        ).toString(),
        escalated: false,
      });
      continue;
    }

    const fee = TIER_SPECS[decision.nextTier].feeAtomic;
    runningSpent = sumAtomicAmounts([runningSpent, fee]);

    nextTiers[verdict.checkId] = decision.nextTier;
    escalatedFees.push(fee);

    decisions.push({
      checkId: verdict.checkId,
      tier: decision.nextTier,
      feeAtomic: fee,
      rationale: decision.rationale,
      remainingAtomic: (
        BigInt(ledger.policy.budgetAtomic) - BigInt(runningSpent)
      ).toString(),
      escalated: true,
    });
  }

  // Nothing to escalate: the run proceeds to settlement with what it has.
  if (escalatedFees.length === 0) {
    logger.info(
      { rounds: ledger.rounds, spent: ledger.spentAtomic },
      'no escalation needed, proceeding to settlement',
    );
    return null;
  }

  logger.info(
    {
      escalating: decisions.filter((d) => d.escalated).map((d) => d.checkId),
      roundCost: sumAtomicAmounts(escalatedFees),
    },
    'escalating uncertain checks',
  );

  return {
    tiers: nextTiers,
    roundCostAtomic: sumAtomicAmounts(escalatedFees),
    decisions,
  };
}

/**
 * Creates an empty ledger for a new run.
 *
 * @param policy - the spend policy
 * @returns a fresh ledger
 */
export function newLedger(policy: SpendPolicy = DEFAULT_POLICY): SpendLedger {
  return {
    policy,
    decisions: [],
    spentAtomic: '0',
    remainingAtomic: policy.budgetAtomic,
    rounds: 0,
  };
}

/**
 * Records a round against the ledger.
 *
 * @param ledger - the ledger to update, mutated in place
 * @param plan - the plan that was executed
 */
export function recordRound(ledger: SpendLedger, plan: SpendPlan): void {
  ledger.decisions.push(...plan.decisions);
  ledger.spentAtomic = sumAtomicAmounts([ledger.spentAtomic, plan.roundCostAtomic]);
  ledger.remainingAtomic = (
    BigInt(ledger.policy.budgetAtomic) - BigInt(ledger.spentAtomic)
  ).toString();
  ledger.rounds += 1;
}

/**
 * Whether every check reached a confirmed answer.
 *
 * An ambiguous answer is NOT a pass. If the agent ran out of budget before
 * resolving it, the run must abort rather than settle on a guess — spending
 * real money on an uncertain verification is precisely the failure mode this
 * project exists to prevent.
 *
 * @param verdicts - the current verdicts
 * @returns true only if all three are confirmed
 */
export function allConfirmed(verdicts: TieredVerdict[]): boolean {
  if (verdicts.length !== CHECK_IDS.length) return false;
  return verdicts.every((verdict) => verdict.confidence === 'confirmed');
}

/**
 * Summarises why a run cannot settle.
 *
 * @param verdicts - the current verdicts
 * @returns a human-readable summary, or null if everything confirmed
 */
export function blockingReason(verdicts: TieredVerdict[]): string | null {
  const refuted = verdicts.filter((v) => v.confidence === 'refuted');
  const ambiguous = verdicts.filter((v) => v.confidence === 'ambiguous');

  if (refuted.length > 0) {
    return refuted.map((v) => v.checkId + ': ' + v.reason).join('; ');
  }

  if (ambiguous.length > 0) {
    return (
      'Budget exhausted with unresolved uncertainty — ' +
      ambiguous
        .map((v) => v.checkId + ' at ' + Math.round(v.certainty * 100) + '%')
        .join(', ') +
      '. Settling on an uncertain verification is exactly what this system ' +
      'exists to prevent.'
    );
  }

  return null;
}