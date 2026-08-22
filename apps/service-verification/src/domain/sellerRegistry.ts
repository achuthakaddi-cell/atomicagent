/**
 * The seller-verification check, at three tiers.
 *
 * WHAT CHANGED, AND WHY IT MATTERS
 * --------------------------------
 * This check previously read from a hardcoded fixture. The tier ladder had the
 * right shape but no substance behind it: "cached snapshot" versus "live
 * lookup" was simulated by which fields the code chose to reveal.
 *
 * Now the tiers do genuinely different work:
 *
 *   shallow   structural validation, offline. The GSTIN check digit is a
 *             base-36 Luhn, so a single altered character breaks it. Catches
 *             every typo and most invented numbers, with no network call.
 *
 *   standard  live registry lookup. Confirms the registration exists and
 *             returns its current status, legal name and registration date.
 *
 *   deep      live lookup plus supplier history — completed orders, dispute
 *             record, and how long we have traded with them.
 *
 * WHY THE SHALLOW TIER IS HONEST ABOUT ITS LIMITS
 * -----------------------------------------------
 * Passing the structure check means a number COULD exist. It does not mean it
 * does, or that it is still in force. Registrations get surrendered, cancelled
 * for non-filing, or suspended during proceedings — and a determined fraudster
 * can compute a valid check digit for a number never issued.
 *
 * That gap is precisely what the tier ladder prices, and it is why the agent's
 * escalation decision is a real one. A cheap answer that overstated its own
 * confidence would make the whole mechanism theatre.
 */

import { TIER_SPECS } from '@atomicagent/shared';
import type { Confidence, Tier, TierResult } from '@atomicagent/shared';
import { lookupLive, lookupStructural } from './gstRegistry.js';
import type { RegistryRecord } from './gstRegistry.js';

/**
 * Supplier trading history.
 *
 * This is OUR data, not the registry's — the orders we have placed and how they
 * went. A registry cannot tell you whether a supplier delivers; only trading
 * with them can. Kept separate from registry data so the distinction stays
 * clear in the response.
 */
interface SupplierHistory {
  supplierId: string;
  gstin: string;
  completedOrders: number;
  openDisputes: number;
  firstTradedYear: number;
  city: string;
  /** Licence expiry we hold on file from onboarding documents. */
  licenceExpiry: string;
}

/**
 * Suppliers we have traded with.
 *
 * The GSTINs are structurally valid and will pass the check digit. They are not
 * real registrations — using a real business's GSTIN in a demo would be
 * publishing their tax identity without consent, which is not a thing to do for
 * a hackathon.
 *
 * The registry lookup therefore returns "not found" for these in live mode,
 * which is itself informative: the check correctly reports that a
 * well-formed number has no registration behind it.
 */
const SUPPLIER_HISTORY: readonly SupplierHistory[] = [
  {
    supplierId: 'SUP-BLR-011',
    gstin: '29AABCP1234M1ZB',
    completedOrders: 1_847,
    openDisputes: 0,
    firstTradedYear: 2011,
    city: 'Bengaluru',
    licenceExpiry: '2027-03-31',
  },
  {
    supplierId: 'SUP-CHN-330',
    gstin: '33AAHCC3456Q1Z9',
    completedOrders: 612,
    openDisputes: 1,
    firstTradedYear: 2014,
    city: 'Chennai',
    licenceExpiry: '2027-08-31',
  },
  {
    supplierId: 'SUP-PUN-004',
    gstin: '27AAFCC5678N1ZY',
    completedOrders: 923,
    openDisputes: 5,
    firstTradedYear: 2016,
    city: 'Pune',
    licenceExpiry: '2027-01-15',
  },
  {
    supplierId: 'SUP-DEL-902',
    gstin: '07AAGCN9012P1Z0',
    completedOrders: 214,
    openDisputes: 2,
    firstTradedYear: 2021,
    city: 'New Delhi',
    licenceExpiry: '2027-06-30',
  },
  {
    supplierId: 'SUP-HYD-517',
    // Deliberately wrong check digit. Kept so the demo can show the cheap tier
    // catching an invented number for one paisa, and the agent correctly
    // refusing to escalate — paying more cannot make a fake GSTIN real.
    gstin: '36AAJCD7890R1ZG',
    completedOrders: 388,
    openDisputes: 7,
    firstTradedYear: 2019,
    city: 'Hyderabad',
    licenceExpiry: '2027-09-30',
  },
];

/** More than this many open disputes fails the check. */
const MAX_ACCEPTABLE_DISPUTES = 3;

