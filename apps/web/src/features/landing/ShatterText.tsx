/**
 * Text as physics bodies.
 *
 * Every character is an independently simulated object with its own spring,
 * mass, spin, and depth. On scroll they blow apart, tumble through space, and
 * reassemble — driven by scrub progress, so the reader controls the explosion
 * and can run it backward.
 *
 * WHAT MAKES IT READ AS PHYSICAL
 * ------------------------------
 * A single spring per character moves cleanly and looks mechanical. Four things
 * fix that, and all four are running here:
 *
 *   1. Independent spin rate. Each character tumbles at its own speed, so the
 *      group never rotates in sympathy.
 *   2. Secondary wobble. A small sine oscillation layered on top of the spring
 *      path, phase-offset per character, so trajectories are not straight.
 *   3. Gravity. Downward acceleration that grows with scatter, so characters
 *      arc rather than travelling in a line.
 *   4. Velocity stretch and blur. Fast-moving characters smear along their
 *      direction of travel, which is what sells speed.
 *
 * WHY EACH CHARACTER GETS A SEED
 * ------------------------------
 * A deterministic pseudo-random value per character means the scatter looks
 * chaotic but is identical on every render and reload. Real randomness would
 * differ each remount, which reads as glitchy rather than designed.
 */

import { useEffect, useRef } from 'react';
import { Spring } from './physics.js';

interface ShatterTextProps {
  text: string;
  /** 0 assembled, 1 fully scattered. Drive from scrub progress. */
  scatter: number;
  className?: string;
  /** Characters in words matching this string are tinted brass. */
  accent?: string;
}

/** Per-character physics parameters, derived deterministically from index. */
interface CharBody {
  char: string;
  dx: number;
  dy: number;
  dz: number;
  /** Total tumble in degrees, per axis. */
  rx: number;
  ry: number;
  rz: number;
  /** Continuous spin rate, so tumbling does not stop at the target. */
  spin: number;
  /** Secondary wobble amplitude and phase. */
  wobbleAmp: number;
  wobblePhase: number;
  /** Heavier characters lag and fall faster. */
  mass: number;
  isAccent: boolean;
}

/**
 * Deterministic pseudo-random in the range -1 to 1.
 *
 * @param seed - any number
 * @returns a stable value for that seed
 */
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Builds the physics bodies for a string.
 *
 * @param text - the string
 * @param accent - words containing this are tinted brass
 * @returns one body per character, spaces included
 */
function buildBodies(text: string, accent?: string): CharBody[] {
  const bodies: CharBody[] = [];
  const words = text.split(' ');
  let index = 0;

  for (let w = 0; w < words.length; w += 1) {
    const word = words[w] ?? '';
    const isAccent =
      accent !== undefined && word.toLowerCase().includes(accent.toLowerCase());

    for (const char of word) {
      const r1 = rand(index * 3.1);
      const r2 = rand(index * 7.7 + 1.5);
      const r3 = rand(index * 5.3 + 9.1);

      bodies.push({
        char,
        // Much larger throw distances. Characters leave the viewport entirely.
        dx: r1 * 1100,
        dy: r2 * 700,
        dz: r3 * 1600,
        // Multiple full rotations, not a partial turn.
        rx: rand(index * 2.9 + 4.4) * 720,
        ry: rand(index * 6.1 + 2.2) * 900,
        rz: rand(index * 4.7 + 8.8) * 1080,
        // Continuous spin so tumbling never freezes mid-flight.
        spin: rand(index * 8.3 + 3.7) * 260,
        wobbleAmp: 30 + Math.abs(rand(index * 9.1)) * 90,
        wobblePhase: Math.abs(rand(index * 2.3)) * Math.PI * 2,
        // Wider mass spread, so the group separates hard rather than moving together.
        mass: 0.45 + Math.abs(rand(index * 1.3)) * 2.9,
        isAccent,
      });
      index += 1;
    }

    if (w < words.length - 1) {
      bodies.push({
        char: ' ',
        dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0,
        spin: 0, wobbleAmp: 0, wobblePhase: 0,
        mass: 1,
        isAccent: false,
      });
      index += 1;
    }
  }

  return bodies;
}

