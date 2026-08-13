/**
 * The business logic behind the seller-verification check.
 *
 * Four independent conditions must ALL hold:
 *   1. the seller exists in the registry
 *   2. GST registration is active, not suspended or cancelled
 *   3. the trade licence has not expired
 *   4. open disputes are below the acceptable threshold
 *
 * Each failure produces a distinct, specific reason. That matters for the
 * rollback screen: "seller not verified" is useless to an MSME, while
 * "GST registration suspended" tells them exactly what to do.
 *
 * The registry is deterministic and in-memory, deliberately:
 *   1. A live demo must never depend on a third-party API being up.
 *   2. Judges need to trigger BOTH pass and fail paths on demand.
 *
 * Supplier coverage aligns with the price and stock services:
 *   SUP-BLR-011  fully verified          -> success path
 *   SUP-PUN-004  fully verified          -> success path
 *   SUP-DEL-902  GST suspended           -> rollback via verification
 *   SUP-CHN-330  licence expired         -> rollback, different reason
 *   SUP-HYD-517  too many open disputes  -> rollback, third reason
 */

/** GST registration states, mirroring the real Indian GST portal. */
type GstStatus = 'active' | 'suspended' | 'cancelled';

/** One seller record. */
interface SellerRecord {
  supplierId: string;
  legalName: string;
  gstin: string;
  gstStatus: GstStatus;
  /** Trade licence expiry, YYYY-MM-DD. */
  licenceExpiry: string;
  /** Unresolved disputes filed against this seller. */
  openDisputes: number;
  /** Completed orders on record. Context for the dispute count. */
  completedOrders: number;
  /** Year the business was registered. */
  registeredSince: number;
  city: string;
  /** When this record was last refreshed from source. */
  verifiedAt: string;
}

/** More than this many open disputes fails the check. */
const MAX_ACCEPTABLE_DISPUTES = 3;

const REGISTRY: readonly SellerRecord[] = [
  {
    supplierId: 'SUP-BLR-011',
    legalName: 'Peenya Metals & Alloys Pvt Ltd',
    gstin: '29AABCP1234M1Z5',
    gstStatus: 'active',
    licenceExpiry: '2027-03-31',
    openDisputes: 0,
    completedOrders: 1_847,
    registeredSince: 2011,
    city: 'Bengaluru',
    verifiedAt: '2026-08-12T04:00:00Z',
  },
  {
    supplierId: 'SUP-PUN-004',
    legalName: 'Chakan Precision Components LLP',
    gstin: '27AAFCC5678N1Z2',
    gstStatus: 'active',
    licenceExpiry: '2027-01-15',
    openDisputes: 1,
    completedOrders: 923,
    registeredSince: 2016,
    city: 'Pune',
    verifiedAt: '2026-08-12T04:00:00Z',
  },
  {
    supplierId: 'SUP-DEL-902',
    legalName: 'Northline Traders',
    gstin: '07AAGCN9012P1Z8',
    gstStatus: 'suspended',
    licenceExpiry: '2027-06-30',
    openDisputes: 2,
    completedOrders: 214,
    registeredSince: 2021,
    city: 'New Delhi',
    verifiedAt: '2026-08-12T04:00:00Z',
  },
  {
    supplierId: 'SUP-CHN-330',
    legalName: 'Coromandel Industrial Supply Co',
    gstin: '33AAHCC3456Q1Z4',
    gstStatus: 'active',
    // Expired. Fails on licence while GST is clean.
    licenceExpiry: '2026-05-31',
    openDisputes: 0,
    completedOrders: 612,
    registeredSince: 2014,
    city: 'Chennai',
    verifiedAt: '2026-08-12T04:00:00Z',
  },
  {
    supplierId: 'SUP-HYD-517',
    legalName: 'Deccan Fabrication Works',
    gstin: '36AAJCD7890R1Z1',
    gstStatus: 'active',
    licenceExpiry: '2027-09-30',
    // Above threshold. Fails on disputes while everything else is clean.
    openDisputes: 7,
    completedOrders: 388,
    registeredSince: 2019,
    city: 'Hyderabad',
    verifiedAt: '2026-08-12T04:00:00Z',
  },
];

/** What the verification check returns. */
export interface VerificationCheckResult {
  passed: boolean;
  reason: string;
  detail: {
    supplierId: string;
    legalName: string;
    gstin: string;
    gstStatus: GstStatus;
    licenceExpiry: string;
    licenceValid: boolean;
    openDisputes: number;
    disputesAcceptable: boolean;
    completedOrders: number;
    registeredSince: number;
    city: string;
    verifiedAt: string;
    checksRun: {
      registered: boolean;
      gstActive: boolean;
      licenceValid: boolean;
      disputesAcceptable: boolean;
    };
  } | null;
}

/**
 * Runs the seller-verification check.
 *
 * @param input - the sourcing request fields this check needs
 * @param input.supplierId - the supplier to verify
 * @param input.now - injectable clock, so tests and demos are reproducible
 * @returns pass/fail plus the full detail, which is withheld until settlement
 */
export function runVerificationCheck(input: {
  supplierId: string;
  now?: Date;
}): VerificationCheckResult {
  const record = REGISTRY.find(
    (candidate) => candidate.supplierId === input.supplierId,
  );

  if (!record) {
    return {
      passed: false,
      reason: `Supplier ${input.supplierId} is not in the seller registry.`,
      detail: null,
    };
  }

  const now = input.now ?? new Date();

  const gstActive = record.gstStatus === 'active';

  // A licence is valid through the whole of its expiry day.
  const licenceExpiryDate = new Date(`${record.licenceExpiry}T23:59:59Z`);
  const licenceValid = licenceExpiryDate.getTime() >= now.getTime();

  const disputesAcceptable = record.openDisputes <= MAX_ACCEPTABLE_DISPUTES;

  const passed = gstActive && licenceValid && disputesAcceptable;

  // Report the most serious problem first: GST beats licence beats disputes.
  let reason: string;
  if (!gstActive) {
    reason = `GST registration is ${record.gstStatus}, not active.`;
  } else if (!licenceValid) {
    reason = `Trade licence expired on ${record.licenceExpiry}.`;
  } else if (!disputesAcceptable) {
    reason = `${record.openDisputes} open disputes on record, above the limit of ${MAX_ACCEPTABLE_DISPUTES}.`;
  } else {
    reason = `Verified: GST active, licence valid to ${record.licenceExpiry}, ${record.openDisputes} open disputes.`;
  }

  return {
    passed,
    reason,
    detail: {
      supplierId: record.supplierId,
      legalName: record.legalName,
      gstin: record.gstin,
      gstStatus: record.gstStatus,
      licenceExpiry: record.licenceExpiry,
      licenceValid,
      openDisputes: record.openDisputes,
      disputesAcceptable,
      completedOrders: record.completedOrders,
      registeredSince: record.registeredSince,
      city: record.city,
      verifiedAt: record.verifiedAt,
      checksRun: {
        registered: true,
        gstActive,
        licenceValid,
        disputesAcceptable,
      },
    },
  };
}

/**
 * Exposes the registry for the demo UI, minus the GSTIN.
 *
 * A GSTIN is a real business identifier. Even with invented data, publishing
 * one from a free endpoint sets a bad precedent — so the public listing omits
 * it and only the paid, settled detail includes it.
 *
 * @returns registry entries safe to show without payment
 */
export function listSellers(): ReadonlyArray<Omit<SellerRecord, 'gstin'>> {
  return REGISTRY.map(({ gstin: _gstin, ...rest }) => rest);
}