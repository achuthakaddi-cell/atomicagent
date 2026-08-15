/**
 * The landing page.
 *
 * Six full-height sections over a WebGL field. Several animation techniques
 * run at once — scroll-scrubbed pinning, per-character physics, spring
 * simulation, a reactive shader background — because layering is what makes a
 * page feel heavy rather than any single effect.
 */

import { useEffect, useState } from 'react';
import { GLField } from './gl/GLField.js';
import { SpeedVignette } from './Reactive.js';
import { HeroPinned } from './HeroPinned.js';
import { Problem } from './Problem.js';
import { Mechanism } from './Mechanism.js';
import { Differentiator } from './Differentiator.js';
import { Proof } from './Proof.js';
import { TheBinding } from '../binding/TheBinding.js';
import { usePageMotion, useInView } from './useScrollProgress.js';
import type { RunPhase } from '../../store/useRunStore.js';

/** Header link styling. */
const BTN_VERIFY = 'rounded border border-[var(--verify-dim)] px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-verify transition-colors duration-200 hover:border-verify hover:bg-verify/10';

/**
 * Fixed header carrying the scroll progress rail and a link into the app.
 *
 * The rail is the persistent state indicator the brief asks for: it reflects
 * real page position rather than being decorative.
 *
 * @param props - current page scroll progress, 0 to 1
 * @returns the header
 */
function TopBar({ progress }: { progress: number }) {
  const railWidth = String(progress * 100) + '%';

  return (
    <div className="fixed left-0 right-0 top-0 z-50">
      <div className="h-[2px] bg-transparent">
        <div className="h-full bg-brass" style={{ width: railWidth }} />
      </div>

      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6 backdrop-blur-sm">
        <span className="font-display text-[14px] font-extrabold uppercase tracking-tightest text-chalk">
          AtomicAgent
        </span>

        <a href="/app" className={BTN_VERIFY}>Launch app</a>
      </div>
    </div>
  );
}

/**
 * The binding, full-screen.
 *
 * Reuses the same component the application runs, cycling through its phases
 * so a reader who never launches the app still sees the mechanism.
 *
 * The phase cycle lives in an effect rather than being scheduled during render,
 * which would fire on every re-render and leak timers.
 *
 * @returns the binding section
 */
function BindingShowcase() {
  const { ref, inView } = useInView<HTMLElement>(0.4);
  const [phase, setPhase] = useState<RunPhase>('idle');

  useEffect(() => {
    if (!inView) return;

    const toVerify = setTimeout(() => setPhase('verifying'), 500);
    const toSettle = setTimeout(() => setPhase('settling'), 2600);

    return () => {
      clearTimeout(toVerify);
      clearTimeout(toSettle);
    };
  }, [inView]);

  return (
    <section ref={ref} id="how" className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.28em] text-graphite">
        The binding
      </p>

      <h2 className="mb-10 max-w-3xl text-center font-display text-3xl font-extrabold uppercase leading-[0.95] tracking-tightest text-chalk lg:text-5xl">
        Chaos becomes one bound structure
      </h2>

      <div className="w-full max-w-5xl">
        <TheBinding phase={phase} groupId={null} verdicts={[]} failedChecks={[]} />
      </div>

      <p className="mt-8 max-w-lg text-center text-[13px] leading-relaxed text-graphite">
        Before settlement the transactions are independent. After it they share
        one 32-byte group identifier and cannot be separated. If any check fails,
        the group is never submitted and nothing exists on chain to reverse.
      </p>
    </section>
  );
}

/**
 * The landing page shell.
 *
 * The WebGL field sits behind everything and reacts to scroll position,
 * scroll velocity, and how close the reader is to the settlement section.
 *
 * @returns the full page
 */
export function Landing() {
  const { progress, velocity } = usePageMotion();

  // Settlement intensity ramps across the binding section, which sits roughly
  // half to three-quarters down the page. The field brightens and its contours
  // tighten as the reader approaches it.
  const settle = Math.max(0, Math.min(1, (progress - 0.5) / 0.25));

  return (
    <div className="relative min-h-screen bg-void">
      <GLField scroll={progress} velocity={velocity} settle={settle} />
      <GLField scroll={progress} velocity={velocity} settle={settle} />
      <SpeedVignette velocity={velocity} />
      <TopBar progress={progress} />
      <TopBar progress={progress} />
      <HeroPinned />
      <Problem />
      <Mechanism />
      <BindingShowcase />
      <Differentiator />
      <Proof />
    </div>
  );
}