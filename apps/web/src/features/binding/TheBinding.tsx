/**
 * THE BINDING — Crystal Lattice.
 *
 * ~200 particles drift in chaos. As settlement begins they snap, one by one,
 * into a rigid crystalline grid, bonds firing between neighbours as each locks.
 * Every lock shakes the frame; the final one triggers a white flash.
 *
 * WHY A LATTICE
 * -------------
 * An Algorand atomic group is bound by one 32-byte group id shared across every
 * transaction. Before settlement those transactions are independent and
 * unordered; after it they are a single rigid structure that cannot be broken
 * apart. Chaos becoming one bound lattice is that, literally.
 *
 * WHY FAILURE SHATTERS
 * --------------------
 * Nothing broke. The group was signed and never submitted. So the particles
 * blow apart and leave an empty field. The animation shows absence, which is
 * the honest thing to show.
 *
 * WHY CANVAS
 * ----------
 * Two hundred independently moving particles plus their bonds, at sixty frames
 * a second, is not something the DOM does well. Canvas draws the lot in one
 * pass.
 */

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import type { CheckVerdict } from '../../lib/api.js';
import type { RunPhase } from '../../store/useRunStore.js';

interface TheBindingProps {
  phase: RunPhase;
  groupId: string | null;
  verdicts: CheckVerdict[];
  failedChecks: string[];
}

/** Logical canvas size. Scaled by devicePixelRatio for sharpness. */
const W = 1000;
const H = 300;

/** Lattice dimensions. 24 x 8 = 192 particles. */
const COLS = 24;
const ROWS = 8;
const N = COLS * ROWS;

const COLOUR = {
  idle: [90, 110, 135] as const,
  pending: [74, 127, 181] as const,
  verify: [53, 214, 164] as const,
  brass: [232, 184, 75] as const,
  halt: [255, 92, 77] as const,
};

/** One particle in the lattice. */
interface Node {
  x: number;
  y: number;
  /** Target position once locked. */
  tx: number;
  ty: number;
  /** Velocity, used during the shatter. */
  vx: number;
  vy: number;
  /** Drift phase, so idle motion is not uniform. */
  phase: number;
  locked: boolean;
  /** When this node locks, in seconds from the start of binding. */
  lockAt: number;
  /** Which lane row this node belongs to, for verdict colouring. */
  lane: number;
}

/**
 * Decodes base64 to bytes. The browser has no Buffer.
 *
 * @param value - base64 string
 * @returns bytes, empty on failure
 */
function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

/**
 * Formats an rgb triple with alpha.
 *
 * @param c - colour
 * @param alpha - opacity
 * @returns a css rgba string
 */
function rgba(c: readonly [number, number, number], alpha: number): string {
  return (
    'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha.toFixed(3) + ')'
  );
}

