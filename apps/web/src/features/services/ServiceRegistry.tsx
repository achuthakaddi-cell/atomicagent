/**
 * Registering an arbitrary x402 service by URL.
 *
 * WHAT THIS PANEL DEMONSTRATES
 * ----------------------------
 * Paste any x402 endpoint. The orchestrator probes it, reads its 402 challenge,
 * and builds a payment slot from what it finds — the amount, the payee, the
 * asset, all learned at runtime. That service then joins the same atomic group
 * as the three built-in checks, and its refusal blocks settlement exactly like
 * theirs.
 *
 * No import, no config entry, no code written for any particular provider. That
 * is the difference between building against a protocol and wiring together
 * three endpoints you happen to own.
 *
 * WHY REJECTIONS ARE SHOWN IN FULL
 * --------------------------------
 * A service on the wrong network genuinely cannot join an Algorand group — one
 * group, one network, one asset, by the chain's rules rather than ours. Saying
 * exactly that is more useful than "registration failed", and it demonstrates
 * that the constraint is understood rather than worked around.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  discoverService,
  listServices,
  resetServices,
} from '../../lib/api.js';
import type { DiscoveredService } from '../../lib/api.js';
import { formatAmount, shortAddress } from '../../lib/format.js';

interface ServiceRegistryProps {
  assetSymbol: string;
  assetDecimals: number;
  /** Disabled while a run is in flight — the group is already built. */
  disabled: boolean;
}

export function ServiceRegistry({
  assetSymbol,
  assetDecimals,
  disabled,
}: ServiceRegistryProps) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [registered, setRegistered] = useState<DiscoveredService[]>([]);
  const [slotsRemaining, setSlotsRemaining] = useState(11);

  // Load what is already registered, so a page refresh does not appear to lose
  // services that the orchestrator still holds.
  useEffect(() => {
    let cancelled = false;

    listServices()
      .then((result) => {
        if (cancelled) return;
        setRegistered(result.registered);
        setSlotsRemaining(result.slotsRemaining);
      })
      .catch(() => {
        // A failure here is not worth surfacing: the panel simply starts empty.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Probes the URL and registers it if it can join the group.
   */
  const register = async (): Promise<void> => {
    if (url.trim().length === 0) return;

    setBusy(true);
    setMessage(null);
    setFailed(false);

    try {
      const result = await discoverService(url.trim());

      setMessage(result.message);
      setFailed(!result.ok);
      setRegistered(result.registered);

      if (result.slotsRemaining !== undefined) {
        setSlotsRemaining(result.slotsRemaining);
      }

      if (result.ok) setUrl('');
    } catch (cause) {
      setFailed(true);
      setMessage(
        cause instanceof Error ? cause.message : 'Could not reach the orchestrator',
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * Clears everything, so a presenter can demonstrate twice.
   */
  const reset = async (): Promise<void> => {
    setBusy(true);
    try {
      await resetServices();
      setRegistered([]);
      setMessage(null);
      setFailed(false);
    } catch {
      // Nothing useful to say if the reset itself fails.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full rounded border hairline bg-blueprint/50 p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-graphite">
          Register an x402 service
        </span>
        <span className="font-mono text-[9px] text-[var(--graphite-dim)]">
          {slotsRemaining} slots free
        </span>
      </div>

      <p className="mt-1.5 text-[11px] leading-snug text-[var(--graphite-dim)]">
        Paste any x402 endpoint. Its 402 challenge is read at runtime and it
        joins the same atomic group as the three checks above.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void register();
          }}
          placeholder="https://some-service.example.com/check"
          disabled={disabled || busy}
          className="flex-1 rounded border hairline bg-void/60 px-3 py-2 font-mono text-[11px] text-chalk placeholder:text-[var(--graphite-dim)] focus:border-[var(--pending)] focus:outline-none disabled:opacity-40"
        />

        <button
          type="button"
          onClick={() => void register()}
          disabled={disabled || busy || url.trim().length === 0}
          className="rounded border border-[var(--verify-dim)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-verify transition-colors duration-200 hover:border-verify hover:bg-verify/10 disabled:opacity-30"
        >
          {busy ? 'Probing' : 'Register'}
        </button>
      </div>

      {/* The result of the last probe, success or refusal. */}
      <AnimatePresence>
        {message && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 overflow-hidden text-[10px] leading-snug"
            style={{ color: failed ? 'var(--halt)' : 'var(--verify)' }}
          >
            {message}
          </motion.p>
        )}
      </AnimatePresence>

      {/* What is currently registered. */}
      {registered.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t hairline pt-3">
          {registered.map((service) => (
            <motion.div
              key={service.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="rounded border border-[var(--pending)] bg-[var(--pending)]/5 px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[10px] text-chalk">
                  {service.url}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-[var(--graphite-dim)]">
                  slot {service.paymentIndex}
                </span>
              </div>

              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="font-mono text-[9px] text-[var(--graphite-dim)]">
                  pays {shortAddress(service.chosen.payTo)}
                </span>
                <span className="tabular font-mono text-[10px] text-brass">
                  {formatAmount(service.chosen.amount, assetDecimals, 3)}{' '}
                  {assetSymbol}
                </span>
              </div>

              {service.description && (
                <p className="mt-1 text-[9px] leading-snug text-graphite">
                  {service.description}
                </p>
              )}
            </motion.div>
          ))}

          <button
            type="button"
            onClick={() => void reset()}
            disabled={disabled || busy}
            className="mt-1 w-full rounded border hairline py-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--graphite-dim)] transition-colors duration-200 hover:border-[var(--halt-dim)] hover:text-halt disabled:opacity-30"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}