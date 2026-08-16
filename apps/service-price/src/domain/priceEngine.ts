/**
 * The price check, at three tiers.
 *
 * WHY TIERS EXIST
 * ---------------
 * A cheap check reads a cached snapshot and may be stale or incomplete, so it
 * can only offer partial certainty. An expensive one queries live and
 * cross-references. The agent chooses which to pay for, and escalates when a
 * cheap answer is not good enough.
 *
 * That choice is the point. Under a subscription there is no marginal cost, so
 * the rational move is always the deepest check and there is nothing to reason
 * about. Escalation only makes sense when each request costs money.
 *
 * WHY AMBIGUOUS IS A REAL OUTCOME
 * -------------------------------
 * Cached price data goes stale. A quote from six hours ago near the buyer's
 * ceiling genuinely cannot be trusted, and saying so honestly is more useful
 * than guessing. The ambiguous case is what makes the agent's decision
 * interesting rather than theatrical.
 */

import { multiplyAtomicAmount } from '@atomicagent/shared';
import { TIER_SPECS } from '@atomicagent/shared';
import type { Confidence, Tier, TierResult } from '@atomicagent/shared';

/** One catalogue entry. All money values are atomic units, as digit strings. */
interface CatalogueEntry {
  sku: string;
  description: string;
  /** Unit price in atomic units of the payment asset. */
  unitPriceAtomic: string;
  /** Supplier offering this price. */
  supplierId: string;
  /** When the cached snapshot was taken. Drives staleness. */
  cachedAt: string;
  /** Hours since the cache was refreshed. Higher means less trustworthy. */
  cacheAgeHours: number;
  /**
   * The live price, which may differ from the cached one.
   * Only a standard or deep check sees this.
   */
  livePriceAtomic: string;
  /** Rebates and volume discounts. Only a deep check finds these. */
  volumeDiscountAtomic: string | null;
}

/**
 * The catalogue.
 *
 * Entries are chosen so every interesting path is reachable:
 *   SKU-4471  cheap check is confident, no escalation needed
 *   SKU-4472  cached price is stale and near the ceiling -> AMBIGUOUS
 *   SKU-9002  far above any ceiling, refuted at every tier
 *   SKU-3310  deep check finds a volume discount the others miss
 */
const CATALOGUE: readonly CatalogueEntry[] = [
  {
    sku: 'SKU-4471',
    description: 'Cold-rolled steel sheet, 1.2mm, 1250x2500',
    // Cached figure sits close to a typical ceiling and the snapshot is old,
    // so a shallow read cannot honestly confirm it. This is the case that
    // makes escalation worth demonstrating.
    unitPriceAtomic: '4800000',
    supplierId: 'SUP-BLR-011',
    cachedAt: '2026-08-14T20:00:00Z',
    cacheAgeHours: 11,
    // Live price has drifted down since the snapshot, so escalating confirms
    // the order rather than killing it.
    livePriceAtomic: '4650000',
    volumeDiscountAtomic: null,
  },
  {
    sku: 'SKU-4472',
    description: 'Galvanised steel coil, 0.8mm',
    // Cached figure sits just under a typical ceiling, and the cache is old.
    // A shallow check cannot honestly confirm this.
    unitPriceAtomic: '4850000',
    supplierId: 'SUP-BLR-011',
    cachedAt: '2026-08-14T22:00:00Z',
    cacheAgeHours: 14,
    // Live price has moved above the ceiling since the snapshot.
    livePriceAtomic: '5150000',
    volumeDiscountAtomic: null,
  },
  {
    sku: 'SKU-9002',
    description: 'Precision bearing assembly, grade 7',
    unitPriceAtomic: '82000000',
    supplierId: 'SUP-PUN-004',
    cachedAt: '2026-08-15T03:00:00Z',
    cacheAgeHours: 3,
    livePriceAtomic: '82000000',
    volumeDiscountAtomic: null,
  },
  {
    sku: 'SKU-3310',
    description: 'Industrial fastener set, M8, zinc plated',
    unitPriceAtomic: '150000',
    supplierId: 'SUP-BLR-011',
    cachedAt: '2026-08-15T05:00:00Z',
    cacheAgeHours: 1,
    livePriceAtomic: '150000',
    // A deep check surfaces a rebate worth finding on a large order.
    volumeDiscountAtomic: '18000',
  },
  {
    sku: 'SKU-4471',
    description: 'Cold-rolled steel sheet, 1.2mm, 1250x2500',
    // Cached figure sits close to a typical ceiling and the snapshot is old,
    // so a shallow read cannot honestly confirm it. This is the case that
    // makes escalation worth demonstrating.
    unitPriceAtomic: '4800000',
    supplierId: 'SUP-BLR-011',
    cachedAt: '2026-08-14T20:00:00Z',
    cacheAgeHours: 11,
    // Live price has drifted down since the snapshot, so escalating confirms
    // the order rather than killing it.
    livePriceAtomic: '4650000',
    volumeDiscountAtomic: null,
  },
  {
    sku: 'SKU-4471',
    description: 'Cold-rolled steel sheet, 1.2mm, 1250x2500',
    unitPriceAtomic: '4680000',
    supplierId: 'SUP-PUN-004',
    cachedAt: '2026-08-15T04:15:00Z',
    cacheAgeHours: 2,
    livePriceAtomic: '4680000',
    volumeDiscountAtomic: null,
  },
];

/** What the price check returns, at whichever tier was paid for. */
export interface PriceCheckResult extends TierResult {
  detail: {
    sku: string;
    description: string;
    supplierId: string;
    tier: Tier;
    method: string;
    quotedUnitPriceAtomic: string;
    maxUnitPriceAtomic: string;
    quantity: number;
    orderTotalAtomic: string;
    cacheAgeHours: number | null;
    volumeDiscountAtomic: string | null;
  } | null;
}

