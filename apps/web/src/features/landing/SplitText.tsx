/**
 * Character-split text reveal.
 *
 * Each character animates in independently with a stagger, so headlines
 * assemble rather than fade. This is the effect anime.js v4's text.split API
 * provides, implemented directly here because we need per-character control
 * over transform origin and the exit state.
 *
 * Words are kept intact as flex children so lines break normally and the text
 * stays selectable and readable to a screen reader.
 */

import { useEffect, useRef } from 'react';
import { useInView } from './useScrollProgress.js';

interface SplitTextProps {
  text: string;
  className?: string;
  /** Delay before the first character, in milliseconds. */
  delay?: number;
  /** Gap between characters, in milliseconds. */
  stagger?: number;
  /** Which characters to tint brass. Matched case-insensitively. */
  accent?: string;
}

export function SplitText({
  text,
  className = '',
  delay = 0,
  stagger = 22,
  accent,
}: SplitTextProps) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.2);
  const words = text.split(' ');

  let charIndex = 0;

  return (
    <span
      ref={ref}
      className={'inline-flex flex-wrap justify-center ' + className}
      // The full string is announced once; the per-character spans are hidden
      // from assistive tech so it does not read them letter by letter.
      aria-label={text}
    >
      {words.map((word, wordIndex) => {
        const isAccent =
          accent !== undefined && word.toLowerCase().includes(accent.toLowerCase());

        return (
          <span
            key={wordIndex}
            className="inline-flex whitespace-nowrap"
            aria-hidden="true"
          >
            {word.split('').map((char, i) => {
              const index = charIndex;
              charIndex += 1;

              return (
                <span
                  key={i}
                  className="inline-block"
                  style={{
                    color: isAccent ? 'var(--brass)' : undefined,
                    opacity: inView ? 1 : 0,
                    transform: inView
                      ? 'translateY(0) rotateX(0deg)'
                      : 'translateY(0.5em) rotateX(-70deg)',
                    transition:
                      'opacity 520ms cubic-bezier(0.16,1,0.3,1) ' +
                      String(delay + index * stagger) +
                      'ms, transform 620ms cubic-bezier(0.16,1,0.3,1) ' +
                      String(delay + index * stagger) +
                      'ms',
                    transformOrigin: 'center bottom',
                  }}
                >
                  {char}
                </span>
              );
            })}
            {wordIndex < words.length - 1 && (
              <span className="inline-block">&nbsp;</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/**
 * A number that counts up when it scrolls into view.
 *
 * Uses tabular figures so the width does not jump as digits change, which
 * would otherwise shift the surrounding layout on every frame.
 */
interface CountUpProps {
  to: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}

export function CountUp({
  to,
  duration = 1600,
  prefix = '',
  suffix = '',
  decimals = 0,
  className = '',
}: CountUpProps) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.4);
  const valueRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!inView) return;

    const node = valueRef.current;
    if (!node) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      node.textContent = prefix + to.toFixed(decimals) + suffix;
      return;
    }

    const start = performance.now();
    let raf = 0;

    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      // Ease out, so the number decelerates into its final value.
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = prefix + (to * eased).toFixed(decimals) + suffix;

      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [inView, to, duration, prefix, suffix, decimals]);

  return (
    <span ref={ref} className={className}>
      <span ref={valueRef} className="tabular">
        {prefix}0{suffix}
      </span>
    </span>
  );
}