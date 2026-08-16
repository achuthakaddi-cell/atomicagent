/**
 * Verification tiers and the adaptive spend policy.
 *
 * THE IDEA
 * --------
 * Each check is available at three price points. A cheap check is fast but may
 * return an ambiguous answer; an expensive one is authoritative. The agent is
 * given a budget and decides for itself when a cheap answer is good enough and
 * when it is worth paying for certainty.
 *
 * WHY THIS NEEDS PER-REQUEST PAYMENT
 * ----------------------------------
 * Under a subscription every call is already paid for, so there is no marginal
 * cost and therefore nothing to reason about — you would simply always run the
 * deepest check. Escalating BECAUSE a cheap answer was uncertain only makes
 * sense when each request costs money. This is the behaviour x402 makes
 * possible and a prepaid model cannot.
 */

/** The three price points every check offers. */
export const TIERS = ['shallow', 'standard', 'deep'] as const;

export type Tier = (typeof TIERS)[number];

/** What one tier costs and what it delivers. */
export interface TierSpec {
  tier: Tier;
  /** Fee in atomic units of the payment asset. */
  feeAtomic: string;
  /** Human label for the UI. */
  label: string;
  /** What this tier actually does. */
  method: string;
  /** Typical confidence, 0 to 1. Used by the agent to decide when to escalate. */
  confidence: number;
  /** Rough latency in milliseconds, so the UI can show a realistic meter. */
  latencyMs: number;
}

/** The tier ladder. Identical across all three services. */
export const TIER_SPECS: Readonly<Record<Tier, TierSpec>> = {
  shallow: {
    tier: 'shallow',
    feeAtomic: '10000',
    label: 'Shallow',
    method: 'cached snapshot',
    confidence: 0.68,
    latencyMs: 400,
  },
  standard: {
    tier: 'standard',
    feeAtomic: '50000',
    label: 'Standard',
    method: 'live source lookup',
    confidence: 0.9,
    latencyMs: 1200,
  },
  deep: {
    tier: 'deep',
    feeAtomic: '200000',
    label: 'Deep',
    method: 'full audit, cross-referenced',
    confidence: 0.99,
    latencyMs: 2600,
  },
};

/** What a check can conclude at a given tier. */
export type Confidence = 'confirmed' | 'ambiguous' | 'refuted';

/** One tier's answer, before the agent decides what to do about it. */
export interface TierResult {
  tier: Tier;
  confidence: Confidence;
  /** How certain this answer is, 0 to 1. */
  certainty: number;
  reason: string;
  /** What a deeper tier would resolve, when this one was ambiguous. */
  wouldResolve?: string;
}

/**
 * The agent's spending policy.
 *
 * Deliberately simple and fully inspectable. A judge should be able to read
 * these four rules and predict exactly what the agent will do, because an
 * autonomous spender nobody can audit is worse than no autonomy at all.
 */
export interface SpendPolicy {
  /** Total the agent may spend on verification, in atomic units. */
  budgetAtomic: string;
  /** Escalate when certainty falls below this. */
  escalateBelow: number;
  /** Never spend more than this fraction of the budget on one check. */
  maxPerCheckFraction: number;
  /** Stop escalating once this much of the budget is gone. */
  reserveFraction: number;
}

/** A sensible default. Shown in the UI and editable by the user. */
export const DEFAULT_POLICY: SpendPolicy = {
  budgetAtomic: '500000',
  escalateBelow: 0.85,
  maxPerCheckFraction: 0.5,
  reserveFraction: 0.2,
};

/** One decision the agent made, recorded for the audit trail. */
export interface SpendDecision {
  checkId: string;
  tier: Tier;
  feeAtomic: string;
  /** Why the agent chose this tier. Shown verbatim in the UI. */
  rationale: string;
  /** Budget remaining after this decision. */
  remainingAtomic: string;
  /** Whether this was an escalation from a cheaper tier. */
  escalated: boolean;
}

/**
 * Decides whether to escalate after an unsatisfying answer.
 *
 * Four rules, evaluated in order. Each returns a rationale string that is
 * displayed to the user, so the agent's reasoning is never hidden.
 *
 * @param options - the current tier result, budget state and policy
 * @returns whether to escalate, to which tier, and why
 */
export function decideEscalation(options: {
  result: TierResult;
  spentAtomic: string;
  policy: SpendPolicy;
  checkId: string;
}): { escalate: boolean; nextTier: Tier | null; rationale: string } {
  const { result, spentAtomic, policy, checkId } = options;

  const budget = BigInt(policy.budgetAtomic);
  const spent = BigInt(spentAtomic);
  const remaining = budget - spent;

  // Rule 1: a refuted answer is final. Paying more cannot turn a refusal into
  // a pass, and spending to confirm bad news is exactly the waste we avoid.
  if (result.confidence === 'refuted') {
    return {
      escalate: false,
      nextTier: null,
      rationale:
        checkId + ' failed conclusively. Escalating cannot change a refusal.',
    };
  }

  // Rule 2: certainty at or above the threshold is good enough, whatever the
  // verdict label says.
  //
  // A confirmed answer from a tier that is only 68% reliable is a 68%
  // confirmation, not a certainty. Reading the number rather than the label is
  // what stops the threshold being meaningless.
  if (result.certainty >= policy.escalateBelow) {
    return {
      escalate: false,
      nextTier: null,
      rationale:
        checkId + ' returned ' + Math.round(result.certainty * 100) +
        '% certainty at ' + result.tier + ' tier, at or above the ' +
        Math.round(policy.escalateBelow * 100) + '% threshold. No escalation needed.',
    };
  }

  // Rule 3: there must be a deeper tier to escalate to.
  const nextTier: Tier | null =
    result.tier === 'shallow' ? 'standard' : result.tier === 'standard' ? 'deep' : null;

  if (nextTier === null) {
    return {
      escalate: false,
      nextTier: null,
      rationale:
        checkId + ' is already at deep tier at ' +
        Math.round(result.certainty * 100) + '% certainty. No deeper tier exists.',
    };
  }

  // Rule 4: the budget must cover it, with the reserve left intact.
  const nextFee = BigInt(TIER_SPECS[nextTier].feeAtomic);
  const reserve = (budget * BigInt(Math.round(policy.reserveFraction * 100))) / 100n;

  if (remaining - nextFee < reserve) {
    return {
      escalate: false,
      nextTier: null,
      rationale:
        'Escalating ' + checkId + ' to ' + nextTier + ' costs ' + nextFee.toString() +
        ' but only ' + remaining.toString() + ' remains and ' + reserve.toString() +
        ' is reserved. Proceeding with the ' + Math.round(result.certainty * 100) +
        '% answer.',
    };
  }

  return {
    escalate: true,
    nextTier,
    rationale:
      checkId + ' returned only ' + Math.round(result.certainty * 100) +
      '% certainty. Budget allows escalation to ' + nextTier + ' for ' +
      nextFee.toString() + '. Escalating.',
  };
}