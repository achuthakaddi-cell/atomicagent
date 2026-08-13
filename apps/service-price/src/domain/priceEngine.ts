/**
 * The business logic behind the price check.
 *
 * In production this would query a supplier ERP or a price feed. Here it is a
 * deterministic in-memory catalogue — deliberately, for two reasons:
 *
 *   1. A live demo must never depend on a third-party API being up.
 *   2. Judges need to be able to trigger BOTH the pass and the fail path on
 *      demand. Deterministic data makes the failure case reproducible.
 *
 * Nothing here is faked to look like something it isn't. It is a real check
 * against a real catalogue; only the catalogue's source is local.
 */

import { multiplyAtomicAmount } from '@atomicagent/shared';

/** One catalogue entry. All money values are atomic units, as digit strings. */
interface CatalogueEntry {
  sku: string;
  description: string;
  /** Unit price in atomic units of the payment asset. */
  unitPriceAtomic: string;
  /** Supplier offering this price. */
  supplierId: string;
  /** When this quote was last refreshed. */
  quotedAt: string;
}

/**
 * The catalogue.
 *
 * SKU-4471 is priced to PASS a typical demo ceiling.
 * SKU-9002 is priced HIGH so a judge can trigger the rollback path on demand.
 */
const CATALOGUE: readonly CatalogueEntry[] = [
  {
    sku: 'SKU-4471',
    description: 'Cold-rolled steel sheet, 1.2mm, 1250x2500',
    unitPriceAtomic: '4500000', // 4.50
    supplierId: 'SUP-BLR-011',
    quotedAt: '2026-08-12T09:00:00Z',
  },
  {
    sku: 'SKU-4472',
    description: 'Galvanised steel coil, 0.8mm',
    unitPriceAtomic: '3800000', // 3.80
    supplierId: 'SUP-BLR-011',
    quotedAt: '2026-08-12T09:00:00Z',
  },
  {
    sku: 'SKU-9002',
    description: 'Precision bearing assembly, grade 7',
    unitPriceAtomic: '82000000', // 82.00 — deliberately above typical ceilings
    supplierId: 'SUP-PUN-004',
    quotedAt: '2026-08-12T09:00:00Z',
  },
  {
    sku: 'SKU-3310',
    description: 'Industrial fastener set, M8, zinc plated',
    unitPriceAtomic: '150000', // 0.15
    supplierId: 'SUP-BLR-011',
    quotedAt: '2026-08-12T09:00:00Z',
  },
];

/** What the price check returns. */
export interface PriceCheckResult {
  passed: boolean;
  reason: string;
  detail: {
    sku: string;
    description: string;
    supplierId: string;
    quotedUnitPriceAtomic: string;
    maxUnitPriceAtomic: string;
    quantity: number;
    orderTotalAtomic: string;
    quotedAt: string;
  } | null;
}

/**
 * Runs the price check.
 *
 * Comparison uses BigInt, never floating point. A price comparison that is
 * wrong by one atomic unit is a wrong answer, and this check gates real money.
 *
 * @param input - the sourcing request fields this check needs
 * @param input.sku - product code to look up
 * @param input.quantity - number of units
 * @param input.maxUnitPriceAtomic - buyer's ceiling, atomic units
 * @param input.supplierId - supplier the buyer intends to order from
 * @returns pass/fail plus the full detail, which is withheld until settlement
 */
export function runPriceCheck(input: {
  sku: string;
  quantity: number;
  maxUnitPriceAtomic: string;
  supplierId: string;
}): PriceCheckResult {
  const entry = CATALOGUE.find(
    (candidate) =>
      candidate.sku === input.sku && candidate.supplierId === input.supplierId,
  );

  if (!entry) {
    return {
      passed: false,
      reason: `No price on file for ${input.sku} from supplier ${input.supplierId}.`,
      detail: null,
    };
  }

  const quoted = BigInt(entry.unitPriceAtomic);
  const ceiling = BigInt(input.maxUnitPriceAtomic);
  const withinCeiling = quoted <= ceiling;

  const orderTotalAtomic = multiplyAtomicAmount(
    entry.unitPriceAtomic,
    input.quantity,
  );

  return {
    passed: withinCeiling,
    reason: withinCeiling
      ? `Quoted unit price is within your ceiling.`
      : `Quoted unit price exceeds your ceiling.`,
    detail: {
      sku: entry.sku,
      description: entry.description,
      supplierId: entry.supplierId,
      quotedUnitPriceAtomic: entry.unitPriceAtomic,
      maxUnitPriceAtomic: input.maxUnitPriceAtomic,
      quantity: input.quantity,
      orderTotalAtomic,
      quotedAt: entry.quotedAt,
    },
  };
}

/**
 * Looks up a unit price without running the full check.
 *
 * The orchestrator calls this indirectly when sizing the order payment for
 * slot 4 of the atomic group.
 *
 * @param sku - product code
 * @param supplierId - supplier
 * @returns unit price in atomic units, or null if not stocked
 */
export function lookupUnitPrice(sku: string, supplierId: string): string | null {
  const entry = CATALOGUE.find(
    (candidate) => candidate.sku === sku && candidate.supplierId === supplierId,
  );
  return entry ? entry.unitPriceAtomic : null;
}

/**
 * Exposes the catalogue for the demo UI.
 *
 * @returns every SKU with its price, so the frontend can offer real choices
 */
export function listCatalogue(): readonly CatalogueEntry[] {
  return CATALOGUE;
}