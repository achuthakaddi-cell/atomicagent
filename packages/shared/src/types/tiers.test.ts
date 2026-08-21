/**
 * The agent's escalation rules.
 *
 * WHY THIS FILE MATTERS MOST
 * --------------------------
 * These four rules decide how the agent spends someone else's money. They are
 * the reason the project can claim autonomous economic reasoning rather than a
 * fixed price list, and a bug in any of them means either wasted spend or a
 * settlement on an uncertain answer.
 *
 * Each rule is tested in isolation and at its boundary, because off-by-one
 * errors on a threshold are exactly the kind of mistake that passes a casual
 * demo and fails under scrutiny.
 */

import { describe, expect, it } from 'vitest';
import { decideEscalation, DEFAULT_POLICY, TIER_SPECS } from './tiers.js';
import type { SpendPolicy, TierResult } from './tiers.js';

/**
 * Builds a tier result for testing.
 *
 * @param overrides - fields to change from the default
 * @returns a complete TierResult
 */
function result(overrides: Partial<TierResult> = {}): TierResult {
  return {
    tier: 'shallow',
    confidence: 'ambiguous',
    certainty: 0.6,
    reason: 'test',
    ...overrides,
  };
}

describe('decideEscalation — rule 1: refused answers are final', () => {
  it('never escalates a refused answer, however low the certainty', () => {
    const decision = decideEscalation({
      result: result({ confidence: 'refuted', certainty: 0.1 }),
      spentAtomic: '0',
      policy: DEFAULT_POLICY,
      checkId: 'price',
    });

    expect(decision.escalate).toBe(false);
    expect(decision.nextTier).toBeNull();
  });

  it('never escalates a refusal even with the full budget available', () => {
    const decision = decideEscalation({
      result: result({ confidence: 'refuted', certainty: 0.99 }),
      spentAtomic: '0',
      policy: { ...DEFAULT_POLICY, budgetAtomic: '100000000' },
      checkId: 'verification',
    });

    // Paying more cannot turn a refusal into a pass. Spending to confirm bad
    // news is precisely the waste this rule prevents.
    expect(decision.escalate).toBe(false);
    expect(decision.rationale).toContain('conclusively');
  });
});

describe('decideEscalation — rule 2: certainty is read, not the label', () => {
  it('does not escalate when certainty is above the threshold', () => {
    const decision = decideEscalation({
      result: result({ certainty: 0.9 }),
      spentAtomic: '0',
      policy: DEFAULT_POLICY,
      checkId: 'price',
    });

    expect(decision.escalate).toBe(false);
  });

  it('does not escalate exactly at the threshold', () => {
    // The boundary. escalateBelow is 0.85, so 0.85 itself must not escalate.
    const decision = decideEscalation({
      result: result({ certainty: DEFAULT_POLICY.escalateBelow }),
      spentAtomic: '0',
      policy: DEFAULT_POLICY,
      checkId: 'price',
    });

    expect(decision.escalate).toBe(false);
  });

  it('escalates just below the threshold', () => {
    const decision = decideEscalation({
      result: result({ certainty: DEFAULT_POLICY.escalateBelow - 0.01 }),
      spentAtomic: '0',
      policy: DEFAULT_POLICY,
      checkId: 'price',
    });

    expect(decision.escalate).toBe(true);
    expect(decision.nextTier).toBe('standard');
  });

  it('escalates a CONFIRMED answer whose certainty is below the threshold', () => {
    // The important one. A confirmed answer from a tier that is only 68%
    // reliable is a 68% confirmation, not a certainty. Reading the label rather
    // than the number would make the threshold meaningless — and this was a
    // real bug before it was caught.
    const decision = decideEscalation({
      result: result({ confidence: 'confirmed', certainty: 0.68 }),
      spentAtomic: '0',
      policy: DEFAULT_POLICY,
      checkId: 'availability',
    });

    expect(decision.escalate).toBe(true);
    expect(decision.nextTier).toBe('standard');
  });
});

describe('decideEscalation — rule 3: there must be a deeper tier', () => {
  it('escalates shallow to standard', () => {
    const decision = decideEscalation({
      result: result({ tier: 'shallow', certainty: 0.5 }),
      spentAtomic: '0',
      policy: DEFAULT_POLICY,
      checkId: 'price',
    });

    expect(decision.nextTier).toBe('standard');
  });

  it('escalates standard to deep', () => {
    const decision = decideEscalation({
      result: result({ tier: 'standard', certainty: 0.5 }),
      spentAtomic: '0',
      policy: DEFAULT_POLICY,
      checkId: 'price',
    });

    expect(decision.nextTier).toBe('deep');
  });

  it('cannot escalate beyond deep', () => {
    const decision = decideEscalation({
      result: result({ tier: 'deep', certainty: 0.5 }),
      spentAtomic: '0',
      policy: DEFAULT_POLICY,
      checkId: 'price',
    });

    expect(decision.escalate).toBe(false);
    expect(decision.nextTier).toBeNull();
    expect(decision.rationale).toContain('No deeper tier');
  });
});

