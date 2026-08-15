/**
 * The hero, pinned and scrubbed.
 *
 * Three states driven by one scroll: the headline assembles, holds, then
 * shatters into the problem statement. The reader controls all of it, and
 * scrolling up runs the shatter in reverse.
 */

import { Pinned, map, easeOut } from './Pinned.js';
import { MagneticLink } from './Reactive.js';
import { ShatterText } from './ShatterText.js';

/** Shared button styling. */
const BTN_BRASS = 'rounded border border-[var(--brass-dim)] bg-brass/10 px-7 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-brass transition-all duration-200 hover:border-brass hover:bg-brass/20';
const BTN_GHOST = 'rounded border hairline px-6 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-graphite transition-colors duration-200 hover:border-[var(--graphite-dim)] hover:text-chalk';

export function HeroPinned() {
  return (
    <Pinned length={3}>
      {(p) => <HeroFrame progress={p} />}
    </Pinned>
  );
}

/**
 * One frame of the hero.
 *
 * @param props - scrub progress, 0 to 1
 * @returns the rendered frame
 */
function HeroFrame({ progress }: { progress: number }) {
  // The headline holds until 35%, then scatters through to 75%.
  const scatter = map(progress, 0.35, 0.78);

  // Supporting copy and buttons leave earlier, so the headline is alone when
  // it breaks apart.
  const supportOpacity = 1 - map(progress, 0.2, 0.4);

  // The second headline arrives out of the debris.
  const secondIn = easeOut(map(progress, 0.62, 0.92));

  return (
    <div className="relative flex w-full flex-col items-center px-6">
      <p
        className="mb-5 font-mono text-[10px] uppercase tracking-[0.3em] text-graphite"
        style={{ opacity: supportOpacity }}
      >
        Algorand · x402 · atomic settlement
      </p>

      {/* First headline. Shatters. */}
      <h1 className="max-w-5xl text-center font-display text-[12vw] font-extrabold uppercase leading-[0.88] tracking-tightest text-chalk sm:text-[9vw] lg:text-[7vw]">
        <ShatterText text="Payment bound" scatter={scatter} />
        <br />
        <ShatterText text="to outcome" scatter={scatter} accent="outcome" />
      </h1>

      {/* Second headline. Assembles from the debris. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-6"
        style={{
          opacity: secondIn,
          transform: 'translateY(-50%) scale(' + String(0.86 + secondIn * 0.14) + ')',
        }}
      >
        <p className="mb-4 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-graphite">
          The problem
        </p>
        <h2 className="text-center font-display text-[9vw] font-extrabold uppercase leading-[0.9] tracking-tightest text-chalk lg:text-[5.5vw]">
          You pay first.
          <br />
          You find out <span className="text-halt">second</span>.
        </h2>
      </div>

      <p
        className="mt-8 max-w-lg text-center text-[15px] leading-relaxed text-graphite"
        style={{ opacity: supportOpacity }}
      >
        An AI sourcing agent for MSMEs. Three verification checks and the order
        payment settle as one indivisible event, or nothing moves at all.
      </p>

      <div className="mt-10 flex gap-3" style={{ opacity: supportOpacity }}>
        <MagneticLink href="/app" className={BTN_BRASS}>Run the agent</MagneticLink>
        <MagneticLink href="#how" className={BTN_GHOST}>How it works</MagneticLink>
      </div>

      <div
        className="absolute -bottom-24 flex flex-col items-center gap-2"
        style={{ opacity: supportOpacity }}
      >
        <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-[var(--graphite-dim)]">
          Scroll
        </span>
        <span className="h-8 w-px animate-pulse bg-[var(--hairline)]" />
      </div>
    </div>
  );
}