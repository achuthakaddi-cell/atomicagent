/**
 * A section that pins to the viewport while its animation is scrubbed.
 *
 * HOW IT WORKS
 * ------------
 * The outer element is tall — several viewport heights. The inner element is
 * sticky, so it locks in place while the outer element scrolls past behind it.
 * Progress through that scroll becomes a 0 to 1 value driving whatever the
 * section renders.
 *
 * The result is that the reader controls time. Scrolling down plays the
 * animation forward, scrolling up plays it backward, and stopping holds a
 * frame. Nothing runs on a timer, so nothing can be missed.
 *
 * WHY position: sticky RATHER THAN position: fixed
 * ------------------------------------------------
 * Fixed elements leave the document flow, which means the browser cannot lay
 * out what follows them and the page jumps when they release. Sticky keeps the
 * element in flow and hands the pinning to the compositor, which is both
 * smoother and simpler.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface PinnedProps {
  /**
   * How many viewport heights of scroll this section consumes. Higher means
   * the animation plays more slowly relative to the reader's scrolling.
   */
  length?: number;
  /** Rendered with the current scrub progress, 0 to 1. */
  children: (progress: number) => ReactNode;
  className?: string;
}

export function Pinned({ length = 3, children, className = '' }: PinnedProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    let frame = 0;

    const update = (): void => {
      frame = 0;

      // Read layout first, write after. Interleaving forces the browser to
      // recalculate on every frame, which is the classic cause of scroll jank.
      const rect = outer.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;

      if (scrollable <= 0) {
        setProgress(0);
        return;
      }

      // rect.top is 0 when the section reaches the top of the viewport, and
      // goes negative as it scrolls past. Negating gives distance travelled.
      const travelled = -rect.top;
      setProgress(Math.max(0, Math.min(1, travelled / scrollable)));
    };

    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div ref={outerRef} className={'relative ' + className} style={{ height: String(length * 100) + 'vh' }}>
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden">
        {children(progress)}
      </div>
    </div>
  );
}

/**
 * Maps a value from one range to another, clamped to the output range.
 *
 * The workhorse of scrubbed animation: it carves a window out of the overall
 * progress so each element can have its own timing within a pinned section.
 *
 * @param value - input
 * @param inMin - input range start
 * @param inMax - input range end
 * @param outMin - output range start
 * @param outMax - output range end
 * @returns the mapped value
 */
export function map(
  value: number,
  inMin: number,
  inMax: number,
  outMin = 0,
  outMax = 1,
): number {
  const t = Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

/**
 * Ease-out cubic. Decelerates into its target.
 *
 * @param t - progress 0 to 1
 * @returns eased value
 */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Ease-in-out quart. Slow at both ends, fast through the middle.
 *
 * @param t - progress 0 to 1
 * @returns eased value
 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
}