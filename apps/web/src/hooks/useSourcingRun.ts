/**
 * The hook that drives a complete run.
 *
 * quote -> sign -> verify -> settle, with the settle gate enforced here as well
 * as on the orchestrator. Two independent checks of the same rule is deliberate:
 * this one keeps the UI honest, and the server one keeps the money honest.
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
import { ApiError, isAbort, requestQuote, requestSettle, requestVerify } from '../lib/api.js';
import type { SourcingRequest } from '../lib/api.js';

/** Slots the buyer signs. Slot 0 belongs to the facilitator. */
const BUYER_SLOTS = [1, 2, 3, 4];

/** What the hook exposes to components. */
export interface SourcingRun {
  /** Starts a run. Handles every phase through to settlement or abort. */
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

  /**
   * The buyer's address.
   *
   * With a wallet it is the connected account. With the dev signer we cannot
   * read it from the wallet, so the caller supplies it via the form.
   */
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

      // ---- 1. Quote ----
      let quote;
      try {
        quote = await requestQuote(request, buyerAddress);
      } catch (cause) {
        const error = cause as ApiError;
        store.fail(error.message, error.detail);
        return;
      }

      store.applyQuote(quote);

      // ---- 2. Sign ----
      //
      // A brief pause so the user sees the totals before their wallet opens.
      // Without it the signing prompt appears before they have read what they
      // are approving, which is a bad pattern in a payments interface.
      await new Promise((resolve) => setTimeout(resolve, 600));

      store.beginSigning();

      let signedGroup: string[];
      try {
        signedGroup = await signer.sign(quote.unsignedGroup, BUYER_SLOTS);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'Signing was cancelled';

        // A user declining is not an error worth alarming them about.
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

      // ---- 3. Verify ----
      store.beginVerify();

      let verified;
      try {
        verified = await requestVerify(quote.runId, signedGroup);
      } catch (cause) {
        const error = cause as ApiError;
        store.fail(error.message, error.detail);
        return;
      }

      // ---- 4a. Abort. Nothing was submitted. ----
      if (isAbort(verified)) {
        store.applyAbort(verified);
        return;
      }

      store.applyVerdicts(verified.verdicts);

      // ---- The gate ----
      //
      // Re-checked here even though the orchestrator already enforced it. If
      // this ever disagrees with the server we want the UI to refuse, not to
      // optimistically request a settlement the server will reject.
      const everyCheckPassed =
        verified.verdicts.length === 3 &&
        verified.verdicts.every((verdict) => verdict.passed);

      if (!everyCheckPassed) {
        store.applyAbort({
          runId: quote.runId,
          failedChecks: verified.verdicts
            .filter((verdict) => !verdict.passed)
            .map((verdict) => verdict.checkId),
          verdicts: verified.verdicts,
          nothingSettled: true,
          reason: 'Not every check passed',
        });
        return;
      }

      // ---- 4b. Settle ----
      store.beginSettle();

      try {
        const settled = await requestSettle(quote.runId);
        store.applySettlement(settled);
      } catch (cause) {
        const error = cause as ApiError;
        store.fail(error.message, error.detail);
      }
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