export function ShatterText({
  text,
  scatter,
  className = '',
  accent,
}: ShatterTextProps) {
  const bodies = buildBodies(text, accent);
  const elementsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const scatterRef = useRef(scatter);

  useEffect(() => {
    scatterRef.current = scatter;
  }, [scatter]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      elementsRef.current.forEach((element) => {
        if (element) {
          element.style.transform = 'none';
          element.style.opacity = String(1 - scatterRef.current);
        }
      });
      return;
    }

    // One spring per character. Low damping relative to stiffness produces
    // overshoot, which is what stops the motion looking like a slide.
    const springs = bodies.map(
      (body) =>
        new Spring(0, {
          stiffness: 190 / body.mass,
          damping: 11 / Math.sqrt(body.mass),
          mass: body.mass,
        }),
    );

    let raf = 0;
    let last = performance.now();
    let elapsed = 0;

    const frame = (now: number): void => {
      const delta = now - last;
      last = now;
      elapsed += delta / 1000;

      const target = scatterRef.current;

      for (let i = 0; i < springs.length; i += 1) {
        const spring = springs[i];
        const body = bodies[i];
        const element = elementsRef.current[i];

        if (!spring || !body || !element) continue;

        spring.setTarget(target);
        const s = spring.step(delta);

        if (body.char === ' ') continue;

        // ---- secondary motion ----
        //
        // A sine wobble layered on the spring path, scaled by how far the
        // character has travelled. Straight trajectories look computed; curved
        // ones look thrown.
        const wobbleX = Math.sin(elapsed * 2.1 + body.wobblePhase) * body.wobbleAmp * s;
        const wobbleY = Math.cos(elapsed * 1.7 + body.wobblePhase * 1.4) * body.wobbleAmp * 0.7 * s;

        // ---- gravity ----
        //
        // Downward acceleration proportional to scatter squared, so characters
        // arc rather than travelling in a line. Heavier ones fall faster.
        const gravity = s * s * 320 * body.mass;

        // ---- continuous tumble ----
        //
        // Spin keeps accumulating with time, so a character held mid-scatter
        // keeps rotating instead of freezing.
        const spinNow = body.spin * elapsed * s;

        // ---- velocity stretch ----
        const speed = Math.abs(spring.speed);
        const stretch = 1 + Math.min(0.9, speed * 0.5);
        const squash = 1 - Math.min(0.35, speed * 0.2);

        element.style.transform =
          'translate3d(' +
          String(body.dx * s + wobbleX) + 'px,' +
          String(body.dy * s + wobbleY + gravity) + 'px,' +
          String(body.dz * s) + 'px) ' +
          'rotateX(' + String(body.rx * s + spinNow) + 'deg) ' +
          'rotateY(' + String(body.ry * s + spinNow * 0.7) + 'deg) ' +
          'rotateZ(' + String(body.rz * s + spinNow * 1.3) + 'deg) ' +
          'scale(' + String(squash) + ',' + String(stretch) + ')';

        // Motion blur while travelling fast. Cheap and it sells velocity.
        element.style.filter = speed > 0.4 ? 'blur(' + String(Math.min(4, speed * 2.2)) + 'px)' : 'none';

        // Hold legibility until the characters are well clear of formation.
        element.style.opacity = String(Math.max(0, 1 - Math.max(0, s - 0.62) / 0.38));
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <span
      className={'inline-flex flex-wrap justify-center ' + className}
      style={{ perspective: '700px', transformStyle: 'preserve-3d' }}
      aria-label={text}
    >
      {bodies.map((body, i) => (
        <span
          key={i}
          ref={(element) => {
            elementsRef.current[i] = element;
          }}
          className="inline-block will-change-transform"
          style={{
            color: body.isAccent ? 'var(--brass)' : undefined,
            transformStyle: 'preserve-3d',
          }}
          aria-hidden="true"
        >
          {body.char === ' ' ? '\u00A0' : body.char}
        </span>
      ))}
    </span>
  );
}