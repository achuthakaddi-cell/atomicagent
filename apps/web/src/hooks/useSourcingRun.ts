/**
 * The hook that drives a complete run, including escalation.
 *
 * quote -> sign -> verify -> [escalate -> sign -> verify]* -> settle
 *
 * The loop is the new part. When the agent decides a cheap answer is too
 * uncertain, the orchestrator rebuilds the group at a higher tier and returns
 * it for a fresh signature. The user approves the extra spend, the group is
 * verified again, and the cycle repeats until every check confirms or the
 * budget runs out.
 *
 * WHY THE USER SIGNS AGAIN
 * ------------------------
 * Changing a tier changes an amount, which changes the group. Pre-authorising
 * a maximum would let the agent spend money the user never specifically
 * approved, which is the model this project argues against. Asking again is
 * both more honest and more legible: the judge watches consent being given.
 *
 * SLOT 0 IS NEVER SIGNED HERE
 * ---------------------------
 * indexesToSign is [1,2,3,4]. Slot 0 is the facilitator's fee payer and must
 * arrive unsigned so the facilitator can sign it and cover every fee. That is
 * why the buyer pays zero ALGO.
 */

import { useCallback, useMemo } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import { useRunStore } from '../store/useRunStore.js';
import { createDevSigner, createWalletSigner, devSignerMnemonic } from '../lib/signer.js';
import type { Signer } from '../lib/signer.js';
import { ApiError } from '../lib/api.js';
import { isAbort, needsSignature } from '../lib/api.js';
import { requestQuote, requestSettle, requestVerify } from '../lib/api.js';
import type { SignatureRequest, SourcingRequest } from '../lib/api.js';

/** Ceiling on escalation rounds, mirroring the orchestrator's own limit. */
const MAX_ROUNDS = 4;

/** How long to hold the settling phase, so the binding animation lands. */
const MINIMUM_SETTLE_MS = 3_200;

/** What the hook exposes to components. */
export interface SourcingRun {
  /** Starts a run and drives it to settlement or abort. */
  start: (request: SourcingRequest) => Promise<void>;
  /** Clears state so another run can begin. */
  reset: () => void;
  /** Which signer is in use, for display. */
  signerLabel: string | null;
  /** Whether a run can start right now. */
  canStart: boolean;
}

/**
 * Drives a sourcing run from input to settlement.
 *
 * @returns the run controls
 */
export function useSourcingRun(): SourcingRun {
  const { activeAddress, activeWallet, signTransactions } = useWallet();
  const store = useRunStore();

  /**
   * Chooses a signer.
   *
   * The wallet is preferred whenever one is connected. The dev signer is only
   * reachable when no wallet is present AND an explicit env flag is set, so it
   * can never silently replace a real signature.
   */
  const signer = useMemo<Signer | null>(() => {
    if (activeAddress) {
      return createWalletSigner(
        signTransactions as never,
        activeWallet?.metadata.name ?? 'Wallet',
      );
    }

    const mnemonic = devSignerMnemonic();
    if (mnemonic) {
      try {
        return createDevSigner(mnemonic);
      } catch {
        return null;
      }
    }

    return null;
  }, [activeAddress, activeWallet, signTransactions]);

  const buyerAddress = activeAddress;

  const start = useCallback(
    async (request: SourcingRequest): Promise<void> => {
      if (!signer) {
        store.fail('No signer available', 'Connect a wallet to continue.');
        return;
      }

      if (!buyerAddress) {
        store.fail('No wallet connected', 'Connect a TestNet wallet to continue.');
        return;
      }

      store.beginQuote(request);

      // ---- 1. Quote. Opens at the cheapest tier. ----
      let pending: SignatureRequest;

      try {
        pending = await requestQuote(request, buyerAddress);
      } catch (cause) {
        const error = cause as ApiError;
        store.fail(error.message, error.detail);
        return;
      }

      store.applySignatureRequest(pending);

      // ---- 2. The escalation loop ----
      for (let round = 1; round <= MAX_ROUNDS; round += 1) {
        // A pause so the user reads the totals before their wallet opens.
        // Without it the prompt arrives before they have seen what they are
        // approving, which is a bad pattern in a payments interface.
        await new Promise((resolve) => setTimeout(resolve, round === 1 ? 600 : 1_100));

        store.beginSigning();

        let signedGroup: string[];

        try {
                    // Which slots to sign comes from the orchestrator, not a constant.
          // The group grows when external services register, and a hardcoded
          // [1,2,3,4] would leave the last slot unsigned — which fails at
          // settlement, after the user has already approved.
          const slotsToSign =
            pending.buyerSlots ??
            Array.from({ length: pending.unsignedGroup.length - 1 }, (_, i) => i + 1);

          signedGroup = await signer.sign(pending.unsignedGroup, slotsToSign);
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : 'Signing was cancelled';

          const declined =
            message.toLowerCase().includes('reject') ||
            message.toLowerCase().includes('cancel') ||
            message.toLowerCase().includes('denied');

          store.fail(
            declined ? 'Signing cancelled' : 'Could not sign the payment group',
            declined ? 'Nothing was sent. You can try again.' : message,
          );
          return;
        }

        store.applySignature(signedGroup);
        store.beginVerify();

        let outcome;

        try {
          outcome = await requestVerify(pending.runId, signedGroup);
        } catch (cause) {
          const error = cause as ApiError;
          store.fail(error.message, error.detail);
          return;
        }

        // ---- 2a. Aborted. Nothing was submitted. ----
        if (isAbort(outcome)) {
          // Hold briefly so the shatter animation is visible.
          await new Promise((resolve) => setTimeout(resolve, 1_600));
          store.applyAbort(outcome);
          return;
        }

        // ---- 2b. The agent escalated. Sign again. ----
        if (needsSignature(outcome)) {
          store.beginEscalation();

          // Hold on the escalation state so the user can read the agent's
          // reasoning before the wallet prompt arrives. The rationale is the
          // most interesting thing on screen and it must not flash past.
          await new Promise((resolve) => setTimeout(resolve, 2_200));

          pending = outcome;
          store.applySignatureRequest(outcome);
          continue;
        }

        // ---- 2c. Every check confirmed. Settle. ----
        store.applyVerdicts(outcome.verdicts, outcome.ledger);
        store.beginSettle();

        // Settlement often completes faster than the binding animation, which
        // would cut it off mid-slam. We hold the phase for a minimum duration
        // so the moment lands. This delays the UI, never the chain: the
        // transaction is submitted the instant the request goes out.
        const settleStartedAt = Date.now();

        try {
          const settled = await requestSettle(pending.runId);

          const remaining = MINIMUM_SETTLE_MS - (Date.now() - settleStartedAt);
          if (remaining > 0) {
            await new Promise((resolve) => setTimeout(resolve, remaining));
          }

          store.applySettlement(settled);
        } catch (cause) {
          const error = cause as ApiError;
          store.fail(error.message, error.detail);
        }

        return;
      }

      // Loop exhausted without resolution. The orchestrator caps rounds too,
      // so reaching here means something is wrong rather than merely uncertain.
      store.fail(
        'Escalation limit reached',
        'The agent could not resolve every check within ' + String(MAX_ROUNDS) + ' rounds.',
      );
    },
    [signer, buyerAddress, store],
  );

  return {
    start,
    reset: store.reset,
    signerLabel: signer?.label ?? null,
    canStart: signer !== null && buyerAddress !== null,
  };
}