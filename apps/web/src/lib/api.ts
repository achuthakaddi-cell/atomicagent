/**
 * Orchestrator API client.
 *
 * Every call carries a hard timeout via AbortController. The judging criteria
 * call out "zero hangs", so no request may wait indefinitely, and a timeout is
 * always surfaced as a failure rather than an endless spinner.
 *
 * THE VERIFY ENDPOINT RETURNS THREE SHAPES
 * ----------------------------------------
 * Verification can end in one of three states, and the client must handle all
 * of them:
 *
 *   needsSignature   the agent escalated and wants approval for more spend
 *   readyToSettle    every check confirmed
 *   nothingSettled   refuted, or the budget cannot resolve the uncertainty
 */

import { env } from '../config/env.js';

/** Success envelope from every orchestrator endpoint. */
interface SuccessBody<T> {
  ok: true;
  data: T;
}

/** Failure envelope from every orchestrator endpoint. */
interface ErrorBody {
  ok: false;
  code: string;
  message: string;
  detail?: string;
}

/** The three checks. */
export type CheckId = 'price' | 'availability' | 'verification';

/** The three price points every check offers. */
export type Tier = 'shallow' | 'standard' | 'deep';

/** What a check can conclude. */
export type Confidence = 'confirmed' | 'ambiguous' | 'refuted';

/** One check's quote, as returned by the orchestrator. */
export interface CheckQuote {
  checkId: CheckId;
  feeAtomic: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
}

/** A verdict, including which tier produced it and how certain it is. */
export interface TieredVerdict {
  checkId: CheckId;
  tier: Tier;
  confidence: Confidence;
  certainty: number;
  passed: boolean;
  reason: string;
  /** What a deeper tier would resolve, when this one was ambiguous. */
  wouldResolve: string | null;
  detailHash: string;
}

/** One decision the agent made about money, with its written rationale. */
export interface SpendDecision {
  checkId: string;
  tier: Tier;
  feeAtomic: string;
  /** Why the agent chose this. Displayed verbatim. */
  rationale: string;
  remainingAtomic: string;
  escalated: boolean;
}

/** The agent's spending policy. */
export interface SpendPolicy {
  budgetAtomic: string;
  escalateBelow: number;
  maxPerCheckFraction: number;
  reserveFraction: number;
}

/** The full audit trail for a run. */
export interface SpendLedger {
  policy: SpendPolicy;
  decisions: SpendDecision[];
  spentAtomic: string;
  remainingAtomic: string;
  rounds: number;
}

/** Where each transaction sits in the atomic group. */
export interface GroupLayout {
  feePayer: number;
  price: number;
  availability: number;
  verification: number;
  order: number;
}

/** Asset metadata for display. */
export interface AssetInfo {
  id: string;
  decimals: number;
  symbol: string;
}

/** A round that needs the user's signature, whether the first or an escalation. */
export interface SignatureRequest {
  runId: string;
  round: number;
  needsSignature: true;
  tiers: Record<CheckId, Tier>;
  quotes: CheckQuote[];
  totalFeesAtomic: string;
  orderTotalAtomic: string;
  grandTotalAtomic: string;
  asset: AssetInfo;
  unsignedGroup: string[];
  groupLayout: GroupLayout;
  ledger: SpendLedger;
  verdicts: TieredVerdict[];
}

/** Every check confirmed. The run may settle. */
export interface ReadyToSettle {
  runId: string;
  round: number;
  needsSignature: false;
  readyToSettle: true;
  verdicts: TieredVerdict[];
  tiers: Record<CheckId, Tier>;
  ledger: SpendLedger;
}

/** The run cannot proceed. Nothing was submitted. */
export interface AbortResult {
  runId: string;
  round: number;
  needsSignature: false;
  readyToSettle: false;
  nothingSettled: true;
  failedChecks: string[];
  verdicts: TieredVerdict[];
  reason: string;
  ledger: SpendLedger;
}

