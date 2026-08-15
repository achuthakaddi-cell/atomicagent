/**
 * The problem section.
 *
 * A scroll-scrubbed sequence showing money leaving before the answer arrives.
 * The payment physically drains off the right edge as the reader scrolls, and
 * the failed check appears afterward — which is the wrong order, and that is
 * the point being made.
 */

import { useScrollProgress, mapRange } from './useScrollProgress.js';

export function Problem() {
  const { ref, progress } = useScrollProgress<HTMLElement>();

  const pay = mapRange(progress, 0.2, 0.45, 0, 1);
  const drain = mapRange(progress, 0.42, 0.68, 0, 1);
  const reveal = mapRange(progress, 0.62, 0.82, 0, 1);

  return (
    <section
      ref={ref}
      className="relative z-10 flex min-h-[180vh] flex-col items-center px-6 py-32"
    >
      <div className="sticky top-32 w-full max-w-3xl">
        <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-graphite">
          The problem
        </p>

        <h2 className="mb-14 text-center font-display text-3xl font-extrabold uppercase leading-[0.95] tracking-tightest text-chalk lg:text-5xl">
          You pay first.
          <br />
          You find out second.
        </h2>

        <div className="relative h-56 overflow-hidden rounded border hairline bg-blueprint/40">
          {/* The payment leaving. */}
          <div
            className="absolute top-1/2 flex -translate-y-1/2 items-center gap-3"
            style={{
              left: String(12 + drain * 88) + '%',
              opacity: pay * (1 - drain * 0.85),
            }}
          >
            <span className="tabular font-mono text-2xl text-brass">
              &#8377;2,00,000
            </span>
          </div>

          {/* The verdict, arriving too late. */}
          <div
            className="absolute bottom-6 left-6 right-6"
            style={{ opacity: reveal, transform: 'translateY(' + String((1 - reveal) * 16) + 'px)' }}
          >
            <div className="rounded border border-[var(--halt-dim)] bg-halt/10 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-halt">
                Stock check failed
              </p>
              <p className="mt-1 text-[12px] text-graphite">
                Supplier holds 400 units. You ordered 500. Your money left
                twenty minutes ago.
              </p>
            </div>
          </div>

          {/* Timeline rail. */}
          <div className="absolute left-6 right-6 top-8 h-px bg-[var(--hairline)]" />
          <div
            className="absolute left-6 top-8 h-px bg-brass"
            style={{ width: String(drain * 88) + '%' }}
          />
        </div>

        <p className="mx-auto mt-8 max-w-lg text-center text-[14px] leading-relaxed text-graphite">
          MSMEs pay suppliers before verification completes because there is no
          mechanism to bind the two. When a check fails afterward, recovering the
          money is a legal problem, not a technical one.
        </p>
      </div>
    </section>
  );
}