/** What the verification check returns at whichever tier was paid for. */
export interface VerificationCheckResult extends TierResult {
  detail: {
    supplierId: string;
    gstin: string;
    tier: Tier;
    method: string;
    /** How the registry answer was obtained. Never hidden. */
    source: string;
    /** Structural findings — always available, they cost nothing. */
    structure: {
      valid: boolean;
      state: string | null;
      pan: string | null;
      entityType: string | null;
      checkDigitMatches: boolean;
    };
    /** Live registry findings, when a lookup succeeded. */
    registry: {
      status: string | null;
      legalName: string | null;
      tradeName: string | null;
      registeredOn: string | null;
      constitution: string | null;
      jurisdiction: string | null;
    } | null;
    /** Our own trading history, only at deep tier. */
    history: {
      completedOrders: number;
      openDisputes: number;
      firstTradedYear: number;
      licenceExpiry: string;
      licenceValid: boolean;
    } | null;
    city: string;
    lookupError: string | null;
  } | null;
}

/**
 * Runs the seller-verification check at the requested tier.
 *
 * @param input - the supplier plus the tier that was paid for
 * @returns the verdict, its certainty, and the withheld detail
 */
export async function runVerificationCheck(input: {
  supplierId: string;
  tier: Tier;
  now?: Date;
}): Promise<VerificationCheckResult> {
  const supplier = SUPPLIER_HISTORY.find(
    (candidate) => candidate.supplierId === input.supplierId,
  );

  if (!supplier) {
    return {
      tier: input.tier,
      confidence: 'refuted',
      certainty: 1,
      reason: 'Supplier ' + input.supplierId + ' is not on file.',
      detail: null,
    };
  }

  const spec = TIER_SPECS[input.tier];
  const now = input.now ?? new Date();

  // ---- what does this tier actually do? ----
  //
  // Shallow validates structure offline. Standard and deep query the registry.
  const record: RegistryRecord =
    input.tier === 'shallow'
      ? lookupStructural(supplier.gstin)
      : await lookupLive(supplier.gstin);

  // Only the deep tier retrieves our trading history.
  const history = input.tier === 'deep' ? supplier : null;

  const licenceExpiryDate = new Date(supplier.licenceExpiry + 'T23:59:59Z');
  const licenceValid = licenceExpiryDate.getTime() >= now.getTime();

  let confidence: Confidence;
  let certainty: number;
  let reason: string;
  let wouldResolve: string | undefined;

  // ---- structural failure is conclusive at any tier ----
  //
  // A number that cannot be a GSTIN is not registered anywhere, and no amount
  // of paying more will change that.
  if (!record.structure.valid) {
    confidence = 'refuted';
    certainty = 0.99;
    reason =
      'GSTIN failed structural validation: ' +
      (record.structure.failure ?? 'unknown fault') +
      ' No registry lookup is needed to rule this out.';
  }

  // ---- live registry says the registration is not active ----
  else if (record.source === 'live' && record.status && record.status !== 'Active') {
    confidence = 'refuted';
    certainty = spec.confidence;
    reason =
      'The registry reports this registration as ' + record.status +
      ', not Active.';
  }

  // ---- deep tier found too many disputes ----
  else if (history && history.openDisputes > MAX_ACCEPTABLE_DISPUTES) {
    confidence = 'refuted';
    certainty = 0.99;
    reason =
      history.openDisputes + ' open disputes on record, above the limit of ' +
      MAX_ACCEPTABLE_DISPUTES + '. Only a deep check surfaces trading history.';
  }

  // ---- deep tier found an expired licence ----
  else if (history && !licenceValid) {
    confidence = 'refuted';
    certainty = 0.99;
    reason = 'Trade licence expired on ' + supplier.licenceExpiry + '.';
  }

  // ---- shallow: structurally sound, but that is all it can say ----
  else if (input.tier === 'shallow') {
    confidence = 'ambiguous';
    certainty = 0.62;
    reason =
      'GSTIN is structurally valid — check digit correct, ' +
      (record.structure.state ?? 'state') + ' registration, PAN well-formed. ' +
      'That means the number could exist; it does not mean it does, or that it ' +
      'is still in force.';
    wouldResolve =
      'A live registry lookup would confirm the registration exists and is active.';
  }

    // ---- the live lookup could not be made, at deep tier ----
  //
  // The deep tier has more than the registry to go on: our own trading record
  // with this supplier. A firm we have traded with for years without dispute
  // does not become unverifiable because a government API is down.
  //
  // So we fall back to the evidence we hold, and state exactly what was and was
  // not checked. That is a defensible basis for proceeding — and materially
  // more honest than either refusing a long-standing supplier over someone
  // else's downtime, or quietly reporting a confirmation we did not receive.
  else if (record.source === 'live-failed' && history) {
    const trusted = history.completedOrders >= 100 && history.openDisputes === 0;

    if (trusted) {
      confidence = 'confirmed';
      // Below the 0.99 a live lookup earns. We are confident, not certain, and
      // the number should say so.
      certainty = 0.88;
      reason =
        'The live registry could not be reached, so this rests on evidence we ' +
        'hold: a structurally valid GSTIN, ' + history.completedOrders +
        ' completed orders with this supplier since ' + history.firstTradedYear +
        ', no open disputes, and a licence valid to ' + supplier.licenceExpiry +
        '. Registry status was not confirmed.';
    } else {
      confidence = 'ambiguous';
      certainty = 0.65;
      reason =
        'The live registry could not be reached, and our own record is not ' +
        'strong enough to stand in for it: ' + history.completedOrders +
        ' completed orders, ' + history.openDisputes + ' open disputes. ' +
        (record.lookupError ?? '');
      wouldResolve = 'Retrying when the registry is reachable would resolve this.';
    }
  }

  // ---- the live lookup could not be made, below deep tier ----
  //
  // No trading history at this tier to fall back on, so the honest answer is
  // that we do not know.
  else if (record.source === 'live-failed') {
    confidence = 'ambiguous';
    certainty = 0.6;
    reason =
      'Structural validation passed, but the live registry was not reached. ' +
      (record.lookupError ?? '');
    wouldResolve =
      'A deep check would weigh our own trading record with this supplier ' +
      'against the missing registry answer.';
  }

  // ---- standard: live and active, but no trading history ----
  else if (input.tier === 'standard') {
    confidence = 'ambiguous';
    certainty = 0.82;
    reason =
      'Registry confirms an active registration' +
      (record.legalName ? ' for ' + record.legalName : '') +
      '. Dispute history and licence validity are not visible at this tier.';
    wouldResolve =
      'A deep check adds our trading history: completed orders, open disputes ' +
      'and licence expiry.';
  }

  // ---- deep: everything checked, everything passed ----
  else {
    confidence = 'confirmed';
    certainty = spec.confidence;
    reason =
      'Registry confirms an active registration' +
      (record.legalName ? ' for ' + record.legalName : '') +
      (history
        ? ', with ' + history.completedOrders + ' completed orders, ' +
          history.openDisputes + ' open disputes, and a licence valid to ' +
          supplier.licenceExpiry
        : '') +
      '.';
  }

  const result: VerificationCheckResult = {
    tier: input.tier,
    confidence,
    certainty,
    reason,
    detail: {
      supplierId: supplier.supplierId,
      gstin: supplier.gstin,
      tier: input.tier,
      method: spec.method,
      source: record.source,
      structure: {
        valid: record.structure.valid,
        state: record.structure.state,
        pan: record.structure.pan,
        entityType: record.structure.entityType,
        checkDigitMatches:
          record.structure.checkDigit === record.structure.computedCheckDigit,
      },
      registry:
        record.source === 'live'
          ? {
              status: record.status,
              legalName: record.legalName,
              tradeName: record.tradeName,
              registeredOn: record.registeredOn,
              constitution: record.constitution,
              jurisdiction: record.jurisdiction,
            }
          : null,
      history: history
        ? {
            completedOrders: history.completedOrders,
            openDisputes: history.openDisputes,
            firstTradedYear: history.firstTradedYear,
            licenceExpiry: history.licenceExpiry,
            licenceValid,
          }
        : null,
      city: supplier.city,
      lookupError: record.lookupError,
    },
  };

  if (wouldResolve !== undefined) result.wouldResolve = wouldResolve;

  return result;
}

/**
 * Exposes the supplier list for the demo UI, minus the GSTIN and paid fields.
 *
 * A GSTIN identifies a business, and dispute history is paid information.
 * Publishing either from a free endpoint would undercut the tier system.
 *
 * @returns entries safe to show without payment
 */
export function listSellers(): ReadonlyArray<{
  supplierId: string;
  city: string;
  firstTradedYear: number;
}> {
  return SUPPLIER_HISTORY.map((entry) => ({
    supplierId: entry.supplierId,
    city: entry.city,
    firstTradedYear: entry.firstTradedYear,
  }));
}