/**
 * React bindings for the spring simulator.
 *
 * The simulation runs in a requestAnimationFrame loop and writes directly to
 * the DOM through a ref, never through React state. Setting state sixty times
 * a second would re-render the component tree on every frame, which is both
 * slow and unnecessary — nothing about the component's structure changes, only
 * a transform.
 */

import { useEffect, useRef } from 'react';
import { Spring, SpringGroup, SPRING } from './physics.js';
import type { SpringConfig } from './physics.js';

/**
 * Drives a single element's transform with a spring.
 *
 * @param target - the value to spring toward
 * @param apply - writes the sprung value to the element
 * @param config - spring characteristics
 * @returns a ref to attach to the element
 */
export function useSpringTransform<T extends HTMLElement>(
  target: number,
  apply: (element: T, value: number, velocity: number) => void,
  config: SpringConfig = SPRING.glide,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const springRef = useRef<Spring | null>(null);
  const targetRef = useRef(target);
  const applyRef = useRef(apply);

  useEffect(() => {
    targetRef.current = target;
    springRef.current?.setTarget(target);
  }, [target]);

  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      // No simulation. Apply the target directly and stop.
      applyRef.current(element, targetRef.current, 0);
      return;
    }

    const spring = new Spring(targetRef.current, config);
    springRef.current = spring;

    let raf = 0;
    let last = performance.now();

    const frame = (now: number): void => {
      const delta = now - last;
      last = now;

      const value = spring.step(delta);
      applyRef.current(element, value, spring.speed);

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      springRef.current = null;
    };
    // config is intentionally captured once. Changing spring characteristics
    // mid-flight would need the spring rebuilt, and nothing in this page does that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}

/**
 * Drives several elements with staggered springs.
 *
 * Used for rows of cards and split text, where each item should lag slightly
 * behind the one before it.
 *
 * @param count - how many elements
 * @param target - shared target value
 * @param apply - writes a sprung value to one element
 * @param options - stagger and spring characteristics
 * @returns a callback ref to attach to each element
 */
export function useSpringGroup<T extends HTMLElement>(
  count: number,
  target: number,
  apply: (element: T, value: number, index: number, velocity: number) => void,
  options: { stagger?: number; config?: SpringConfig } = {},
): (index: number) => (element: T | null) => void {
  const elementsRef = useRef<Array<T | null>>([]);
  const groupRef = useRef<SpringGroup | null>(null);
  const targetRef = useRef(target);
  const applyRef = useRef(apply);

  const stagger = options.stagger ?? 0.08;
  const config = options.config ?? SPRING.snap;

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      elementsRef.current.forEach((element, index) => {
        if (element) applyRef.current(element, targetRef.current, index, 0);
      });
      return;
    }

    const group = new SpringGroup(count, 0, config);
    groupRef.current = group;

    let raf = 0;
    let last = performance.now();

    const frame = (now: number): void => {
      const delta = now - last;
      last = now;

      // Each spring's target is the shared target, shifted by its stagger.
      // Item 0 reaches its target first; the rest follow.
      const t = targetRef.current;
      for (let i = 0; i < count; i += 1) {
        const offset = i * stagger;
        const local = Math.max(0, Math.min(1, (t - offset) / Math.max(0.01, 1 - offset)));
        group.setTarget(i, local);
      }

      const values = group.step(delta);

      elementsRef.current.forEach((element, index) => {
        const value = values[index];
        if (element && value !== undefined) {
          applyRef.current(element, value, index, 0);
        }
      });

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      groupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return (index: number) => (element: T | null) => {
    elementsRef.current[index] = element;
  };
}