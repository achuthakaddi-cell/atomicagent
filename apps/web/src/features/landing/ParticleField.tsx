/**
 * The ambient background.
 *
 * A canvas particle field that reacts to the cursor and drifts with scroll.
 * It sits behind everything at low opacity, so the page never looks static
 * even when nothing else is moving.
 *
 * Particles connect to their nearest neighbours with faint lines, which reads
 * as a network forming and re-forming — the right ambient idea for a page
 * about transactions binding together.
 */

import { useEffect, useRef } from 'react';

interface ParticleFieldProps {
  /** Page scroll progress, 0 to 1. Shifts hue and drift speed. */
  progress: number;
}

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

const COUNT = 90;
const LINK_DISTANCE = 130;

export function ParticleField({ progress }: ParticleFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(progress);
  const pointerRef = useRef({ x: -999, y: -999 });

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    /**
     * Sizes the canvas to the viewport.
     */
    const resize = (): void => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();

    const dots: Dot[] = [];
    for (let i = 0; i < COUNT; i += 1) {
      dots.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        size: 0.8 + Math.random() * 1.4,
      });
    }

    /**
     * Tracks the cursor so particles can be repelled by it.
     *
     * @param event - pointer event
     */
    const onPointer = (event: PointerEvent): void => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };

    const onLeave = (): void => {
      pointerRef.current = { x: -999, y: -999 };
    };

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerleave', onLeave);

    let raf = 0;

    /**
     * The render loop.
     */
    const frame = (): void => {
      ctx.clearRect(0, 0, width, height);

      const p = progressRef.current;
      const pointer = pointerRef.current;

      // Colour shifts from cold blue toward brass as the page progresses,
      // so the background warms as the story approaches settlement.
      const r = Math.round(74 + p * 158);
      const g = Math.round(127 + p * 57);
      const b = Math.round(181 - p * 106);

      for (const dot of dots) {
        if (!reduce) {
          dot.x += dot.vx;
          dot.y += dot.vy;

          // Repel from the cursor.
          const dx = dot.x - pointer.x;
          const dy = dot.y - pointer.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 120 && distance > 0) {
            dot.x += (dx / distance) * 1.4;
            dot.y += (dy / distance) * 1.4;
          }

          if (dot.x < 0) dot.x = width;
          if (dot.x > width) dot.x = 0;
          if (dot.y < 0) dot.y = height;
          if (dot.y > height) dot.y = 0;
        }

        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.5)';
        ctx.fill();
      }

      // Links between near neighbours.
      for (let i = 0; i < dots.length; i += 1) {
        const a = dots[i];
        if (!a) continue;

        for (let j = i + 1; j < dots.length; j += 1) {
          const b2 = dots[j];
          if (!b2) continue;

          const dx = a.x - b2.x;
          const dy = a.y - b2.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance > LINK_DISTANCE) continue;

          const alpha = (1 - distance / LINK_DISTANCE) * 0.16;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b2.x, b2.y);
          ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(3) + ')';
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    />
  );
}