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
import { usePageMotion, useInViewRepeat } from './useScrollProgress.js';
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
 * REPLAYS ON EVERY VISIT
 * ----------------------
 * The cycle restarts whenever the section re-enters the viewport, and a button
 * replays it on demand. A one-shot animation is useless in a demo: the presenter
 * cannot show it twice without reloading the page.
 *
 * @returns the binding section
 */
function BindingShowcase() {
  const { ref, inView } = useInViewRepeat<HTMLElement>(0.35);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [runId, setRunId] = useState(0);

  // Restart the cycle whenever the section comes back into view.
  useEffect(() => {
    if (inView) setRunId((n) => n + 1);
  }, [inView]);

  useEffect(() => {
    if (!inView) return;

    setPhase('idle');

    const toVerify = setTimeout(() => setPhase('verifying'), 600);
    const toSettle = setTimeout(() => setPhase('settling'), 2800);

    return () => {
      clearTimeout(toVerify);
      clearTimeout(toSettle);
    };
  }, [inView, runId]);

  return (
    <section
      ref={ref}
      id="how"
      className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6"
    >
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.28em] text-graphite">
        The binding
      </p>

      <h2 className="mb-8 max-w-3xl text-center font-display text-3xl font-extrabold uppercase leading-[0.95] tracking-tightest text-chalk lg:text-5xl">
        Chaos becomes one bound structure
      </h2>

      <div className="w-full max-w-5xl">
        <TheBinding phase={phase} groupId={null} verdicts={[]} failedChecks={[]} />
      </div>

      <button
        type="button"
        onClick={() => setRunId((n) => n + 1)}
        className="mt-6 rounded border hairline px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-graphite transition-colors duration-200 hover:border-brass hover:text-brass"
      >
        Replay
      </button>

      <p className="mt-6 max-w-lg text-center text-[13px] leading-relaxed text-graphite">
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