export function TheBinding({
  phase,
  groupId,
  verdicts,
  failedChecks,
}: TheBindingProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduceMotion = useReducedMotion();

  // Live values the loop reads without restarting.
  const phaseRef = useRef(phase);
  const verdictsRef = useRef(verdicts);
  const failedRef = useRef(failedChecks);
  const groupIdRef = useRef(groupId);
  const phaseStartRef = useRef(performance.now());

  useEffect(() => {
    if (phaseRef.current !== phase) phaseStartRef.current = performance.now();
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    verdictsRef.current = verdicts;
  }, [verdicts]);

  useEffect(() => {
    failedRef.current = failedChecks;
  }, [failedChecks]);

  useEffect(() => {
    groupIdRef.current = groupId;
  }, [groupId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const padX = 80;
    const padY = 42;
    const stepX = (W - padX * 2) / (COLS - 1);
    const stepY = (H - padY * 2 - 24) / (ROWS - 1);

    /**
     * Builds the node set.
     *
     * Lock order is derived from the group id when one exists, so the sequence
     * in which the lattice forms is determined by the actual hash. Every run
     * locks in a different order.
     *
     * @returns the nodes
     */
    const buildNodes = (): Node[] => {
      const bytes = base64ToBytes(groupIdRef.current ?? '');
      const nodes: Node[] = [];

      for (let i = 0; i < N; i += 1) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const byte = bytes.length > 0 ? (bytes[i % bytes.length] ?? 128) : (i * 37) % 255;

        nodes.push({
          // Start near the eventual position rather than fully random, so the
          // field reads as a loose cloud of the right shape from the first
          // frame instead of noise scattered across the whole canvas.
          x: padX + col * stepX + (Math.random() - 0.5) * 140,
          y: padY + row * stepY + (Math.random() - 0.5) * 90,
          tx: padX + col * stepX,
          ty: padY + row * stepY,
          vx: 0,
          vy: 0,
          phase: Math.random() * Math.PI * 2,
          locked: false,
          // Byte drives lock timing, so the hash choreographs the formation.
          lockAt: 0.12 + (byte / 255) * 1.35,
          lane: row,
        });
      }

      return nodes;
    };

    let nodes = buildNodes();
    let shake = 0;
    let flash = 0;
    let flashed = false;
    let lastPhase: RunPhase = phase;
    let raf = 0;

    const start = performance.now();

    /**
     * Resets the field when the phase changes.
     *
     * @param next - the new phase
     */
    const onPhaseChange = (next: RunPhase): void => {
      shake = 0;
      flash = 0;
      flashed = false;

      if (next === 'settling') {
        // Rebuild so lock order reflects the real group id, now that we have it.
        nodes = buildNodes();
      }

      if (next === 'aborted') {
        for (const node of nodes) {
          const angle = Math.random() * Math.PI * 2;
          const force = 2 + Math.random() * 7;
          node.vx = Math.cos(angle) * force;
          node.vy = Math.sin(angle) * force;
          node.locked = false;
        }
        shake = 1;
      }

      if (next === 'idle') nodes = buildNodes();
    };

    /**
     * The render loop.
     *
     * @param now - high resolution timestamp
     */
    const frame = (now: number): void => {
      const currentPhase = phaseRef.current;

      if (currentPhase !== lastPhase) {
        onPhaseChange(currentPhase);
        lastPhase = currentPhase;
      }

      const t = (now - start) / 1000;
      const inPhase = (now - phaseStartRef.current) / 1000;

      const quoted = currentPhase !== 'idle';
      const probing = currentPhase === 'verifying';
      const binding = currentPhase === 'settling' || currentPhase === 'settled';
      const aborted = currentPhase === 'aborted';

      ctx.clearRect(0, 0, W, H);
      ctx.save();

      if (shake > 0.01) {
        ctx.translate(
          (Math.random() - 0.5) * shake * 18,
          (Math.random() - 0.5) * shake * 18,
        );
        shake *= 0.9;
      }

      // ---- update ----
      for (const node of nodes) {
        if (aborted) {
          node.x += node.vx;
          node.y += node.vy;
          node.vy += 0.24;
          node.vx *= 0.99;
          continue;
        }

        if (binding) {
          if (inPhase > node.lockAt && !node.locked) {
            node.locked = true;
            if (Math.random() < 0.08) shake = Math.min(1, shake + 0.2);
          }

          if (node.locked) {
            // Snap hard, with a little overshoot from the spring-like factor.
            node.x += (node.tx - node.x) * 0.34;
            node.y += (node.ty - node.y) * 0.34;
          } else {
            node.x += Math.sin(t * 3.2 + node.phase) * 0.9;
            node.y += Math.cos(t * 2.6 + node.phase) * 0.9;
          }
          continue;
        }

        // Idle and verifying: gentle chaotic drift.
        const amp = quoted ? 0.55 : 0.8;
        node.x += Math.sin(t * 1.5 + node.phase) * amp;
        node.y += Math.cos(t * 1.2 + node.phase) * amp;
      }

      // ---- bonds ----
      if (binding) {
        ctx.globalCompositeOperation = 'lighter';

        for (let i = 0; i < N; i += 1) {
          const a = nodes[i];
          if (!a?.locked) continue;

          // Horizontal neighbour.
          if (i % COLS !== COLS - 1) {
            const b = nodes[i + 1];
            if (b?.locked) {
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.strokeStyle = rgba(COLOUR.brass, 0.4);
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }

          // Vertical neighbour.
          const c = nodes[i + COLS];
          if (c?.locked) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(c.x, c.y);
            ctx.strokeStyle = rgba(COLOUR.brass, 0.4);
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        ctx.globalCompositeOperation = 'source-over';
      }

      // ---- nodes ----
      for (const node of nodes) {
        const verdict = verdictsRef.current.find(
          (v) =>
            (v.checkId === 'price' && node.lane < 3) ||
            (v.checkId === 'availability' && node.lane >= 3 && node.lane < 6) ||
            (v.checkId === 'verification' && node.lane >= 6),
        );

        let colour: readonly [number, number, number] = COLOUR.idle;
        if (aborted) colour = COLOUR.halt;
        else if (node.locked) colour = COLOUR.brass;
        else if (binding) colour = COLOUR.pending;
        else if (verdict && !verdict.passed) colour = COLOUR.halt;
        else if (verdict?.passed) colour = COLOUR.verify;
        else if (quoted) colour = COLOUR.pending;

        const alpha = aborted ? 0.5 : node.locked ? 1 : quoted ? 0.75 : 0.35;
        const radius = node.locked ? 2.8 : 1.9;

        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = rgba(colour, alpha);

        if (node.locked) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = rgba(COLOUR.brass, 1);
        }

        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ---- verification sweep ----
      if (probing && !reduceMotion) {
        const sweep = (t * 0.45) % 1;
        const sx = sweep * W;

        const gradient = ctx.createLinearGradient(sx - 90, 0, sx + 10, 0);
        gradient.addColorStop(0, rgba(COLOUR.pending, 0));
        gradient.addColorStop(1, rgba(COLOUR.pending, 0.5));

        ctx.fillStyle = gradient;
        ctx.fillRect(sx - 90, 0, 100, H - 22);
      }

      // ---- final flash ----
      if (binding && !flashed) {
        const allLocked = nodes.every((node) => node.locked);
        if (allLocked) {
          flashed = true;
          flash = 1;
          shake = 1;
        }
      }

      ctx.restore();

      if (flash > 0.01) {
        ctx.fillStyle = 'rgba(255,240,210,' + (flash * 0.45).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        flash *= 0.88;
      }

      // ---- caption ----
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = rgba(COLOUR.idle, 0.7);

      const caption = binding
        ? flashed
          ? 'BOUND BY ONE GROUP ID'
          : 'BINDING'
        : aborted
          ? 'NEVER SUBMITTED'
          : probing
            ? 'VERIFYING — NO MONEY MOVED'
            : quoted
              ? 'FIVE TRANSACTIONS, UNBOUND'
              : 'AWAITING REQUEST';

      ctx.fillText(caption, W / 2, H - 8);

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
    };
    // `phase` is deliberately NOT a dependency. The loop reads it from
    // phaseRef, which updates without restarting anything. Including it here
    // would tear down and rebuild the canvas on every phase change, resetting
    // the particles mid-animation — which is exactly the bug this caused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  /**
   * Reduced-motion fallback.
   *
   * Renders the same information as a static diagram: five slots, their state,
   * and the group id. Someone with motion sensitivity gets the full meaning,
   * just without the animation.
   */
  if (reduceMotion) {
    const bound = phase === 'settling' || phase === 'settled';
    const broken = phase === 'aborted';

    const slots = [
      { label: 'fee payer', check: null },
      { label: 'price', check: 'price' },
      { label: 'availability', check: 'availability' },
      { label: 'verification', check: 'verification' },
      { label: 'order payment', check: null },
    ];

    return (
      <div className="w-full py-4">
        <div className="space-y-1.5">
          {slots.map((slot, index) => {
            const verdict = verdicts.find((v) => v.checkId === slot.check);
            const failed = verdict !== undefined && !verdict.passed;

            const colour = broken
              ? 'var(--halt)'
              : bound
                ? 'var(--brass)'
                : failed
                  ? 'var(--halt)'
                  : verdict?.passed
                    ? 'var(--verify)'
                    : 'var(--hairline)';

            return (
              <div key={index} className="flex items-center gap-3">
                <span className="w-24 text-right font-mono text-[9px] text-[var(--graphite-dim)]">
                  {slot.label}
                </span>
                <span
                  className="h-[2px] flex-1 rounded"
                  style={{ background: colour, opacity: broken ? 0.3 : 1 }}
                />
                <span className="w-4 font-mono text-[9px] text-[var(--graphite-dim)]">
                  {index}
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-center font-mono text-[9px] uppercase tracking-[0.2em] text-graphite">
          {bound
            ? 'Bound by one group id'
            : broken
              ? 'Never submitted'
              : 'Five transactions, one group'}
        </p>

        {groupId && (
          <p className="mt-1 text-center font-mono text-[8px] tracking-[0.14em] text-[var(--graphite-dim)]">
            {groupId}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          aspectRatio: String(W) + ' / ' + String(H),
          display: 'block',
        }}
        aria-label="Transactions binding into a single atomic group"
      />
      {groupId && (
        <p className="mt-0.5 text-center font-mono text-[8px] tracking-[0.14em] text-[var(--graphite-dim)]">
          {groupId}
        </p>
      )}
    </div>
  );
}