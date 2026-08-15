/**
 * The mechanism section, scroll-scrubbed.
 *
 * The section pins and the reader's scroll drives the assembly of the atomic
 * group directly. Slots fly in from alternating sides, the spine descends, the
 * group locks, and the whole thing plays backward if they scroll up.
 *
 * The diagram encodes the real layout: slot 0 is the facilitator's fee payer,
 * slots 1 to 3 are the three checks, slot 4 is the order payment. Those are the
 * same indices the services verify against.
 */

import { Pinned, map, easeOut } from './Pinned.js';

const SLOTS = [
  { index: 0, label: 'fee payer', detail: 'facilitator signs · covers every fee', who: 'facilitator', from: -1 },
  { index: 1, label: 'price check', detail: '0.01 · is the unit price within your ceiling', who: 'buyer', from: 1 },
  { index: 2, label: 'stock check', detail: '0.01 · enough units, dispatched in time', who: 'buyer', from: -1 },
  { index: 3, label: 'seller check', detail: '0.01 · GST active, licence valid', who: 'buyer', from: 1 },
  { index: 4, label: 'order payment', detail: 'the money that actually buys the goods', who: 'buyer', from: -1 },
];

export function Mechanism() {
  return (
    <Pinned length={4}>
      {(p) => <MechanismFrame progress={p} />}
    </Pinned>
  );
}

/**
 * One frame of the mechanism animation.
 *
 * @param props - scrub progress, 0 to 1
 * @returns the rendered frame
 */
function MechanismFrame({ progress }: { progress: number }) {
  // The heading recedes as the diagram takes over.
  const headOpacity = 1 - map(progress, 0.12, 0.28);
  const headScale = 1 - map(progress, 0.12, 0.28) * 0.12;

  // Slots arrive between 15% and 62% of the scrub.
  const assemble = map(progress, 0.15, 0.62);

  // The spine descends and locks the group between 60% and 85%.
  const bind = map(progress, 0.6, 0.85);

  // The whole diagram pulls tighter as it binds.
  const tighten = easeOut(bind);

  return (
    <div className="relative w-full max-w-3xl px-6">
      {/* Heading, receding. */}
      <div
        className="absolute inset-x-0 -top-4 text-center"
        style={{
          opacity: headOpacity,
          transform: 'scale(' + String(headScale) + ') translateY(' + String((1 - headOpacity) * -40) + 'px)',
        }}
      >
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.28em] text-graphite">
          How it works
        </p>
        <h2 className="font-display text-3xl font-extrabold uppercase leading-[0.95] tracking-tightest text-chalk lg:text-5xl">
          One group. Five transactions.
        </h2>
      </div>

      {/* The group assembling. */}
      <div
        className="relative"
        style={{
          transform: 'translateY(' + String(map(progress, 0.12, 0.32) * -30 + 60) + 'px)',
        }}
      >
        {SLOTS.map((slot, i) => {
          // Each slot gets its own window inside the assemble range.
          const local = easeOut(map(assemble, i * 0.15, i * 0.15 + 0.32));
          const bound = bind > 0.05;

          // Slots fly in from alternating sides and rotate into place.
          const offsetX = (1 - local) * slot.from * 320;
          const rotate = (1 - local) * slot.from * 12;

          // Rows pull toward each other as the group binds.
          const gap = (i - 2) * (1 - tighten * 0.35) * 4;

          return (
            <div
              key={slot.index}
              className="mb-2 flex items-center gap-4"
              style={{
                opacity: local,
                transform:
                  'translateX(' + String(offsetX) + 'px) ' +
                  'translateY(' + String(gap) + 'px) ' +
                  'rotate(' + String(rotate) + 'deg)',
              }}
            >
              <span className="w-6 shrink-0 text-right font-mono text-[11px] text-[var(--graphite-dim)]">
                {slot.index}
              </span>

              <div
                className="flex-1 rounded border px-4 py-3"
                style={{
                  borderColor: bound ? 'var(--brass-dim)' : 'var(--hairline)',
                  background: bound ? 'rgba(232,184,75,' + String(0.03 + tighten * 0.06) + ')' : 'rgba(13,25,38,0.55)',
                  boxShadow: bound ? '0 0 ' + String(tighten * 26) + 'px -10px var(--brass)' : 'none',
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-chalk">{slot.label}</span>
                  <span
                    className="shrink-0 font-mono text-[9px] uppercase tracking-wider"
                    style={{ color: slot.who === 'facilitator' ? 'var(--verify)' : 'var(--graphite-dim)' }}
                  >
                    {slot.who}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--graphite-dim)]">
                  {slot.detail}
                </p>
              </div>
            </div>
          );
        })}

        {/* The spine. Descends through the stack as the group binds. */}
        <div
          className="pointer-events-none absolute left-[14px] top-0 w-[2px] rounded"
          style={{
            height: String(tighten * 100) + '%',
            background: 'var(--brass)',
            boxShadow: tighten > 0.1 ? '0 0 ' + String(tighten * 20) + 'px var(--brass)' : 'none',
            opacity: tighten,
          }}
        />
      </div>

      {/* The claim, arriving last. */}
      <p
        className="mt-8 text-center font-mono text-[11px] uppercase tracking-[0.24em]"
        style={{
          opacity: map(progress, 0.82, 0.95),
          color: 'var(--brass)',
          transform: 'translateY(' + String((1 - map(progress, 0.82, 0.95)) * 14) + 'px)',
        }}
      >
        Bound by one group id
      </p>
    </div>
  );
}