describe('decideEscalation — rule 4: the budget must allow it', () => {
  it('escalates when the budget comfortably covers the next tier', () => {
    const decision = decideEscalation({
      result: result({ certainty: 0.5 }),
      spentAtomic: '30000',
      policy: DEFAULT_POLICY,
      checkId: 'price',
    });

    expect(decision.escalate).toBe(true);
  });

  it('refuses to escalate when it would breach the reserve', () => {
    // Budget 500000, reserve 20% = 100000. Spent 400000 leaves 100000, and
    // standard costs 50000 — which would leave 50000, below the reserve.
    const decision = decideEscalation({
      result: result({ certainty: 0.5 }),
      spentAtomic: '400000',
      policy: DEFAULT_POLICY,
      checkId: 'price',
    });

    expect(decision.escalate).toBe(false);
    expect(decision.rationale).toContain('reserved');
  });

  it('refuses when the budget is exhausted', () => {
    const decision = decideEscalation({
      result: result({ certainty: 0.3 }),
      spentAtomic: DEFAULT_POLICY.budgetAtomic,
      policy: DEFAULT_POLICY,
      checkId: 'verification',
    });

    expect(decision.escalate).toBe(false);
  });

  it('accounts for the price difference between tiers', () => {
    // Deep costs 200000, four times standard. A budget that allows one does
    // not necessarily allow the other.
    const tight: SpendPolicy = {
      ...DEFAULT_POLICY,
      budgetAtomic: '150000',
      reserveFraction: 0,
    };

    const toStandard = decideEscalation({
      result: result({ tier: 'shallow', certainty: 0.5 }),
      spentAtomic: '0',
      policy: tight,
      checkId: 'price',
    });

    const toDeep = decideEscalation({
      result: result({ tier: 'standard', certainty: 0.5 }),
      spentAtomic: '0',
      policy: tight,
      checkId: 'price',
    });

    expect(toStandard.escalate).toBe(true);
    expect(toDeep.escalate).toBe(false);
  });
});

describe('decideEscalation — every decision explains itself', () => {
  it('always returns a non-empty rationale', () => {
    const cases: TierResult[] = [
      result({ confidence: 'refuted' }),
      result({ certainty: 0.99 }),
      result({ tier: 'deep', certainty: 0.5 }),
      result({ certainty: 0.5 }),
    ];

    for (const testCase of cases) {
      const decision = decideEscalation({
        result: testCase,
        spentAtomic: '0',
        policy: DEFAULT_POLICY,
        checkId: 'price',
      });

      // An autonomous spender nobody can audit is worse than no autonomy at
      // all. Every decision must be explainable to the person whose money it is.
      expect(decision.rationale.length).toBeGreaterThan(20);
    }
  });

  it('names the check it is deciding about', () => {
    const decision = decideEscalation({
      result: result({ certainty: 0.5 }),
      spentAtomic: '0',
      policy: DEFAULT_POLICY,
      checkId: 'availability',
    });

    expect(decision.rationale).toContain('availability');
  });
});

describe('tier ladder', () => {
  it('prices increase with depth', () => {
    expect(BigInt(TIER_SPECS.shallow.feeAtomic)).toBeLessThan(
      BigInt(TIER_SPECS.standard.feeAtomic),
    );
    expect(BigInt(TIER_SPECS.standard.feeAtomic)).toBeLessThan(
      BigInt(TIER_SPECS.deep.feeAtomic),
    );
  });

  it('confidence increases with depth', () => {
    expect(TIER_SPECS.shallow.confidence).toBeLessThan(TIER_SPECS.standard.confidence);
    expect(TIER_SPECS.standard.confidence).toBeLessThan(TIER_SPECS.deep.confidence);
  });

  it('the cheapest tier is below the escalation threshold', () => {
    // If shallow were confident enough on its own, the agent would never
    // escalate and the whole mechanism would be decorative.
    expect(TIER_SPECS.shallow.confidence).toBeLessThan(DEFAULT_POLICY.escalateBelow);
  });
});