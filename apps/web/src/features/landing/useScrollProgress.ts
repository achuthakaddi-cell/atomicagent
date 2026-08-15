/**
 * Scroll-driven animation primitives.
 *
 * Every value is derived from a single scroll listener that batches reads
 * before writes. Reading layout inside a scroll handler and then writing to it
 * forces the browser to recalculate on every frame, which is the classic cause
 * of janky scroll animation.
 */

import { useEffect, useRef, useState } from 'react';

/**
 * Progress of an element through the viewport.
 *
 * Returns 0 when the element's top edge reaches the bottom of the viewport,
 * and 1 when its bottom edge reaches the top. Anything in between is a linear
 * fraction, which is what scroll-scrubbed animation needs.
 *
 * @returns a ref to attach, and the current progress
 */
export function useScrollProgress<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>;
  progress: number;
} {
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;

    const update = (): void => {
      frame = 0;

      const element = ref.current;
      if (!element) return;

      // Read all layout first, then write. Never interleave.
      const rect = element.getBoundingClientRect();
      const viewport = window.innerHeight;

      const total = rect.height + viewport;
      const travelled = viewport - rect.top;
      const value = Math.max(0, Math.min(1, travelled / total));

      setProgress(value);
    };

    const onScroll = (): void => {
      // Coalesce multiple scroll events into one frame.
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

  return { ref, progress };
}

/**
 * Whether an element has entered the viewport.
 *
 * Used to fire entrance animations once rather than on every scroll frame.
 *
 * @param threshold - fraction of the element that must be visible
 * @returns a ref to attach, and whether it has appeared
 */
export function useInView<T extends HTMLElement>(threshold = 0.25): {
  ref: React.RefObject<T | null>;
  inView: boolean;
} {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            // Fire once. Re-triggering on every pass is distracting.
            observer.disconnect();
          }
        }
      },
      { threshold },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold]);

  return { ref, inView };
}

/**
 * Overall page scroll progress, 0 to 1.
 *
 * Drives the persistent progress indicator in the header.
 *
 * @returns fraction of the document scrolled
 */
export function usePageProgress(): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;

    const update = (): void => {
      frame = 0;
      const scrollable = document.body.scrollHeight - window.innerHeight;
      if (scrollable <= 0) {
        setProgress(0);
        return;
      }
      setProgress(Math.max(0, Math.min(1, window.scrollY / scrollable)));
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

  return progress;
}

/**
 * Maps a value from one range to another, clamped.
 *
 * @param value - input
 * @param inMin - input range start
 * @param inMax - input range end
 * @param outMin - output range start
 * @param outMax - output range end
 * @returns the mapped value
 */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const t = Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}
/**
 * Page progress plus scroll velocity.
 *
 * Velocity is what makes the background feel physical: fast scrolling smears
 * the field, stopping lets it settle. Without it the shader reacts to position
 * only, which reads as a slideshow rather than motion.
 *
 * @returns progress 0 to 1, and normalised velocity roughly -1 to 1
 */
export function usePageMotion(): { progress: number; velocity: number } {
  const [state, setState] = useState({ progress: 0, velocity: 0 });

  useEffect(() => {
    let frame = 0;
    let lastY = window.scrollY;
    let lastTime = performance.now();
    let smoothed = 0;

    const update = (): void => {
      frame = 0;

      const now = performance.now();
      const y = window.scrollY;
      const dt = Math.max(1, now - lastTime);

      // Pixels per millisecond, scaled into a useful range for a shader
      // uniform, then clamped so a trackpad fling does not blow it out.
      const raw = ((y - lastY) / dt) * 12;
      const clamped = Math.max(-1, Math.min(1, raw));

      // Decay toward zero when scrolling stops, so the field eases rather than
      // freezing the instant the finger lifts.
      smoothed += (clamped - smoothed) * 0.25;
      if (Math.abs(smoothed) < 0.002) smoothed = 0;

      const scrollable = document.body.scrollHeight - window.innerHeight;
      const progress = scrollable > 0 ? Math.max(0, Math.min(1, y / scrollable)) : 0;

      lastY = y;
      lastTime = now;

      setState({ progress, velocity: smoothed });
    };

    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    // Keep decaying velocity even when no scroll event fires, so it returns to
    // zero smoothly instead of holding its last value.
    const decay = window.setInterval(() => {
      if (frame === 0) frame = requestAnimationFrame(update);
    }, 120);

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.clearInterval(decay);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return state;
}
/**
 * Whether an element is currently in view, updating continuously.
 *
 * Unlike useInView, this does NOT disconnect after the first intersection. It
 * reports entry and exit, so a section can replay its animation every time the
 * reader scrolls back to it.
 *
 * @param threshold - fraction of the element that must be visible
 * @returns a ref to attach, and whether it is currently visible
 */
export function useInViewRepeat<T extends HTMLElement>(threshold = 0.3): {
  ref: React.RefObject<T | null>;
  inView: boolean;
} {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setInView(entry.isIntersecting);
        }
      },
      { threshold },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold]);

  return { ref, inView };
}