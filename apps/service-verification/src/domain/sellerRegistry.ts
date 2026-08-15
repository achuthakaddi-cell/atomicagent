/**
 * The seller-verification check, at three tiers.
 *
 * WHY TIERS MATTER HERE
 * ---------------------
 * Registry data has a natural depth ladder:
 *
 *   shallow   a cached registry snapshot, which may predate a recent change
 *   standard  a live registry lookup: GST status and licence validity now
 *   deep      live lookup plus dispute history, filings, and director checks
 *
 * A cached snapshot genuinely cannot tell you whether a GST registration was
 * suspended this week. Saying so honestly is more useful than guessing, and it
 * is what makes the agent's escalation decision real rather than theatre.
 */

import { TIER_SPECS } from '@atomicagent/shared';
import type { Confidence, Tier, TierResult } from '@atomicagent/shared';

/** GST registration states, mirroring the real Indian GST portal. */
type GstStatus = 'active' | 'suspended' | 'cancelled';

/** One seller record. */
interface SellerRecord {
  supplierId: string;
  legalName: string;
  gstin: string;
  /** What the cached snapshot says. A shallow check sees only this. */
  cachedGstStatus: GstStatus;
  /** Hours since the snapshot. Higher means less trustworthy. */
  cacheAgeHours: number;
  /** Live status. Standard and deep see this. */
  liveGstStatus: GstStatus;
  licenceExpiry: string;
  /** Unresolved disputes. Only a deep check retrieves these. */
  openDisputes: number;
  /** Adverse filings. Only a deep check retrieves these. */
  adverseFilings: number;
  completedOrders: number;
  registeredSince: number;
  city: string;
}

/** More than this many open disputes fails the check. */
const MAX_ACCEPTABLE_DISPUTES = 3;

const REGISTRY: readonly SellerRecord[] = [
  {
    supplierId: 'SUP-BLR-011',
    legalName: 'Peenya Metals & Alloys Pvt Ltd',
    gstin: '29AABCP1234M1Z5',
    cachedGstStatus: 'active',
    cacheAgeHours: 2,
    liveGstStatus: 'active',
    licenceExpiry: '2027-03-31',
    openDisputes: 0,
    adverseFilings: 0,
    completedOrders: 1_847,
    registeredSince: 2011,
    city: 'Bengaluru',
  },
  {
    supplierId: 'SUP-CHN-330',
    legalName: 'Coromandel Industrial Supply Co',
    gstin: '33AAHCC3456Q1Z4',
    // The cache says active. It was suspended eleven hours ago.
    cachedGstStatus: 'active',
    cacheAgeHours: 19,
    liveGstStatus: 'suspended',
    licenceExpiry: '2027-08-31',
    openDisputes: 1,
    adverseFilings: 0,
    completedOrders: 612,
    registeredSince: 2014,
    city: 'Chennai',
  },
  {
    supplierId: 'SUP-PUN-004',
    legalName: 'Chakan Precision Components LLP',
    cachedGstStatus: 'active',
    cacheAgeHours: 3,
    liveGstStatus: 'active',
    gstin: '27AAFCC5678N1Z2',
    licenceExpiry: '2027-01-15',
    // Clean on GST and licence, but a deep check finds the dispute history.
    openDisputes: 5,
    adverseFilings: 2,
    completedOrders: 923,
    registeredSince: 2016,
    city: 'Pune',
  },
  {
    supplierId: 'SUP-DEL-902',
    legalName: 'Northline Traders',
    gstin: '07AAGCN9012P1Z8',
    cachedGstStatus: 'suspended',
    cacheAgeHours: 4,
    liveGstStatus: 'suspended',
    licenceExpiry: '2027-06-30',
    openDisputes: 2,
    adverseFilings: 1,
    completedOrders: 214,
    registeredSince: 2021,
    city: 'New Delhi',
  },
  {
    supplierId: 'SUP-HYD-517',
    legalName: 'Deccan Fabrication Works',
    gstin: '36AAJCD7890R1Z1',
    cachedGstStatus: 'active',
    cacheAgeHours: 5,
    liveGstStatus: 'active',
    licenceExpiry: '2027-09-30',
    openDisputes: 7,
    adverseFilings: 3,
    completedOrders: 388,
    registeredSince: 2019,
    city: 'Hyderabad',
  },
];

/** What the verification check returns at whichever tier was paid for. */
export interface VerificationCheckResult extends TierResult {
  detail: {
    supplierId: string;
    legalName: string;
    gstin: string;
    tier: Tier;
    method: string;
    gstStatus: GstStatus;
    licenceExpiry: string;
    licenceValid: boolean;
    openDisputes: number | null;
    adverseFilings: number | null;
    completedOrders: number;
    registeredSince: number;
    city: string;
    cacheAgeHours: number | null;
  } | null;
}

