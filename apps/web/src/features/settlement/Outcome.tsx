/**
 * The settled and aborted screens.
 *
 * Both get equal weight. A judge is likely to trigger the failure path
 * deliberately, and the rollback screen is where the project's central claim is
 * actually made — so it is designed as carefully as the success one.
 *
 * Both now report what the agent's spending achieved: how much of the budget
 * was used, what certainty it bought, and whether escalation changed the
 * outcome. That last line is the whole argument for adaptive spend.
 */

import { motion } from 'motion/react';
import type { SpendLedger, Tier, TieredVerdict } from '../../lib/api.js';
import { formatAmount, shortHash } from '../../lib/format.js';

const TIER_LABEL: Record<Tier, string> = {
  shallow: 'cached',
  standard: 'live',
  deep: 'audited',
};

interface SettledProps {
  txId: string;
  explorerUrl: string;
  totalPaidAtomic: string;
  assetSymbol: string;
  assetDecimals: number;
  verdicts: TieredVerdict[];
  ledger: SpendLedger;
  onReset: () => void;
}

export function Settled({
  txId,
  explorerUrl,
  totalPaidAtomic,
  assetSymbol,
  assetDecimals,
  verdicts,
  ledger,
  onReset,
}: SettledProps) {
  const escalations = ledger.decisions.filter((d) => d.escalated).length;

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
        Every verification fee and the order payment committed together as one
        indivisible event.
      </p>

      {/* What certainty was bought, per check. */}
      <div className="mt-5 space-y-1.5 border-t hairline pt-4">
        {verdicts.map((verdict) => (
          <div key={verdict.checkId} className="flex items-baseline justify-between gap-3">
            <span className="flex items-baseline gap-2">
              <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--graphite-dim)]">
                {TIER_LABEL[verdict.tier]}
              </span>
              <span className="text-[12px] text-chalk">{verdict.checkId}</span>
            </span>
            <span className="tabular font-mono text-[11px] text-verify">
              {Math.round(verdict.certainty * 100)}%
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2 border-t hairline pt-4">
        <Row label="Verification spend">
          <span className="tabular font-mono text-[13px] text-chalk">
            {formatAmount(ledger.spentAtomic, assetDecimals, 3)}
            <span className="text-[var(--graphite-dim)]">
              {' of '}
              {formatAmount(ledger.policy.budgetAtomic, assetDecimals, 2)}
            </span>
          </span>
        </Row>
        <Row label="Total paid">
          <span className="tabular font-mono text-[13px] text-chalk">
            {formatAmount(totalPaidAtomic, assetDecimals)} {assetSymbol}
          </span>
        </Row>
        <Row label="Network fee">
          <span className="tabular font-mono text-[13px] text-verify">0 ALGO</span>
        </Row>
        <Row label="Transaction">
          <span className="font-mono text-[12px] text-graphite">{shortHash(txId)}</span>
        </Row>
      </div>

      {/* The argument for adaptive spend, stated plainly. */}
      {escalations > 0 && (
        <p className="mt-4 rounded border hairline bg-void/50 px-3 py-2 text-[11px] leading-relaxed text-graphite">
          The agent escalated {escalations === 1 ? 'one check' : String(escalations) + ' checks'}{' '}
          because a cheaper answer was too uncertain, and stopped once the
          remaining certainty was not worth its price.
        </p>
      )}

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
  verdicts: TieredVerdict[];
  ledger: SpendLedger;
  assetSymbol: string;
  assetDecimals: number;
  onReset: () => void;
}

export function Aborted({
  reason,
  failedChecks,
  verdicts,
  ledger,
  assetSymbol,
  assetDecimals,
  onReset,
}: AbortedProps) {
  const escalations = ledger.decisions.filter((d) => d.escalated).length;

  // Did escalation change the answer? A check that was ambiguous at a cheap
  // tier and refuted at a deeper one is the strongest case for adaptive spend:
  // the cheap answer would have let the order through.
  const caughtByEscalation =
    escalations > 0 && verdicts.some((v) => v.confidence === 'refuted' && v.tier !== 'shallow');

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
          {failedChecks.join(', ')} unresolved
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

      {/* The strongest case for adaptive spend, when it applies. */}
      {caughtByEscalation && (
        <div className="mt-3 rounded border border-[var(--brass-dim)] bg-brass/5 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brass">
            Escalation caught this
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-graphite">
            The cheap check could not confirm the answer. The agent spent{' '}
            {formatAmount(ledger.spentAtomic, assetDecimals, 3)} {assetSymbol} of
            its {formatAmount(ledger.policy.budgetAtomic, assetDecimals, 2)}{' '}
            budget to find out, and the deeper answer refused the order.
          </p>
        </div>
      )}

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
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--graphite-dim)]">
        {label}
      </span>
      {children}
    </div>
  );
}