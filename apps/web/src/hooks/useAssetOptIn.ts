/**
 * Wallet opt-in state for the payment asset.
 *
 * Checks on connect, exposes a one-click opt-in, re-checks after confirmation.
 * The UI branches entirely on status.blocker.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import { env } from '../config/env';
import { createWalletSigner } from '../lib/signer';
import { getOptInStatus, submitOptIn, type OptInStatus } from '../lib/optin';

export interface UseAssetOptIn {
  status: OptInStatus | null;
  loading: boolean;
  optingIn: boolean;
  error: string | null;
  lastTxId: string | null;
  refresh: () => Promise<void>;
  optIn: () => Promise<void>;
  /** True only when a wallet is connected and holds the asset. */
  ready: boolean;
}

/**
 * @param assetId - the asset to check, defaulting to the configured payment asset
 * @returns opt-in state and actions
 */
export function useAssetOptIn(assetId: number = env.paymentAssetId): UseAssetOptIn {
  const { activeAddress, activeWallet, algodClient, signTransactions } = useWallet();

  const [status, setStatus] = useState<OptInStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [optingIn, setOptingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTxId, setLastTxId] = useState<string | null>(null);

  const signer = useMemo(
    () => createWalletSigner(signTransactions, activeWallet?.metadata.name ?? 'Wallet'),
    [signTransactions, activeWallet],
  );

  const refresh = useCallback(async () => {
    if (!activeAddress || !algodClient) {
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setStatus(await getOptInStatus(algodClient, activeAddress, assetId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not read account state from the network.',
      );
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [activeAddress, algodClient, assetId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const optIn = useCallback(async () => {
    if (!activeAddress || !algodClient) return;
    setOptingIn(true);
    setError(null);
    setLastTxId(null);
    try {
      const result = await submitOptIn(algodClient, activeAddress, assetId, signer);
      if (result.ok) {
        setLastTxId(result.txId ?? null);
        await refresh();
      } else {
        setError(result.error ?? 'The opt-in did not complete.');
      }
    } finally {
      setOptingIn(false);
    }
  }, [activeAddress, algodClient, assetId, signer, refresh]);

  return {
    status,
    loading,
    optingIn,
    error,
    lastTxId,
    refresh,
    optIn,
    ready: Boolean(activeAddress) && Boolean(status?.optedIn),
  };
}