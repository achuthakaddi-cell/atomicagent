/**
 * Domain types for a sourcing run.
 *
 * A "run" is one complete journey: describe what you need, collect three
 * quotes, sign one transaction group, verify three checks, then either settle
 * once or abort with nothing spent.
 */

import { CHECK_IDS } from '../constants/pricing.js';

/** The three checks. Derived from the constant so they can never drift apart. */
export type CheckId = (typeof CHECK_IDS)[number];

/** What the MSME is trying to buy. */
export interface SourcingRequest {
  /** Supplier's product code, e.g. "SKU-4471". */
  sku: string;
  /** How many units. */
  quantity: number;
  /** Highest acceptable per-unit price, in atomic units of the payment asset. */
  maxUnitPriceAtomic: string;
  /** Delivery deadline as YYYY-MM-DD. */
  requiredBy: string;
  /** Which supplier to source from. */
  supplierId: string;
}

/** Phases of a run. The frontend state machine follows this exactly. */
export type RunPhase =
  /** Nothing started. */
  | 'idle'
  /** Collecting 402 challenges from the three services. */
  | 'quoting'
  /** Quotes in hand, group built, waiting for the wallet signature. */
  | 'awaiting_signature'
  /** Group signed, three checks running in parallel. */
  | 'verifying'
  /** All three passed, settling the group on Algorand. */
  | 'settling'
  /** Settled. Money moved exactly once. */
  | 'settled'
  /** A check failed or timed out. Nothing was submitted. Nothing was spent. */
  | 'aborted'
  /** Something broke before any payment could be constructed. */
  | 'error';

/** Per-check UI state. */
export type CheckStatus =
  | 'idle'
  | 'quoting'
  | 'quoted'
  | 'verifying'
  | 'passed'
  | 'failed'
  | 'timeout';

/** What one service charges, taken from its 402 response. */
export interface CheckQuote {
  checkId: CheckId;
  /** Fee in atomic units. */
  feeAtomic: string;
  /** Address that receives the fee. */
  payTo: string;
  /** ASA id of the payment asset. */
  asset: string;
  /** Seconds the quote stays valid. */
  maxTimeoutSeconds: number;
}

/**
 * A service's answer.
 *
 * On verify, a service returns only `passed`, `reason`, and `detailHash`.
 * The full `detail` payload is released after settlement — so an orchestrator
 * cannot harvest three answers and then refuse to pay.
 */
export interface CheckVerdict {
  checkId: CheckId;
  passed: boolean;
  /** Short human-readable explanation, shown in the UI on both paths. */
  reason: string;
  /** Hash of the withheld detail. Proves the answer wasn't changed later. */
  detailHash: string;
  /** Populated only after settlement. */
  detail?: Record<string, unknown>;
}

/** Response to "what will this cost?". No payment involved. */
export interface QuoteResult {
  runId: string;
  quotes: CheckQuote[];
  /** Sum of the three check fees, in atomic units. */
  totalFeesAtomic: string;
  /** quantity x unit price, in atomic units. */
  orderTotalAtomic: string;
  /** Fees plus order total. What the wallet will show. */
  grandTotalAtomic: string;
  /** Payment asset metadata for display. */
  asset: {
    id: string;
    decimals: number;
    symbol: string;
  };
  /** Base64 msgpack transactions, unsigned, ready for the wallet. */
  unsignedGroup: string[];
  /** Where each transaction sits in the group. */
  groupLayout: {
    feePayer: number;
    price: number;
    availability: number;
    verification: number;
    order: number;
  };
}

/** Response after the three checks have run. */
export interface VerifyResult {
  runId: string;
  verdicts: CheckVerdict[];
  /** True only if all three passed. Gates settlement. */
  allPassed: boolean;
  /** Which checks failed. Empty when allPassed is true. */
  failedChecks: CheckId[];
}

/** Response after a successful settlement. */
export interface SettleResult {
  runId: string;
  /** Algorand transaction id of the settled group. */
  txId: string;
  /** Link a judge can open to verify the claim. */
  explorerUrl: string;
  /** Round the group committed in. */
  confirmedRound?: number;
  /** Full details, released now that payment has landed. */
  verdicts: CheckVerdict[];
  /** What was actually paid, in atomic units. */
  totalPaidAtomic: string;
}

/** Response when a run is deliberately abandoned. */
export interface AbortResult {
  runId: string;
  /** Which checks failed. */
  failedChecks: CheckId[];
  verdicts: CheckVerdict[];
  /**
   * Always true. The signed group was never broadcast, so nothing exists
   * on chain to reverse. This is the claim the whole project is built on.
   */
  nothingSettled: true;
  /** Plain-language explanation for the rollback screen. */
  reason: string;
}

/** Successful envelope. Every endpoint returns this or an ErrorBody. */
export interface SuccessBody<T> {
  readonly ok: true;
  readonly data: T;
}

/**
 * Wraps a value in the success envelope.
 *
 * @param data - the payload
 * @returns the wrapped body
 */
export function ok<T>(data: T): SuccessBody<T> {
  return { ok: true, data };
}