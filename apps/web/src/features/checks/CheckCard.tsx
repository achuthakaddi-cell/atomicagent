/**
 * One check's live status card.
 *
 * Three of these sit side by side. Their job is to make two things legible at
 * once: the parallel fan-out, and how much certainty the agent has bought.
 *
 * A card shows the tier that produced its answer and a certainty meter. When
 * an answer is ambiguous it also shows what a deeper tier would resolve, which
 * is the information the agent used to decide whether to escalate.
 */

import { motion } from 'motion/react';
import type { CheckStatus } from '../../store/useRunStore.js';
import type { Tier } from '../../lib/api.js';

interface CheckCardProps {
  checkId: 'price' | 'availability' | 'verification';
  status: CheckStatus;
  reason: string | null;
  /** What a deeper tier would resolve, when this one was ambiguous. */
  wouldResolve: string | null;
  /** Which tier produced the current answer. */
  tier: Tier;
  /** How certain that answer is, 0 to 1. */
  certainty: number | null;
  /** Slot in the atomic group this check is paid from. */
  paymentIndex: number;
  /** Position in the row, for stagger timing. */
  order: number;
}

const LABELS = {
  price: 'Price',
  availability: 'Stock',
  verification: 'Seller',
} as const;

const DESCRIPTIONS = {
  price: 'Unit price within your ceiling',
  availability: 'Enough stock, dispatched in time',
  verification: 'GST active, licence valid',
} as const;

const TIER_LABEL: Record<Tier, string> = {
  shallow: 'cached',
  standard: 'live',
  deep: 'audited',
};

/**
 * Colours for each status.
 *
 * @param status - the check's state
 * @returns border, accent and glow classes
 */
function styleFor(status: CheckStatus): {
  border: string;
  accent: string;
  glow: string;
} {
  switch (status) {
    case 'confirmed':
      return {
        border: 'border-[var(--verify-dim)]',
        accent: 'text-verify',
        glow: 'shadow-[0_0_24px_-8px_var(--verify)]',
      };
    case 'refuted':
      return {
        border: 'border-[var(--halt-dim)]',
        accent: 'text-halt',
        glow: 'shadow-[0_0_24px_-8px_var(--halt)]',
      };
    case 'ambiguous':
      return {
        border: 'border-[var(--brass-dim)]',
        accent: 'text-brass',
        glow: 'shadow-[0_0_24px_-8px_var(--brass)]',
      };
    case 'verifying':
      return {
        border: 'border-[var(--pending)]',
        accent: 'text-[var(--pending)]',
        glow: 'shadow-[0_0_20px_-10px_var(--pending)]',
      };
    default:
      return {
        border: 'hairline',
        accent: 'text-[var(--graphite-dim)]',
        glow: '',
      };
  }
}

export function CheckCard({
  checkId,
  status,
  reason,
  wouldResolve,
  tier,
  certainty,
  paymentIndex,
  order,
}: CheckCardProps) {
  const style = styleFor(status);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, rotateX: -8 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.5, delay: order * 0.08, ease: [0.16, 1, 0.3, 1] }}
      className={
        'relative flex-1 overflow-hidden rounded border bg-blueprint/60 p-4 transition-all duration-300 ' +
        style.border + ' ' + style.glow
      }
    >
      {/* Slot marker and tier. */}
      <div className="absolute right-3 top-3 flex items-baseline gap-2">
        <span
          className="font-mono text-[9px] uppercase tracking-wider"
          style={{
            color:
              tier === 'deep'
                ? 'var(--brass)'
                : tier === 'standard'
                  ? 'var(--pending)'
                  : 'var(--graphite-dim)',
          }}
        >
          {TIER_LABEL[tier]}
        </span>
        <span className="font-mono text-[9px] text-[var(--graphite-dim)]">
          slot {paymentIndex}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <StatusMark status={status} />
        <span className="font-display text-[13px] font-semibold uppercase tracking-wide text-chalk">
          {LABELS[checkId]}
        </span>
      </div>

      <p className="mt-2 min-h-[34px] text-[11px] leading-snug text-graphite">
        {reason ?? DESCRIPTIONS[checkId]}
      </p>

      {/* Certainty meter. The number the agent reasons about. */}
      {certainty !== null && (
        <div className="mt-2">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--graphite-dim)]">
              certainty
            </span>
            <span className={'tabular font-mono text-[10px] ' + style.accent}>
              {Math.round(certainty * 100)}%
            </span>
          </div>
          <div className="mt-1 h-[3px] w-full overflow-hidden rounded bg-[var(--hairline)]">
            <motion.div
              className="h-full"
              style={{
                background:
                  status === 'confirmed'
                    ? 'var(--verify)'
                    : status === 'refuted'
                      ? 'var(--halt)'
                      : 'var(--brass)',
              }}
              initial={{ width: 0 }}
              animate={{ width: String(certainty * 100) + '%' }}
              transition={{ type: 'spring', stiffness: 140, damping: 22 }}
            />
          </div>
        </div>
      )}

      {/* What escalation would buy. This is the agent's decision input. */}
      {wouldResolve && status === 'ambiguous' && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-2 border-t hairline pt-2 font-mono text-[9px] leading-snug text-brass"
        >
          {wouldResolve}
        </motion.p>
      )}

      {/* Progress sweep while verifying. */}
      {status === 'verifying' && (
        <motion.div
          className="absolute bottom-0 left-0 h-px bg-[var(--pending)]"
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 3, ease: 'linear' }}
        />
      )}
    </motion.div>
  );
}

/**
 * The status glyph.
 *
 * Each state gets its own shape, not just its own colour, so the card is
 * readable on a projector and to anyone with colour blindness.
 *
 * @param props - the status to render
 * @returns an SVG mark
 */
function StatusMark({ status }: { status: CheckStatus }) {
  if (status === 'confirmed') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <motion.path
          d="M3 7.5 L6 10.5 L11 4"
          fill="none"
          stroke="var(--verify)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
    );
  }

  if (status === 'refuted') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <motion.path
          d="M7 3 L7 8"
          stroke="var(--halt)"
          strokeWidth="1.8"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3 }}
        />
        <motion.circle
          cx="7"
          cy="10.8"
          r="0.9"
          fill="var(--halt)"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.25, type: 'spring', stiffness: 500 }}
        />
      </svg>
    );
  }

  if (status === 'ambiguous') {
    // A half-filled circle. Neither pass nor fail: partial information.
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="var(--brass)" strokeWidth="1.6" />
        <motion.path
          d="M7 2.5 A4.5 4.5 0 0 1 7 11.5 Z"
          fill="var(--brass)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        />
      </svg>
    );
  }

  if (status === 'verifying') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <motion.circle
          cx="7"
          cy="7"
          r="4.5"
          fill="none"
          stroke="var(--pending)"
          strokeWidth="1.6"
          strokeDasharray="8 20"
          strokeLinecap="round"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: '7px 7px' }}
        />
      </svg>
    );
  }

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="4" fill="none" stroke="var(--hairline)" strokeWidth="1.4" />
    </svg>
  );
}