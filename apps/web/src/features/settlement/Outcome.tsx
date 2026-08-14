/**
 * The settled and aborted screens.
 *
 * Both get equal weight. A judge is likely to trigger the failure path
 * deliberately, and the rollback screen is where the project's central claim
 * is actually made — so it is designed as carefully as the success one.
 */

import { motion } from 'motion/react';
import { formatAmount, shortHash } from '../../lib/format.js';

interface SettledProps {
  txId: string;
  explorerUrl: string;
  totalPaidAtomic: string;
  assetSymbol: string;
  assetDecimals: number;
  onReset: () => void;
}

export function Settled({
  txId,
  explorerUrl,
  totalPaidAtomic,
  assetSymbol,
  assetDecimals,
  onReset,
}: SettledProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-lg rounded border border-[var(--brass-dim)] bg-brass/5 p-6"
    >
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[15px] font-extrabold uppercase tracking-tightest text-brass">
          Settled
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--graphite-dim)]">
          one group · one block
        </span>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-graphite">
        Five transactions committed together. Three verification fees and the
        order payment moved as one indivisible event.
      </p>

      <div className="mt-5 space-y-2 border-t hairline pt-4">
        <Row label="Total paid">
          <span className="tabular font-mono text-[13px] text-chalk">
            {formatAmount(totalPaidAtomic, assetDecimals)} {assetSymbol}
          </span>
        </Row>
        <Row label="Network fee">
          <span className="tabular font-mono text-[13px] text-verify">0 ALGO</span>
        </Row>
        <Row label="Transaction">
          <span className="font-mono text-[12px] text-graphite">
            {shortHash(txId)}
          </span>
        </Row>
      </div>

      <div className="mt-5 flex gap-3">
        <motion.a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex-1 rounded border border-[var(--brass-dim)] py-2.5 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-brass transition-colors duration-200 hover:border-brass hover:bg-brass/10"
        >
          Verify on explorer
        </motion.a>

        <motion.button
          type="button"
          onClick={onReset}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="rounded border hairline px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite transition-colors duration-200 hover:border-[var(--graphite-dim)] hover:text-chalk"
        >
          New run
        </motion.button>
      </div>
    </motion.div>
  );
}

interface AbortedProps {
  reason: string;
  failedChecks: string[];
  onReset: () => void;
}

export function Aborted({ reason, failedChecks, onReset }: AbortedProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-lg rounded border border-[var(--halt-dim)] bg-halt/5 p-6"
    >
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[15px] font-extrabold uppercase tracking-tightest text-halt">
          Not settled
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--graphite-dim)]">
          {failedChecks.join(', ')} failed
        </span>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-graphite">{reason}</p>

      {/* The claim. Stated plainly, because it is the whole project. */}
      <div className="mt-5 rounded border hairline bg-void/60 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-verify">
          Nothing was paid
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-graphite">
          The payment group was signed but never submitted. No transaction
          exists on Algorand for this run, so there is nothing to reverse and
          nothing to refund. Searching the explorer returns no result.
        </p>
      </div>

      <motion.button
        type="button"
        onClick={onReset}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="mt-5 w-full rounded border hairline py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite transition-colors duration-200 hover:border-[var(--graphite-dim)] hover:text-chalk"
      >
        New run
      </motion.button>
    </motion.div>
  );
}

interface FailedProps {
  message: string;
  detail: string | null;
  onReset: () => void;
}

export function Failed({ message, detail, onReset }: FailedProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg rounded border hairline bg-blueprint/60 p-6"
    >
      <span className="font-display text-[14px] font-semibold uppercase tracking-wide text-chalk">
        {message}
      </span>

      {detail && (
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-[var(--graphite-dim)]">
          {detail}
        </p>
      )}

      <button
        type="button"
        onClick={onReset}
        className="mt-5 w-full rounded border hairline py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite transition-colors duration-200 hover:border-[var(--graphite-dim)] hover:text-chalk"
      >
        Try again
      </button>
    </motion.div>
  );
}

/**
 * A label and value row.
 *
 * @param props - label text and value node
 * @returns the row
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--graphite-dim)]">
        {label}
      </span>
      {children}
    </div>
  );
}