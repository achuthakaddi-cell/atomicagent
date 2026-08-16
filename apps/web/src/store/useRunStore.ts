/**
 * The run state machine.
 *
 * A run moves through fixed phases and cannot skip or repeat one. The most
 * damaging bug this application could ship is settling a run whose checks did
 * not confirm, or settling twice. An explicit machine makes both structurally
 * impossible.
 *
 *   idle -> quoting -> awaiting_signature -> signing -> verifying -> settling
 *                            ^                              |
 *                            +------ escalation ------------+
 *
 * The escalation loop is the new part. When the agent decides a cheap answer is
 * too uncertain, the group is rebuilt at a higher tier and the run returns to
 * awaiting_signature for fresh approval.
 *
 * The store holds UI state only. The orchestrator holds the authoritative run
 * and re-checks the settle gate independently of anything this store believes.
 */

import { create } from 'zustand';
import type {
  AbortResult,
  AssetInfo,
  CheckId,
  CheckQuote,
  SettleResult,
  SignatureRequest,
  SourcingRequest,
  SpendLedger,
  Tier,
  TieredVerdict,
} from '../lib/api.js';

/** Every phase a run can be in. */
export type RunPhase =
  | 'idle'
  | 'quoting'
  | 'awaiting_signature'
  | 'signing'
  | 'verifying'
  | 'escalating'
  | 'settling'
  | 'settled'
  | 'aborted'
  | 'error';

/** Per-check display state, derived from the phase and any verdict received. */
export type CheckStatus =
  | 'idle'
  | 'quoted'
  | 'verifying'
  | 'confirmed'
  | 'ambiguous'
  | 'refuted';

/** The three checks in fixed order. Order defines the group slots. */
export const CHECK_IDS: readonly CheckId[] = ['price', 'availability', 'verification'];

/** An empty ledger, used before a run starts. */
const EMPTY_LEDGER: SpendLedger = {
  policy: {
    budgetAtomic: '500000',
    escalateBelow: 0.85,
    maxPerCheckFraction: 0.5,
    reserveFraction: 0.2,
  },
  decisions: [],
  spentAtomic: '0',
  remainingAtomic: '500000',
  rounds: 0,
};

/** Everything the UI needs to render a run. */
interface RunState {
  phase: RunPhase;

  runId: string | null;
  request: SourcingRequest | null;

  /** Which escalation round we are on. 1 is the opening round. */
  round: number;

  quotes: CheckQuote[];
  tiers: Record<CheckId, Tier>;
  unsignedGroup: string[];
  signedGroup: string[];

  totalFeesAtomic: string;
  orderTotalAtomic: string;
  grandTotalAtomic: string;
  asset: AssetInfo | null;

  verdicts: TieredVerdict[];
  failedChecks: string[];

  /** The agent's spend audit trail. */
  ledger: SpendLedger;

  txId: string | null;
  explorerUrl: string | null;
  totalPaidAtomic: string | null;

  abortReason: string | null;
  errorMessage: string | null;
  errorDetail: string | null;

  // ---- transitions ----
  beginQuote: (request: SourcingRequest) => void;
  applySignatureRequest: (result: SignatureRequest) => void;
  beginSigning: () => void;
  applySignature: (signedGroup: string[]) => void;
  beginVerify: () => void;
  beginEscalation: () => void;
  applyVerdicts: (verdicts: TieredVerdict[], ledger: SpendLedger) => void;
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
  round: 0,
  quotes: [] as CheckQuote[],
  tiers: {
    price: 'shallow' as Tier,
    availability: 'shallow' as Tier,
    verification: 'shallow' as Tier,
  },
  unsignedGroup: [] as string[],
  signedGroup: [] as string[],
  totalFeesAtomic: '0',
  orderTotalAtomic: '0',
  grandTotalAtomic: '0',
  asset: null,
  verdicts: [] as TieredVerdict[],
  failedChecks: [] as string[],
  ledger: EMPTY_LEDGER,
  txId: null,
  explorerUrl: null,
  totalPaidAtomic: null,
  abortReason: null,
  errorMessage: null,
  errorDetail: null,
};

export const useRunStore = create<RunState>((set) => ({
  ...initial,

  beginQuote: (request) => set({ ...initial, phase: 'quoting', request }),

  applySignatureRequest: (result) =>
    set({
      phase: 'awaiting_signature',
      runId: result.runId,
      round: result.round,
      quotes: result.quotes,
      tiers: result.tiers,
      unsignedGroup: result.unsignedGroup,
      totalFeesAtomic: result.totalFeesAtomic,
      orderTotalAtomic: result.orderTotalAtomic,
      grandTotalAtomic: result.grandTotalAtomic,
      asset: result.asset,
      ledger: result.ledger,
      // Verdicts from the previous round are kept, so the UI can show what
      // prompted the escalation while asking for the next signature.
      verdicts: result.verdicts,
    }),

  beginSigning: () => set({ phase: 'signing' }),

  applySignature: (signedGroup) => set({ signedGroup }),

  beginVerify: () => set({ phase: 'verifying' }),

  beginEscalation: () => set({ phase: 'escalating' }),

  applyVerdicts: (verdicts, ledger) => set({ verdicts, ledger }),

  applyAbort: (result) =>
    set({
      phase: 'aborted',
      verdicts: result.verdicts,
      failedChecks: result.failedChecks,
      abortReason: result.reason,
      ledger: result.ledger,
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
      tiers: result.tiers,
      totalPaidAtomic: result.totalPaidAtomic,
      ledger: result.ledger,
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
  verdicts: TieredVerdict[],
): CheckStatus {
  const verdict = verdicts.find((entry) => entry.checkId === checkId);

  if (verdict) return verdict.confidence;
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
    phase === 'escalating' ||
    phase === 'settling'
  );
}