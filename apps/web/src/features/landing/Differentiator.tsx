/**
 * Why Algorand.
 *
 * A side-by-side comparison of what conditional settlement costs on each chain.
 * The two columns rise at different rates as the reader scrolls, which gives
 * the section depth without being decorative — the slower column is the one
 * carrying more weight.
 *
 * The claim here is specific and checkable: EVM and Solana x402 deployments
 * need a contract or a channel to bind payments together. Algorand has the
 * primitive in the base protocol.
 */

import { useScrollProgress, mapRange } from './useScrollProgress.js';

const ROWS = [
  { label: 'Bind several payments together', evm: 'Deploy an escrow contract', algo: 'Native atomic group' },
  { label: 'Contract risk to audit', evm: 'Yes', algo: 'None — no contract' },
  { label: 'Trusted hardware needed', evm: 'TEE, in published designs', algo: 'No' },
  { label: 'Wallet signatures per run', evm: 'One per service', algo: 'One, for all five' },
  { label: 'Network fee paid by buyer', evm: 'Gas, per transaction', algo: 'Zero — facilitator covers it' },
];

export function Differentiator() {
  const { ref, progress } = useScrollProgress<HTMLElement>();

  const enter = mapRange(progress, 0.2, 0.5, 0, 1);

  return (
    <section
      ref={ref}
      className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-32"
    >
      <div className="w-full max-w-4xl">
        <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-graphite">
          Why Algorand
        </p>

        <h2 className="mb-4 text-center font-display text-3xl font-extrabold uppercase leading-[0.95] tracking-tightest text-chalk lg:text-5xl">
          The primitive
          <br />
          was already there
        </h2>

        <p className="mx-auto mb-12 max-w-xl text-center text-[14px] leading-relaxed text-graphite">
          Research on x402 identifies the same gap: payment is not bound to
          whether the service actually delivered. Published fixes reach for
          trusted hardware or zero-knowledge proofs. On Algorand the mechanism
          is in the protocol.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {/* EVM column rises slower, so it trails behind. */}
          <div
            className="rounded border hairline bg-blueprint/40 p-5"
            style={{
              opacity: enter,
              transform: 'translateY(' + String((1 - enter) * 48) + 'px)',
            }}
          >
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--graphite-dim)]">
              EVM &amp; SVM x402
            </p>
            {ROWS.map((row) => (
              <div key={row.label} className="border-t hairline py-2.5 first:border-t-0 first:pt-0">
                <p className="text-[10px] text-[var(--graphite-dim)]">{row.label}</p>
                <p className="mt-0.5 text-[13px] text-graphite">{row.evm}</p>
              </div>
            ))}
          </div>

          {/* Algorand column rises faster and arrives first. */}
          <div
            className="rounded border border-[var(--brass-dim)] bg-brass/5 p-5"
            style={{
              opacity: enter,
              transform: 'translateY(' + String((1 - enter) * 20) + 'px)',
            }}
          >
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-brass">
              Algorand x402
            </p>
            {ROWS.map((row) => (
              <div key={row.label} className="border-t hairline py-2.5 first:border-t-0 first:pt-0">
                <p className="text-[10px] text-[var(--graphite-dim)]">{row.label}</p>
                <p className="mt-0.5 text-[13px] text-chalk">{row.algo}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-xl text-center font-mono text-[11px] leading-relaxed text-[var(--graphite-dim)]">
          We did not invent atomic groups. Algorand gave us the primitive. Our
          contribution is applying it to multi-service x402 orchestration.
        </p>
      </div>
    </section>
  );
}