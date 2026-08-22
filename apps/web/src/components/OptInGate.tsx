/**
 * Shown only when the connected wallet cannot receive the payment asset.
 *
 *   none              - render nothing
 *   not-opted-in      - explain, offer the one-click opt-in
 *   insufficient-algo - explain, offer the dispenser, no button
 *
 * A button that is guaranteed to fail is worse than no button.
 */

import { env, explorerTx } from '../config/env';
import { useAssetOptIn } from '../hooks/useAssetOptIn';
import { TESTNET_DISPENSER_URL, formatAlgo } from '../lib/optin';

interface OptInGateProps {
  assetId?: number;
  assetLabel?: string;
}

export function OptInGate({
  assetId = env.paymentAssetId,
  assetLabel = 'TestNet USDC',
}: OptInGateProps) {
  const { status, loading, optingIn, error, lastTxId, optIn } = useAssetOptIn(assetId);

  if (loading && !status) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
        Checking wallet...
      </div>
    );
  }

  if (!status || status.blocker === 'none') return null;

  const insufficient = status.blocker === 'insufficient-algo';

  return (
    <div
      className={
        insufficient
          ? 'rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-4'
          : 'rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-4'
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-white">
            {insufficient
              ? 'Not enough ALGO to hold ' + assetLabel
              : 'This wallet cannot receive ' + assetLabel + ' yet'}
          </p>
          <p className="text-sm leading-relaxed text-white/70">{status.message}</p>
          {!insufficient && (
            <p className="text-xs text-white/40">
              Asset {assetId} - costs {formatAlgo(status.optInCost)} ALGO, once
            </p>
          )}
        </div>

        {insufficient ? (
          
          <a
            href={TESTNET_DISPENSER_URL}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
          >
            Open dispenser
          </a>
        ) : (
          <button
            type="button"
            onClick={() => void optIn()}
            disabled={optingIn}
            className="shrink-0 rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            {optingIn ? 'Confirm in wallet...' : 'Opt in'}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {lastTxId && (
        
        <a
          href={explorerTx(lastTxId)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs text-white/50 underline underline-offset-2 hover:text-white/80"
        >
          Opt-in confirmed - view on Lora
        </a>
      )}
    </div>
  );
}
