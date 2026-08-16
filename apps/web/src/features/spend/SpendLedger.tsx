/**
 * The spend ledger.
 *
 * Every decision the agent made about money, in order, with the rationale it
 * wrote at the time. This is the most important panel in the application.
 *
 * WHY IT MATTERS
 * --------------
 * An autonomous spender nobody can audit is worse than no autonomy at all. The
 * point of adaptive spend is not that the agent decides — it is that a human can
 * read exactly what it decided and why, and refuse the next step if they
 * disagree. The panel exists so that reasoning is never hidden.
 *
 * WHY THIS BEHAVIOUR NEEDS x402
 * -----------------------------
 * Under a subscription every call is prepaid, so the marginal cost of the
 * deepest check is zero and the rational move is always to run it. There is
 * nothing to decide and nothing to audit. Escalating BECAUSE a cheap answer was
 * uncertain only makes sense when each request costs money.
 */

import { motion, AnimatePresence } from 'motion/react';
import type { SpendLedger as Ledger, Tier } from '../../lib/api.js';
import { formatAmount } from '../../lib/format.js';

interface SpendLedgerProps {
  ledger: Ledger;
  assetSymbol: string;
  assetDecimals: number;
  /** Highlights the current round while it is in flight. */
  activeRound: number;
}

/** Colour per tier, so escalation is visible at a glance. */
const TIER_COLOUR: Record<Tier, string> = {
  shallow: 'var(--graphite)',
  standard: 'var(--pending)',
  deep: 'var(--brass)',
};

export function SpendLedger({
  ledger,
  assetSymbol,
  assetDecimals,
  activeRound,
}: SpendLedgerProps) {
  const budget = BigInt(ledger.policy.budgetAtomic);
  const spent = BigInt(ledger.spentAtomic);
  const usedFraction = budget > 0n ? Number((spent * 1000n) / budget) / 1000 : 0;

  return (
    <div className="w-full rounded border hairline bg-blueprint/50 p-4">
      {/* ---- header: budget meter ---- */}
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-graphite">
          Verification budget
        </span>
        <span className="tabular font-mono text-[11px] text-chalk">
          {formatAmount(ledger.spentAtomic, assetDecimals)}
          <span className="text-[var(--graphite-dim)]">
            {' / '}
            {formatAmount(ledger.policy.budgetAtomic, assetDecimals)} {assetSymbol}
          </span>
        </span>
      </div>

      {/* Budget bar. Brass fills as the agent commits. */}
      <div className="mt-2 h-1 w-full overflow-hidden rounded bg-[var(--hairline)]">
        <motion.div
          className="h-full bg-brass"
          initial={{ width: 0 }}
          animate={{ width: String(Math.min(1, usedFraction) * 100) + '%' }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>

      <p className="mt-1.5 font-mono text-[9px] text-[var(--graphite-dim)]">
        {ledger.rounds === 0
          ? 'no spend committed'
          : ledger.rounds === 1
            ? 'one round · escalate below ' +
              String(Math.round(ledger.policy.escalateBelow * 100)) +
              '% certainty'
            : String(ledger.rounds) + ' rounds · ' +
              formatAmount(ledger.remainingAtomic, assetDecimals) + ' remaining'}
      </p>

      {/* ---- the decisions ---- */}
      <div className="mt-4 space-y-2">
        <AnimatePresence initial={false}>
          {ledger.decisions.map((decision, index) => {
            // Decisions arrive in rounds of three, so integer division
            // recovers which round each belongs to.
            const round = Math.floor(index / 3) + 1;
            const isActive = round === activeRound;

            return (
              <motion.div
                key={String(index) + decision.checkId + decision.tier}
                initial={{ opacity: 0, x: -12, height: 0 }}
                animate={{ opacity: 1, x: 0, height: 'auto' }}
                transition={{
                  duration: 0.4,
                  delay: (index % 3) * 0.08,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="overflow-hidden"
              >
                <div
                  className="rounded border px-3 py-2"
                  style={{
                    borderColor: decision.escalated
                      ? 'var(--brass-dim)'
                      : 'var(--hairline)',
                    background: decision.escalated
                      ? 'rgba(232,184,75,0.05)'
                      : 'transparent',
                    opacity: isActive ? 1 : 0.65,
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-baseline gap-2">
                      <span
                        className="font-mono text-[9px] uppercase tracking-wider"
                        style={{ color: TIER_COLOUR[decision.tier] }}
                      >
                        {decision.tier}
                      </span>
                      <span className="text-[11px] text-chalk">
                        {decision.checkId}
                      </span>
                    </span>

                    {decision.feeAtomic !== '0' && (
                      <span className="tabular shrink-0 font-mono text-[11px] text-brass">
                        +{formatAmount(decision.feeAtomic, assetDecimals, 3)}
                      </span>
                    )}
                  </div>

                  {/* The rationale. Verbatim, never paraphrased. */}
                  <p className="mt-1 text-[10px] leading-snug text-graphite">
                    {decision.rationale}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {ledger.decisions.length === 0 && (
        <p className="mt-4 text-center font-mono text-[10px] text-[var(--graphite-dim)]">
          The agent has not committed any spend yet
        </p>
      )}
    </div>
  );
}