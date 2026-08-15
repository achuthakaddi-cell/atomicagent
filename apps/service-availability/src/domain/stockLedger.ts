/**
 * The availability check, at three tiers.
 *
 * WHY TIERS MATTER HERE
 * ---------------------
 * Warehouse data has a natural depth ladder that maps cleanly onto price:
 *
 *   shallow   the last stock count, which may be hours old
 *   standard  live system quantity, including today's movements
 *   deep      live quantity minus unconfirmed allocations, plus a real
 *             dispatch-slot check against the supplier's schedule
 *
 * A shallow read genuinely cannot tell you whether stock is committed to
 * another order that has not been confirmed yet. Saying so honestly is more
 * useful than guessing, and it is what makes the agent's escalation decision
 * a real one rather than theatre.
 */

import { TIER_SPECS } from '@atomicagent/shared';
import type { Confidence, Tier, TierResult } from '@atomicagent/shared';

/** One warehouse line. */
interface StockRecord {
  sku: string;
  supplierId: string;
  /** Physical units at the last count. What a shallow check sees. */
  countedUnits: number;
  /** Hours since that count. Higher means less trustworthy. */
  countAgeHours: number;
  /** Live system quantity. Standard and deep see this. */
  liveUnits: number;
  /** Firmly reserved against other orders. Standard and deep see this. */
  reservedUnits: number;
  /**
   * Allocated but not yet confirmed. Only a deep check resolves these, and
   * they are the reason a standard answer can still be uncertain.
   */
  pendingAllocations: number;
  /** Working days from order to dispatch. */
  leadTimeDays: number;
  /** Whether a dispatch slot is actually free. Only a deep check verifies it. */
  dispatchSlotFree: boolean;
  warehouse: string;
}

const LEDGER: readonly StockRecord[] = [
  {
    sku: 'SKU-4471',
    supplierId: 'SUP-BLR-011',
    countedUnits: 12_000,
    countAgeHours: 3,
    liveUnits: 11_800,
    reservedUnits: 1_300,
    pendingAllocations: 0,
    leadTimeDays: 3,
    dispatchSlotFree: true,
    warehouse: 'Peenya Industrial Area, Bengaluru',
  },
  {
    sku: 'SKU-4471',
    supplierId: 'SUP-CHN-330',
    countedUnits: 8_400,
    countAgeHours: 2,
    liveUnits: 8_400,
    reservedUnits: 400,
    pendingAllocations: 0,
    leadTimeDays: 5,
    dispatchSlotFree: true,
    warehouse: 'Ambattur Estate, Chennai',
  },
  {
    sku: 'SKU-4471',
    supplierId: 'SUP-PUN-004',
    countedUnits: 6_200,
    countAgeHours: 9,
    liveUnits: 6_050,
    reservedUnits: 300,
    // Enough pending allocations that a standard read cannot be sure.
    pendingAllocations: 5_400,
    leadTimeDays: 4,
    dispatchSlotFree: false,
    warehouse: 'Chakan MIDC, Pune',
  },
  {
    sku: 'SKU-4472',
    supplierId: 'SUP-BLR-011',
    // The count says there is plenty. The live figure disagrees.
    countedUnits: 900,
    countAgeHours: 16,
    liveUnits: 640,
    reservedUnits: 240,
    pendingAllocations: 0,
    leadTimeDays: 5,
    dispatchSlotFree: true,
    warehouse: 'Peenya Industrial Area, Bengaluru',
  },
  {
    sku: 'SKU-9002',
    supplierId: 'SUP-PUN-004',
    countedUnits: 4_000,
    countAgeHours: 4,
    liveUnits: 3_900,
    reservedUnits: 200,
    pendingAllocations: 0,
    leadTimeDays: 7,
    dispatchSlotFree: true,
    warehouse: 'Chakan MIDC, Pune',
  },
  {
    sku: 'SKU-3310',
    supplierId: 'SUP-BLR-011',
    countedUnits: 250_000,
    countAgeHours: 1,
    liveUnits: 249_400,
    reservedUnits: 11_800,
    pendingAllocations: 0,
    leadTimeDays: 2,
    dispatchSlotFree: true,
    warehouse: 'Peenya Industrial Area, Bengaluru',
  },
];

/** What the availability check returns at whichever tier was paid for. */
export interface AvailabilityCheckResult extends TierResult {
  detail: {
    sku: string;
    supplierId: string;
    tier: Tier;
    method: string;
    requestedUnits: number;
    /** What this tier could actually see. */
    visibleUnits: number;
    reservedUnits: number | null;
    pendingAllocations: number | null;
    freeUnits: number;
    leadTimeDays: number;
    earliestDispatch: string;
    dispatchSlotFree: boolean | null;
    requiredBy: string;
    warehouse: string;
    countAgeHours: number | null;
  } | null;
}

/**
 * Adds working days to a date, skipping weekends.
 *
 * Lead times in manufacturing are quoted in working days. Treating them as
 * calendar days makes our answers optimistic, and an optimistic answer here
 * gates a real payment.
 *
 * @param from - starting date
 * @param workingDays - working days to add
 * @returns the resulting date
 */
function addWorkingDays(from: Date, workingDays: number): Date {
  const result = new Date(from.getTime());
  let remaining = workingDays;

  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }

  return result;
}

/**
 * Runs the availability check at the requested tier.
 *
 * @param input - the request fields plus the tier that was paid for
 * @returns the verdict, its certainty, and the withheld detail
 */