/**
 * Runs the seller-verification check at the requested tier.
 *
 * @param input - the supplier plus the tier that was paid for
 * @returns the verdict, its certainty, and the withheld detail
 */
export function runVerificationCheck(input: {
  supplierId: string;
  tier: Tier;
  now?: Date;
}): VerificationCheckResult {
  const record = REGISTRY.find(
    (candidate) => candidate.supplierId === input.supplierId,
  );

  if (!record) {
    return {
      tier: input.tier,
      confidence: 'refuted',
      certainty: 1,
      reason: 'Supplier ' + input.supplierId + ' is not in the seller registry.',
      detail: null,
    };
  }

  const spec = TIER_SPECS[input.tier];
  const now = input.now ?? new Date();

  // ---- what does this tier actually see? ----
  const gstStatus =
    input.tier === 'shallow' ? record.cachedGstStatus : record.liveGstStatus;

  // Only a deep check retrieves dispute history and filings.
  const disputes = input.tier === 'deep' ? record.openDisputes : null;
  const filings = input.tier === 'deep' ? record.adverseFilings : null;

  const licenceExpiryDate = new Date(record.licenceExpiry + 'T23:59:59Z');
  const licenceValid = licenceExpiryDate.getTime() >= now.getTime();

  let confidence: Confidence;
  let certainty: number;
  let reason: string;
  let wouldResolve: string | undefined;

  if (gstStatus !== 'active') {
    confidence = 'refuted';
    certainty = spec.confidence;
    reason =
      'GST registration is ' + gstStatus + ', not active, per ' + spec.method + '.';
  } else if (!licenceValid) {
    confidence = 'refuted';
    certainty = spec.confidence;
    reason = 'Trade licence expired on ' + record.licenceExpiry + '.';
  } else if (disputes !== null && disputes > MAX_ACCEPTABLE_DISPUTES) {
    confidence = 'refuted';
    certainty = 0.99;
    reason =
      disputes + ' open disputes on record, above the limit of ' +
      MAX_ACCEPTABLE_DISPUTES + '. Only a deep check surfaces this.';
  } else if (input.tier === 'shallow' && record.cacheAgeHours > 6) {
    // The interesting case. The snapshot is old enough that a registration
    // change could have happened since, so we say so rather than pretending.
    confidence = 'ambiguous';
    certainty = 0.58;
    reason =
      'Cached registry snapshot is ' + record.cacheAgeHours +
      ' hours old and showed GST active. Status changes since then are not ' +
      'visible at this tier.';
    wouldResolve = 'A live registry lookup would confirm current GST status.';
  } else if (input.tier === 'standard') {
    // A standard check confirms GST and licence but cannot see litigation.
    confidence = 'ambiguous';
    certainty = 0.8;
    reason =
      'GST active and licence valid to ' + record.licenceExpiry +
      ', but dispute history and adverse filings are not visible at this tier.';
    wouldResolve = 'A deep check retrieves dispute history and adverse filings.';
  } else {
    confidence = 'confirmed';
    certainty = spec.confidence;
    reason =
      'Verified by ' + spec.method + ': GST active, licence valid to ' +
      record.licenceExpiry +
      (disputes !== null ? ', ' + disputes + ' open disputes' : '') +
      (filings !== null ? ', ' + filings + ' adverse filings' : '') + '.';
  }

  const result: VerificationCheckResult = {
    tier: input.tier,
    confidence,
    certainty,
    reason,
    detail: {
      supplierId: record.supplierId,
      legalName: record.legalName,
      gstin: record.gstin,
      tier: input.tier,
      method: spec.method,
      gstStatus,
      licenceExpiry: record.licenceExpiry,
      licenceValid,
      openDisputes: disputes,
      adverseFilings: filings,
      completedOrders: record.completedOrders,
      registeredSince: record.registeredSince,
      city: record.city,
      cacheAgeHours: input.tier === 'shallow' ? record.cacheAgeHours : null,
    },
  };

  if (wouldResolve !== undefined) result.wouldResolve = wouldResolve;

  return result;
}

/**
 * Exposes the registry for the demo UI, minus the GSTIN and paid fields.
 *
 * A GSTIN is a real business identifier, and dispute history is paid
 * information. Publishing either from a free endpoint would undercut the tier
 * system and set a bad precedent.
 *
 * @returns entries safe to show without payment
 */
export function listSellers(): ReadonlyArray<{
  supplierId: string;
  legalName: string;
  city: string;
  registeredSince: number;
  completedOrders: number;
}> {
  return REGISTRY.map((entry) => ({
    supplierId: entry.supplierId,
    legalName: entry.legalName,
    city: entry.city,
    registeredSince: entry.registeredSince,
    completedOrders: entry.completedOrders,
  }));
}