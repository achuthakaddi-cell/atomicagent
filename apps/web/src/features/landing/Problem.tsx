/**
 * The problem section, scroll-scrubbed.
 *
 * Money leaves on day zero. The verdict arrives on day two. The gap between
 * them is the problem, and the section makes that gap literal: a timeline the
 * reader scrubs, with the payment travelling along it and the failure landing
 * well after the money has gone.
 *
 * Every stage is labelled. An earlier version simply slid a number to the right,
 * which looked like motion but explained nothing — a judge watching it would
 * have to be told what they were seeing.
 */

import { Pinned, map, easeOut } from './Pinned.js';

/** The four moments on the timeline, in order. */
const STAGES = [
  { at: 0.0, day: 'Day 0', label: 'Order placed', detail: 'MSME commits to 500 units' },
  { at: 0.25, day: 'Day 0', label: 'Payment sent', detail: '2,00,000 leaves the account' },
  { at: 0.55, day: 'Day 2', label: 'Checks run', detail: 'Supplier stock is finally confirmed' },
  { at: 0.75, day: 'Day 2', label: 'Check fails', detail: 'Only 400 units exist' },
];

export function Problem() {
  return (
    <Pinned length={4}>
      {(p) => <ProblemFrame progress={p} />}
    </Pinned>
  );
}

/**
 * One frame of the problem timeline.
 *
 * @param props - scrub progress, 0 to 1
 * @returns the rendered frame
 */
function ProblemFrame({ progress }: { progress: number }) {
  // The payment travels the full width between 20% and 55% of the scrub.
  const travel = easeOut(map(progress, 0.2, 0.55));

  // The failure lands after the money is already gone. That ordering is the
  // entire argument, so the timing gap is deliberate and generous.
  const failIn = easeOut(map(progress, 0.72, 0.88));

  // The closing statement arrives last.
  const closeIn = map(progress, 0.86, 0.98);

  return (
    <div className="w-full max-w-3xl px-6">
      <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-graphite">
        The problem
      </p>

      <h2 className="mb-12 text-center font-display text-3xl font-extrabold uppercase leading-[0.95] tracking-tightest text-chalk lg:text-5xl">
        You pay first. You find out second.
      </h2>

      {/* ---- the timeline ---- */}
      <div className="relative h-52">
        {/* The rail. */}
        <div className="absolute left-0 right-0 top-16 h-px bg-[var(--hairline)]" />

        {/* Progress along the rail, in brass — the money's journey. */}
        <div
          className="absolute left-0 top-16 h-px bg-brass"
          style={{ width: String(travel * 100) + '%' }}
        />

        {/* Stage markers. */}
        {STAGES.map((stage) => {
          const reached = travel >= stage.at || (stage.at > 0.6 && failIn > 0.1);
          const x = stage.at * 100;

          return (
            <div
              key={stage.label}
              className="absolute top-16 -translate-x-1/2"
              style={{ left: String(x) + '%' }}
            >
              {/* Tick. */}
              <div
                className="mx-auto h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-colors duration-300"
                style={{
                  background: reached
                    ? stage.at > 0.6
                      ? 'var(--halt)'
                      : 'var(--brass)'
                    : 'var(--hairline)',
                  boxShadow: reached ? '0 0 12px currentColor' : 'none',
                }}
              />

              {/* Label. Alternates above and below so they never collide. */}
              <div
                className={
                  'absolute w-36 -translate-x-1/2 text-center ' +
                  (stage.at > 0.6 ? 'top-5' : 'bottom-6')
                }
                style={{
                  left: '50%',
                  opacity: reached ? 1 : 0.25,
                  transition: 'opacity 300ms',
                }}
              >
                <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--graphite-dim)]">
                  {stage.day}
                </p>
                <p
                  className="text-[12px] font-medium"
                  style={{ color: stage.at > 0.6 ? 'var(--halt)' : 'var(--chalk)' }}
                >
                  {stage.label}
                </p>
                <p className="mt-0.5 text-[10px] leading-tight text-graphite">
                  {stage.detail}
                </p>
              </div>
            </div>
          );
        })}

        {/* The money, travelling. Labelled so it is unmistakable. */}
        <div
          className="absolute top-16 -translate-x-1/2 -translate-y-1/2"
          style={{
            left: String(4 + travel * 92) + '%',
            opacity: travel > 0.02 ? 1 : 0,
          }}
        >
          <div className="rounded border border-[var(--brass-dim)] bg-brass/15 px-3 py-1.5 backdrop-blur-sm">
            <p className="whitespace-nowrap font-mono text-[9px] uppercase tracking-wider text-[var(--graphite-dim)]">
              Buyer&rsquo;s money
            </p>
            <p className="tabular whitespace-nowrap font-mono text-[15px] text-brass">
              &#8377;2,00,000
            </p>
          </div>
        </div>
      </div>

      {/* ---- the failure, arriving too late ---- */}
      <div
        className="mt-8"
        style={{
          opacity: failIn,
          transform: 'translateY(' + String((1 - failIn) * 20) + 'px)',
        }}
      >
        <div className="rounded border border-[var(--halt-dim)] bg-halt/10 px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-halt">
            Stock check failed — two days after payment
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-graphite">
            The supplier holds 400 units. The order was for 500. The money left
            on day zero and recovering it is now a legal problem, not a technical
            one.
          </p>
        </div>
      </div>

      <p
        className="mt-8 text-center text-[14px] leading-relaxed text-graphite"
        style={{ opacity: closeIn }}
      >
        There is no mechanism binding the payment to the verification. That gap
        is what AtomicAgent closes.
      </p>
    </div>
  );
}