export function runAvailabilityCheck(input: {
  sku: string;
  quantity: number;
  requiredBy: string;
  supplierId: string;
  tier: Tier;
  now?: Date;
}): AvailabilityCheckResult {
  const record = LEDGER.find(
    (candidate) =>
      candidate.sku === input.sku && candidate.supplierId === input.supplierId,
  );

  if (!record) {
    return {
      tier: input.tier,
      confidence: 'refuted',
      certainty: 1,
      reason: 'No stock record for ' + input.sku + ' at ' + input.supplierId + '.',
      detail: null,
    };
  }

  const spec = TIER_SPECS[input.tier];
  const now = input.now ?? new Date();

  // ---- what does this tier actually see? ----
  const visibleUnits =
    input.tier === 'shallow' ? record.countedUnits : record.liveUnits;

  const reserved = input.tier === 'shallow' ? 0 : record.reservedUnits;

  // Only a deep check resolves pending allocations. A standard check knows
  // they exist but cannot tell which will firm up.
  const pending = input.tier === 'deep' ? record.pendingAllocations : 0;

  const freeUnits = visibleUnits - reserved - pending;
  const stockSufficient = freeUnits >= input.quantity;

  const dispatchDate = addWorkingDays(now, record.leadTimeDays);
  const earliestDispatch = dispatchDate.toISOString().slice(0, 10);
  const requiredByDate = new Date(input.requiredBy + 'T23:59:59Z');
  const timingSufficient = dispatchDate.getTime() <= requiredByDate.getTime();

  // Only a deep check verifies an actual dispatch slot exists.
  const slotOk = input.tier === 'deep' ? record.dispatchSlotFree : true;

  let confidence: Confidence;
  let certainty: number;
  let reason: string;
  let wouldResolve: string | undefined;

  if (!stockSufficient) {
    confidence = 'refuted';
    certainty = spec.confidence;
    reason =
      'Only ' + freeUnits + ' units free against ' + input.quantity +
      ' required, by ' + spec.method + '.';
  } else if (!timingSufficient) {
    confidence = 'refuted';
    certainty = spec.confidence;
    reason =
      'Stock exists but earliest dispatch is ' + earliestDispatch +
      ', after your ' + input.requiredBy + ' deadline.';
  } else if (input.tier === 'deep' && !slotOk) {
    confidence = 'refuted';
    certainty = 0.99;
    reason =
      'Stock and lead time are fine, but no dispatch slot is free at this ' +
      'supplier. Only a deep check surfaces this.';
  } else if (input.tier === 'shallow' && record.countAgeHours > 6) {
    // The interesting case. The count is old enough that we cannot honestly
    // confirm it, so we say so rather than pretending.
    confidence = 'ambiguous';
    certainty = 0.6;
    reason =
      'Last stock count was ' + record.countAgeHours +
      ' hours ago and showed ' + record.countedUnits + ' units. Movements since ' +
      'then are not visible at this tier.';
    wouldResolve = 'A live lookup would show current quantity and reservations.';
  } else if (input.tier === 'standard' && record.pendingAllocations > 0) {
    // A standard read can see that allocations exist but not resolve them.
    confidence = 'ambiguous';
    certainty = 0.72;
    reason =
      freeUnits + ' units appear free, but ' + record.pendingAllocations +
      ' units are allocated to unconfirmed orders. This tier cannot tell which ' +
      'will firm up.';
    wouldResolve =
      'A deep check resolves pending allocations and confirms a dispatch slot.';
  } else {
    confidence = 'confirmed';
    certainty = spec.confidence;
    reason =
      freeUnits + ' units free, dispatch by ' + earliestDispatch +
      ', verified by ' + spec.method + '.';
  }

  const result: AvailabilityCheckResult = {
    tier: input.tier,
    confidence,
    certainty,
    reason,
    detail: {
      sku: record.sku,
      supplierId: record.supplierId,
      tier: input.tier,
      method: spec.method,
      requestedUnits: input.quantity,
      visibleUnits,
      reservedUnits: input.tier === 'shallow' ? null : reserved,
      pendingAllocations: input.tier === 'deep' ? record.pendingAllocations : null,
      freeUnits,
      leadTimeDays: record.leadTimeDays,
      earliestDispatch,
      dispatchSlotFree: input.tier === 'deep' ? record.dispatchSlotFree : null,
      requiredBy: input.requiredBy,
      warehouse: record.warehouse,
      countAgeHours: input.tier === 'shallow' ? record.countAgeHours : null,
    },
  };

  if (wouldResolve !== undefined) result.wouldResolve = wouldResolve;

  return result;
}

/**
 * Which suppliers hold stock of a given SKU.
 *
 * @param sku - product code
 * @returns supplier ids
 */
export function suppliersFor(sku: string): string[] {
  return LEDGER.filter((entry) => entry.sku === sku).map((entry) => entry.supplierId);
}

/**
 * Exposes the ledger for the demo UI, counted figures only.
 *
 * Live quantities and allocations are paid information.
 *
 * @returns entries safe to show without payment
 */
export function listStock(): ReadonlyArray<{
  sku: string;
  supplierId: string;
  countedUnits: number;
  countAgeHours: number;
  leadTimeDays: number;
  warehouse: string;
}> {
  return LEDGER.map((entry) => ({
    sku: entry.sku,
    supplierId: entry.supplierId,
    countedUnits: entry.countedUnits,
    countAgeHours: entry.countAgeHours,
    leadTimeDays: entry.leadTimeDays,
    warehouse: entry.warehouse,
  }));
}