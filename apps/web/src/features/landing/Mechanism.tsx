/**
 * The mechanism section.
 *
 * The five-slot atomic group assembles itself as the reader scrolls. Progress
 * through the section drives the animation directly rather than a timer, so
 * the reader controls the pace and can scrub backward to re-read it.
 *
 * The diagram encodes the real layout: slot 0 is the facilitator's fee payer,
 * slots 1 to 3 are the three checks, slot 4 is the order payment. Those are
 * the same indices the services verify against.
 */

import { useScrollProgress, mapRange } from './useScrollProgress.js';

const SLOTS = [
  { index: 0, label: 'fee payer', detail: 'facilitator signs · covers all fees', who: 'facilitator' },
  { index: 1, label: 'price check', detail: '0.01 · is the unit price within your ceiling', who: 'buyer' },
  { index: 2, label: 'stock check', detail: '0.01 · is there enough, dispatched in time', who: 'buyer' },
  { index: 3, label: 'seller check', detail: '0.01 · GST active, licence valid', who: 'buyer' },
  { index: 4, label: 'order payment', detail: 'the money that actually buys the goods', who: 'buyer' },
];

export function Mechanism() {
  const { ref, progress } = useScrollProgress<HTMLElement>();

  // The section is taller than the viewport, so progress maps across a long
  // scroll. Slots appear in sequence, then the group id binds them.
  const appear = mapRange(progress, 0.15, 0.62, 0, 1);
  const bind = mapRange(progress, 0.6, 0.85, 0, 1);

  return (
    <section
      ref={ref}
      className="relative z-10 flex min-h-[220vh] flex-col items-center px-6 py-32"
    >
      <div className="sticky top-24 w-full max-w-4xl">
        <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-graphite">
          How it works
        </p>

        <h2 className="mb-3 text-center font-display text-3xl font-extrabold uppercase leading-[0.95] tracking-tightest text-chalk lg:text-5xl">
          One group.
          <br />
          Five transactions.
        </h2>

        <p className="mx-auto mb-14 max-w-lg text-center text-[14px] leading-relaxed text-graphite">
          The agent builds a single Algorand atomic transaction group. Every
          transaction in it shares one group identifier, and that shared value
          is what makes them indivisible.
        </p>

        <div className="space-y-2.5">
          {SLOTS.map((slot, i) => {
            // Each slot has its own window within the appear range.
            const local = mapRange(appear, i * 0.16, i * 0.16 + 0.3, 0, 1);
            const bound = bind > 0.1;

            return (
              <div
                key={slot.index}
                className="flex items-center gap-4"
                style={{
                  opacity: local,
                  transform: 'translateX(' + String((1 - local) * -40) + 'px)',
                }}
              >
                <span className="w-6 shrink-0 text-right font-mono text-[11px] text-[var(--graphite-dim)]">
                  {slot.index}
                </span>

                <div
                  className="flex-1 rounded border px-4 py-3 transition-colors duration-500"
                  style={{
                    borderColor: bound ? 'var(--brass-dim)' : 'var(--hairline)',
                    background: bound
                      ? 'rgba(232,184,75,0.05)'
                      : 'rgba(13,25,38,0.5)',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-medium text-chalk">
                      {slot.label}
                    </span>
                    <span
                      className="shrink-0 font-mono text-[9px] uppercase tracking-wider"
                      style={{
                        color:
                          slot.who === 'facilitator'
                            ? 'var(--verify)'
                            : 'var(--graphite-dim)',
                      }}
                    >
                      {slot.who}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--graphite-dim)]">
                    {slot.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* The binding rail. Draws down the left edge as the group locks. */}
        <div className="relative mt-6 h-8">
          <div
            className="absolute left-[13px] top-0 w-[2px] rounded"
            style={{
              height: String(bind * 100) + '%',
              background: 'var(--brass)',
              boxShadow: bind > 0.2 ? '0 0 14px var(--brass)' : 'none',
              transform: 'translateY(-320px)',
              transformOrigin: 'top',
            }}
          />
          <p
            className="text-center font-mono text-[10px] uppercase tracking-[0.24em]"
            style={{ opacity: bind, color: 'var(--brass)' }}
          >
            Bound by one group id
          </p>
        </div>
      </div>
    </section>
  );
}