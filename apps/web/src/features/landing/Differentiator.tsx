/**
 * Why Algorand, as a flight through space.
 *
 * The reader travels forward through a corridor of claims. Each row sits at a
 * different depth and on alternating sides, so they pass either side of the
 * viewport rather than scrolling by on a flat plane.
 *
 * Depths are deliberately close together and the cards are large. An earlier
 * version spaced them widely, which looked impressive and was unreadable — the
 * point of the section is the argument, not the effect.
 */

import { DepthStage, DepthLayer } from './DepthStage.js';

const TRAVEL = 7000;

const ROWS = [
  {
    z: -1900,
    x: -140,
    label: 'Bind several payments together',
    evm: 'Deploy an escrow contract',
    algo: 'Native atomic group',
  },
  {
    z: -3000,
    x: 150,
    label: 'Contract risk to audit',
    evm: 'Yes',
    algo: 'None — there is no contract',
  },
  {
    z: -4100,
    x: -130,
    label: 'Trusted hardware needed',
    evm: 'TEE, in published designs',
    algo: 'No',
  },
  {
    z: -5200,
    x: 160,
    label: 'Wallet signatures per run',
    evm: 'One per service',
    algo: 'One, covering all five',
  },
  {
    z: -6300,
    x: -120,
    label: 'Network fee paid by buyer',
    evm: 'Gas, per transaction',
    algo: 'Zero — the facilitator covers it',
  },
];

export function Differentiator() {
  return (
    <DepthStage length={7} travel={TRAVEL}>
      {(p) => (
        <>
          {/* Title, closest, read and passed first. */}
          <DepthLayer z={-700} progress={p} travel={TRAVEL}>
            <div className="w-[88vw] max-w-3xl text-center">
              <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.28em] text-graphite">
                Why Algorand
              </p>
              <h2 className="font-display text-4xl font-extrabold uppercase leading-[0.92] tracking-tightest text-chalk lg:text-6xl">
                The primitive was already there
              </h2>
            </div>
          </DepthLayer>

          {ROWS.map((row) => (
            <DepthLayer
              key={row.label}
              z={row.z}
              x={row.x}
              progress={p}
              travel={TRAVEL}
            >
              <div className="w-[86vw] max-w-2xl rounded-lg border border-[var(--hairline)] bg-blueprint/90 p-8 backdrop-blur-md">
                <p className="mb-5 font-mono text-[13px] uppercase tracking-[0.16em] text-chalk">
                  {row.label}
                </p>

                <div className="flex items-start gap-6">
                  <div className="flex-1 border-r hairline pr-6">
                    <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--graphite-dim)]">
                      EVM · SVM
                    </p>
                    <p className="text-[17px] leading-snug text-graphite">{row.evm}</p>
                  </div>

                  <div className="flex-1">
                    <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-brass">
                      Algorand
                    </p>
                    <p className="text-[17px] font-medium leading-snug text-chalk">
                      {row.algo}
                    </p>
                  </div>
                </div>
              </div>
            </DepthLayer>
          ))}

          {/* The closing line, furthest away, reached last. */}
          <DepthLayer z={-7400} progress={p} travel={TRAVEL}>
            <p className="w-[84vw] max-w-xl text-center text-[16px] leading-relaxed text-graphite">
              We did not invent atomic groups. Algorand gave us the primitive.
              Our contribution is applying it to multi-service x402
              orchestration.
            </p>
          </DepthLayer>
        </>
      )}
    </DepthStage>
  );
}