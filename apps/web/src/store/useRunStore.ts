/**
 * The run state machine.
 *
 * A run moves through fixed phases and cannot skip or repeat one. The most
 * damaging bug this application could ship is settling a run whose checks
 * failed, or settling twice. Loose booleans make that a one-line mistake; an
 * explicit machine makes it structurally impossible.
 *
 *   idle -> quoting -> awaiting_signature -> verifying -> settling -> settled
 *                                                      \-> aborted
 *
 * The store holds UI state only. The orchestrator holds the authoritative run,
 * and re-checks the settle gate independently of anything this store believes.
 */

import { create } from 'zustand';
import type {
  AbortResult,
  CheckQuote,
  CheckVerdict,
  QuoteResult,
  SettleResult,
  SourcingRequest,
} from '../lib/api.js';

/** Every phase a run can be in. */
export type RunPhase =
  | 'idle'
  | 'quoting'
  | 'awaiting_signature'
  | 'signing'
  | 'verifying'
  | 'settling'
  | 'settled'
  | 'aborted'
  | 'error';

/** Per-check display state, driven by the phase and any verdict received. */
export type CheckStatus =
  | 'idle'
  | 'quoted'
  | 'verifying'
  | 'passed'
  | 'failed';

/** The three checks in fixed order. Order defines the group slots. */
export const CHECK_IDS = ['price', 'availability', 'verification'] as const;

/** Everything the UI needs to render a run. */
interface RunState {
  phase: RunPhase;

  runId: string | null;
  request: SourcingRequest | null;

  quotes: CheckQuote[];
  unsignedGroup: string[];
  signedGroup: string[];

  totalFeesAtomic: string;
  orderTotalAtomic: string;
  grandTotalAtomic: string;
  asset: { id: string; decimals: number; symbol: string } | null;

  verdicts: CheckVerdict[];
  failedChecks: string[];

  txId: string | null;
  explorerUrl: string | null;
  totalPaidAtomic: string | null;

  abortReason: string | null;
  errorMessage: string | null;
  errorDetail: string | null;

  // ---- transitions ----
  beginQuote: (request: SourcingRequest) => void;
  applyQuote: (result: QuoteResult) => void;
  beginSigning: () => void;
  applySignature: (signedGroup: string[]) => void;
  beginVerify: () => void;
  applyVerdicts: (verdicts: CheckVerdict[]) => void;
  applyAbort: (result: AbortResult) => void;
  beginSettle: () => void;
  applySettlement: (result: SettleResult) => void;
  fail: (message: string, detail?: string) => void;
  reset: () => void;
}

/** Fresh state for a new run. */
const initial = {
  phase: 'idle' as RunPhase,
  runId: null,
  request: null,
  quotes: [] as CheckQuote[],
  unsignedGroup: [] as string[],
  signedGroup: [] as string[],
  totalFeesAtomic: '0',
  orderTotalAtomic: '0',
  grandTotalAtomic: '0',
  asset: null,
  verdicts: [] as CheckVerdict[],
  failedChecks: [] as string[],
  txId: null,
  explorerUrl: null,
  totalPaidAtomic: null,
  abortReason: null,
  errorMessage: null,
  errorDetail: null,
};

export const useRunStore = create<RunState>((set) => ({
  ...initial,

  beginQuote: (request) =>
    set({ ...initial, phase: 'quoting', request }),

  applyQuote: (result) =>
    set({
      phase: 'awaiting_signature',
      runId: result.runId,
      quotes: result.quotes,
      unsignedGroup: result.unsignedGroup,
      totalFeesAtomic: result.totalFeesAtomic,
      orderTotalAtomic: result.orderTotalAtomic,
      grandTotalAtomic: result.grandTotalAtomic,
      asset: result.asset,
    }),

  beginSigning: () => set({ phase: 'signing' }),

  applySignature: (signedGroup) => set({ signedGroup }),

  beginVerify: () => set({ phase: 'verifying' }),

  applyVerdicts: (verdicts) => set({ verdicts }),

  applyAbort: (result) =>
    set({
      phase: 'aborted',
      verdicts: result.verdicts,
      failedChecks: result.failedChecks,
      abortReason: result.reason,
      // The signed group is discarded. It was never broadcast and never will
      // be; holding signatures with no purpose is careless.
      signedGroup: [],
    }),

  beginSettle: () => set({ phase: 'settling' }),

  applySettlement: (result) =>
    set({
      phase: 'settled',
      txId: result.txId,
      explorerUrl: result.explorerUrl,
      verdicts: result.verdicts,
      totalPaidAtomic: result.totalPaidAtomic,
      signedGroup: [],
    }),

  fail: (message, detail) =>
    set({
      phase: 'error',
      errorMessage: message,
      errorDetail: detail ?? null,
    }),

  reset: () => set({ ...initial }),
}));

/**
 * Derives one check's display status from the run.
 *
 * Kept as a pure function rather than stored state, so the two can never
 * disagree about what a card should show.
 *
 * @param phase - the run's current phase
 * @param checkId - which check
 * @param verdicts - verdicts received so far
 * @returns the status to render
 */
export function checkStatus(
  phase: RunPhase,
  checkId: string,
  verdicts: CheckVerdict[],
): CheckStatus {
  const verdict = verdicts.find((entry) => entry.checkId === checkId);

  if (verdict) return verdict.passed ? 'passed' : 'failed';
  if (phase === 'verifying') return 'verifying';
  if (phase === 'idle' || phase === 'quoting') return 'idle';

  return 'quoted';
}

/**
 * Whether a run has reached a terminal phase.
 *
 * @param phase - the phase to test
 * @returns true if nothing further will happen
 */
export function isTerminal(phase: RunPhase): boolean {
  return phase === 'settled' || phase === 'aborted' || phase === 'error';
}

/**
 * Whether the UI should be showing activity.
 *
 * @param phase - the phase to test
 * @returns true if work is in flight
 */
export function isBusy(phase: RunPhase): boolean {
  return (
    phase === 'quoting' ||
    phase === 'signing' ||
    phase === 'verifying' ||
    phase === 'settling'
  );
}