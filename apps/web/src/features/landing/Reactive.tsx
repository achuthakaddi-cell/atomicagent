/**
 * Input-reactive components.
 *
 * Three effects, all driven by real input rather than timers:
 *
 *   Velocity skew    elements lean and stretch in the direction of scroll
 *   Magnetic pull    buttons drift toward the cursor when it comes close
 *   Speed vignette   the viewport edges tighten during fast scrolling
 *
 * WHY THIS MATTERS MORE THAN IT SOUNDS
 * ------------------------------------
 * A page where nothing responds to input feels like a video. A page where
 * everything responds feels like a物 you are handling. The individual effects
 * are small; the accumulation is what reads as quality.
 *
 * Every one of them writes to the DOM through a ref inside a single animation
 * frame. Routing per-frame updates through React state would re-render the
 * tree sixty times a second for transforms that never change structure.
 */

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Spring, SPRING } from './physics.js';

/**
 * Wraps content so it skews and stretches with scroll velocity.
 *
 * Fast scrolling leans the element and squashes it slightly along the axis of
 * travel, which is the same trick traditional animation uses to convey speed.
 *
 * @param props - velocity, strength and content
 * @returns the reactive wrapper
 */
export function VelocitySkew({
  velocity,
  strength = 1,
  children,
  className = '',
}: {
  velocity: number;
  strength?: number;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const velocityRef = useRef(velocity);

  useEffect(() => {
    velocityRef.current = velocity;
  }, [velocity]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const spring = new Spring(0, SPRING.quick);
    let raf = 0;
    let last = performance.now();

    const frame = (now: number): void => {
      const delta = now - last;
      last = now;

      spring.setTarget(velocityRef.current);
      const v = spring.step(delta);

      const skew = v * 4.5 * strength;
      const scaleY = 1 + Math.abs(v) * 0.06 * strength;
      const scaleX = 1 - Math.abs(v) * 0.03 * strength;

      element.style.transform =
        'skewY(' + String(skew) + 'deg) scale(' + String(scaleX) + ',' + String(scaleY) + ')';

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [strength]);

  return (
    <div ref={ref} className={className} style={{ willChange: 'transform' }}>
      {children}
    </div>
  );
}

/**
 * A link that drifts toward the cursor when it comes close.
 *
 * The pull is proportional to proximity and springs back when the cursor
 * leaves, so the button feels magnetic rather than snapping to the pointer.
 *
 * @param props - href, styling and content
 * @returns the magnetic link
 */
export function MagneticLink({
  href,
  className = '',
  children,
  radius = 130,
  pull = 0.32,
  external = false,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  /** How close the cursor must be, in pixels, before the pull begins. */
  radius?: number;
  /** Fraction of the cursor offset the button travels. */
  pull?: number;
  external?: boolean;
}) {
  const ref = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const springX = new Spring(0, SPRING.snap);
    const springY = new Spring(0, SPRING.snap);
    const springScale = new Spring(1, SPRING.snap);

    let raf = 0;
    let last = performance.now();

    const onPointer = (event: PointerEvent): void => {
      const rect = element.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < radius) {
        // Falls off toward the edge of the radius, so the pull is strongest
        // when the cursor is directly over the button.
        const falloff = 1 - distance / radius;
        springX.setTarget(dx * pull * falloff);
        springY.setTarget(dy * pull * falloff);
        springScale.setTarget(1 + falloff * 0.06);
      } else {
        springX.setTarget(0);
        springY.setTarget(0);
        springScale.setTarget(1);
      }
    };

    const frame = (now: number): void => {
      const delta = now - last;
      last = now;

      const x = springX.step(delta);
      const y = springY.step(delta);
      const s = springScale.step(delta);

      element.style.transform =
        'translate3d(' + String(x) + 'px,' + String(y) + 'px,0) scale(' + String(s) + ')';

      raf = requestAnimationFrame(frame);
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
    };
  }, [radius, pull]);

  const extra = external
    ? { target: '_blank', rel: 'noreferrer' }
    : {};

  return (
    <a ref={ref} href={href} className={className} style={{ willChange: 'transform', display: 'inline-block' }} {...extra}>
      {children}
    </a>
  );
}

/**
 * A vignette that tightens with scroll speed.
 *
 * Fast movement narrows the readable area, which mimics the way peripheral
 * vision degrades under motion. It is subtle by design — noticeable only when
 * it is absent.
 *
 * @param props - current scroll velocity
 * @returns the overlay
 */
export function SpeedVignette({ velocity }: { velocity: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const velocityRef = useRef(velocity);

  useEffect(() => {
    velocityRef.current = velocity;
  }, [velocity]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const spring = new Spring(0, SPRING.glide);
    let raf = 0;
    let last = performance.now();

    const frame = (now: number): void => {
      const delta = now - last;
      last = now;

      spring.setTarget(Math.abs(velocityRef.current));
      const v = spring.step(delta);

      const inner = 72 - v * 30;
      const alpha = 0.35 + v * 0.4;

      element.style.background =
        'radial-gradient(ellipse at 50% 50%, transparent ' +
        String(inner) +
        '%, rgba(7,11,16,' +
        String(alpha) +
        ') 100%)';

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed inset-0 z-30"
      aria-hidden="true"
      style={{ willChange: 'background' }}
    />
  );
}