/**
 * Runs the price check at the requested tier.
 *
 * Each tier sees more of the truth. Shallow reads the cached snapshot only,
 * standard queries live, deep additionally surfaces rebates and discounts.
 *
 * @param input - the request fields plus the tier that was paid for
 * @returns the verdict, its certainty, and the detail withheld until settlement
 */
export function runPriceCheck(input: {
  sku: string;
  quantity: number;
  maxUnitPriceAtomic: string;
  supplierId: string;
  tier: Tier;
}): PriceCheckResult {
  const entry = CATALOGUE.find(
    (candidate) =>
      candidate.sku === input.sku && candidate.supplierId === input.supplierId,
  );

  if (!entry) {
    return {
      tier: input.tier,
      confidence: 'refuted',
      certainty: 1,
      reason: 'No price on file for ' + input.sku + ' from ' + input.supplierId + '.',
      detail: null,
    };
  }

  const spec = TIER_SPECS[input.tier];
  const ceiling = BigInt(input.maxUnitPriceAtomic);

  // ---- which price does this tier actually see? ----
  //
  // Shallow reads the cache and cannot know it has moved. Standard and deep
  // query live. This is the whole reason a cheap answer can be wrong.
  const seenPrice =
    input.tier === 'shallow' ? entry.unitPriceAtomic : entry.livePriceAtomic;

  let effectivePrice = BigInt(seenPrice);

  // Only a deep check finds volume rebates.
  if (input.tier === 'deep' && entry.volumeDiscountAtomic !== null) {
    effectivePrice -= BigInt(entry.volumeDiscountAtomic);
  }

  const withinCeiling = effectivePrice <= ceiling;

  // ---- how close to the ceiling is it? ----
  //
  // A price comfortably under the ceiling can be confirmed from cache. One
  // sitting within a few percent of it cannot, because the cache may be stale
  // by more than that margin.
  const margin = ceiling > 0n
    ? Number(((ceiling - effectivePrice) * 1000n) / ceiling) / 1000
    : 0;

  let confidence: Confidence;
  let certainty: number;
  let reason: string;
  let wouldResolve: string | undefined;

  if (!withinCeiling) {
    confidence = 'refuted';
    certainty = spec.confidence;
    reason =
      'Quoted unit price exceeds your ceiling at ' + spec.label.toLowerCase() +
      ' tier (' + spec.method + ').';
  } else if (input.tier === 'shallow' && (margin < 0.08 || entry.cacheAgeHours > 6)) {
    // The interesting case. The cached figure passes, but the margin is thin
    // or the snapshot is old, so we say so rather than pretending.
    confidence = 'ambiguous';
    certainty = 0.62;
    reason =
      'Cached price is within your ceiling by ' + (margin * 100).toFixed(1) +
      '%, but the snapshot is ' + entry.cacheAgeHours + ' hours old.';
    wouldResolve = 'A live lookup would confirm whether the price has moved.';
  } else {
    confidence = 'confirmed';
    certainty = spec.confidence;
    reason =
      'Quoted unit price is within your ceiling, verified by ' + spec.method + '.' +
      (input.tier === 'deep' && entry.volumeDiscountAtomic !== null
        ? ' A volume rebate of ' + entry.volumeDiscountAtomic + ' was applied.'
        : '');
  }

  const orderTotalAtomic = multiplyAtomicAmount(
    effectivePrice.toString(),
    input.quantity,
  );

  const result: PriceCheckResult = {
    tier: input.tier,
    confidence,
    certainty,
    reason,
    detail: {
      sku: entry.sku,
      description: entry.description,
      supplierId: entry.supplierId,
      tier: input.tier,
      method: spec.method,
      quotedUnitPriceAtomic: effectivePrice.toString(),
      maxUnitPriceAtomic: input.maxUnitPriceAtomic,
      quantity: input.quantity,
      orderTotalAtomic,
      cacheAgeHours: input.tier === 'shallow' ? entry.cacheAgeHours : null,
      volumeDiscountAtomic:
        input.tier === 'deep' ? entry.volumeDiscountAtomic : null,
    },
  };

  if (wouldResolve !== undefined) result.wouldResolve = wouldResolve;

  return result;
}

/**
 * Looks up a unit price without running the full check.
 *
 * @param sku - product code
 * @param supplierId - supplier
 * @returns unit price in atomic units, or null if not stocked
 */
export function lookupUnitPrice(sku: string, supplierId: string): string | null {
  const entry = CATALOGUE.find(
    (candidate) => candidate.sku === sku && candidate.supplierId === supplierId,
  );
  return entry ? entry.livePriceAtomic : null;
}

/**
 * Which suppliers can quote a given SKU.
 *
 * Used by competitive sourcing to discover who to ask.
 *
 * @param sku - product code
 * @returns supplier ids offering it
 */
export function suppliersFor(sku: string): string[] {
  return CATALOGUE.filter((entry) => entry.sku === sku).map(
    (entry) => entry.supplierId,
  );
}

/**
 * Exposes the catalogue for the demo UI, without live prices or discounts.
 *
 * Those are paid information. Publishing them free would undercut the point
 * of the tier system.
 *
 * @returns entries safe to show without payment
 */
export function listCatalogue(): ReadonlyArray<{
  sku: string;
  description: string;
  supplierId: string;
  cachedPriceAtomic: string;
  cacheAgeHours: number;
}> {
  return CATALOGUE.map((entry) => ({
    sku: entry.sku,
    description: entry.description,
    supplierId: entry.supplierId,
    cachedPriceAtomic: entry.unitPriceAtomic,
    cacheAgeHours: entry.cacheAgeHours,
  }));
}