/** Any of the three verify outcomes. */
export type VerifyOutcome = SignatureRequest | ReadyToSettle | AbortResult;

/** Response to settle. */
export interface SettleResult {
  runId: string;
  txId: string;
  explorerUrl: string;
  verdicts: TieredVerdict[];
  tiers: Record<CheckId, Tier>;
  totalPaidAtomic: string;
  ledger: SpendLedger;
}

/** What the sourcing form produces. */
export interface SourcingRequest {
  sku: string;
  quantity: number;
  maxUnitPriceAtomic: string;
  requiredBy: string;
  supplierId: string;
}

/** An error carrying the orchestrator's machine-readable code. */
export class ApiError extends Error {
  readonly code: string;
  readonly detail: string | undefined;

  /**
   * @param code - stable error code from the orchestrator
   * @param message - human-readable message
   * @param detail - optional extra context
   */
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * POSTs JSON to the orchestrator with a hard timeout.
 *
 * @param pathname - route to call
 * @param body - JSON body
 * @param timeoutMs - hard ceiling for the request
 * @returns the parsed data payload
 * @throws ApiError on failure, timeout, or a non-ok envelope
 */
async function post<T>(
  pathname: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(env.orchestratorUrl + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: unknown;

    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError(
        'BAD_RESPONSE',
        'The orchestrator returned an unreadable response',
        text.slice(0, 120),
      );
    }

    const envelope = parsed as SuccessBody<T> | ErrorBody;

    if (envelope.ok !== true) {
      const failure = envelope as ErrorBody;
      throw new ApiError(
        failure.code ?? 'UNKNOWN',
        failure.message ?? 'Request failed',
        failure.detail,
      );
    }

    return envelope.data;
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;

    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new ApiError(
        'TIMEOUT',
        'The orchestrator did not respond in time',
        'timed out after ' + String(timeoutMs) + 'ms',
      );
    }

    throw new ApiError(
      'UNREACHABLE',
      'Could not reach the orchestrator',
      cause instanceof Error ? cause.message : 'unknown error',
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Collects quotes and builds the group at shallow tiers.
 *
 * @param request - what the buyer wants to source
 * @param buyerAddress - the connected wallet
 * @returns the first signature request
 */
export async function requestQuote(
  request: SourcingRequest,
  buyerAddress: string,
): Promise<SignatureRequest> {
  return post<SignatureRequest>(
    '/api/runs/quote',
    { request, buyerAddress },
    20_000,
  );
}

/**
 * Sends the signed group for verification.
 *
 * The response is one of three shapes. Neither an escalation nor an abort is
 * an error: the agent did its job in both cases.
 *
 * @param runId - the run
 * @param signedGroup - base64 transactions in slot order
 * @returns a signature request, a ready-to-settle, or an abort
 */
export async function requestVerify(
  runId: string,
  signedGroup: string[],
): Promise<VerifyOutcome> {
  // Deep checks take up to 2.6 seconds each and run in parallel, so the
  // ceiling here is generous.
  return post<VerifyOutcome>(
    '/api/runs/' + runId + '/verify',
    { signedGroup },
    40_000,
  );
}

/**
 * Settles the group. Only reachable when every check confirmed.
 *
 * @param runId - the run
 * @returns the transaction id and explorer link
 */
export async function requestSettle(runId: string): Promise<SettleResult> {
  return post<SettleResult>('/api/runs/' + runId + '/settle', {}, 40_000);
}

/**
 * Whether a verify outcome is asking for another signature.
 *
 * @param outcome - the verify response
 * @returns true if the agent escalated
 */
export function needsSignature(
  outcome: VerifyOutcome,
): outcome is SignatureRequest {
  return outcome.needsSignature === true;
}

/**
 * Whether a verify outcome aborted the run.
 *
 * @param outcome - the verify response
 * @returns true if nothing will be settled
 */
export function isAbort(outcome: VerifyOutcome): outcome is AbortResult {
  return outcome.needsSignature === false && outcome.readyToSettle === false;
}