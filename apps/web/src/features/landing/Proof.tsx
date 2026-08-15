/**
 * Proof and close.
 *
 * A real settled transaction group on Algorand TestNet, linked directly to the
 * explorer. This is the strongest thing on the page: independently verifiable
 * by anyone reading it, using software we did not write.
 */

import type { ReactNode } from 'react';
import { CountUp } from './SplitText.js';
import { useInView } from './useScrollProgress.js';

/** The settled group from a real run. Replace if you produce a better one. */
const TX_ID = '7AZWUWLU7AE4L7UBD3ZVKFG5D2ZP22OBVEGPYMOETB5WTOFEMW3Q';
const GROUP_ID = 'BzcTQY9A5wMiQ89cw11l75S7crtqad/EkZBys3tHCh4=';
const EXPLORER_URL = 'https://lora.algokit.io/testnet/transaction/' + TX_ID;
const REPO_URL = 'https://github.com/achuthakaddi-cell/atomicagent';

/** Shared link styling. */
const BTN_BRASS = 'rounded border border-[var(--brass-dim)] bg-brass/10 px-8 py-3.5 font-mono text-[11px] uppercase tracking-[0.2em] text-brass transition-all duration-200 hover:border-brass hover:bg-brass/20';
const BTN_GHOST = 'rounded border hairline px-6 py-3.5 font-mono text-[11px] uppercase tracking-[0.2em] text-graphite transition-colors duration-200 hover:border-[var(--graphite-dim)] hover:text-chalk';

/** The five slots of the settled group, as they appear on chain. */
const SLOTS = [
  { slot: 0, what: 'fee payer', amount: '0 ALGO' },
  { slot: 1, what: 'price check', amount: '0.01 aUSDC' },
  { slot: 2, what: 'stock check', amount: '0.01 aUSDC' },
  { slot: 3, what: 'seller check', amount: '0.01 aUSDC' },
  { slot: 4, what: 'order payment', amount: '2,500.00 aUSDC' },
];

/**
 * A labelled figure.
 *
 * @param props - label and value node
 * @returns the figure block
 */
function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded border hairline bg-blueprint/40 py-4 text-center">
      <p className="font-display text-2xl font-extrabold text-chalk">{value}</p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-[var(--graphite-dim)]">
        {label}
      </p>
    </div>
  );
}

/**
 * The proof section and page close.
 *
 * @returns the section
 */
export function Proof() {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);

  return (
    <section className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-32">
      <div ref={ref} className="w-full max-w-3xl">
        <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-graphite">
          Proof
        </p>

        <h2 className="mb-4 text-center font-display text-3xl font-extrabold uppercase leading-[0.95] tracking-tightest text-chalk lg:text-5xl">
          Settled on chain
        </h2>

        <p className="mx-auto mb-10 max-w-lg text-center text-[14px] leading-relaxed text-graphite">
          Not a diagram. A real transaction group on Algorand TestNet, verifiable
          by anyone with a browser.
        </p>

        <div className="rounded border border-[var(--brass-dim)] bg-brass/5 p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <span className="font-display text-[14px] font-extrabold uppercase tracking-tightest text-brass">
              One group · one block
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--graphite-dim)]">
              TestNet
            </span>
          </div>

          <div className="space-y-1.5">
            {SLOTS.map((row, i) => {
              const style = {
                opacity: inView ? 1 : 0,
                transform: inView ? 'translateX(0)' : 'translateX(-16px)',
                transition: 'all 500ms cubic-bezier(0.16,1,0.3,1) ' + String(i * 90) + 'ms',
              };

              return (
                <div key={row.slot} className="flex items-center gap-3 border-t hairline pt-1.5 first:border-t-0 first:pt-0" style={style}>
                  <span className="w-4 font-mono text-[10px] text-[var(--graphite-dim)]">
                    {row.slot}
                  </span>
                  <span className="flex-1 text-[12px] text-graphite">{row.what}</span>
                  <span className="tabular font-mono text-[12px] text-chalk">
                    {row.amount}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="mt-4 break-all border-t hairline pt-3 font-mono text-[9px] tracking-wider text-[var(--graphite-dim)]">
            group id {GROUP_ID}
          </p>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4">
          <Figure label="Transactions" value={<CountUp to={5} />} />
          <Figure label="Blocks" value={<CountUp to={1} />} />
          <Figure label="Buyer gas" value={<span className="tabular text-verify">0 ALGO</span>} />
        </div>

        <div className="mt-12 flex flex-wrap justify-center gap-3">
          <a href="/app" className={BTN_BRASS}>Launch the app</a>
          <a href={EXPLORER_URL} target="_blank" rel="noreferrer" className={BTN_GHOST}>Verify on explorer</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={BTN_GHOST}>Source</a>
        </div>

        <div className="mt-16 border-t hairline pt-8 text-center">
          <p className="font-display text-[13px] font-extrabold uppercase tracking-tightest text-chalk">
            G-SYNC
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-graphite">
            Achutha A Kaddi · Madhumitha D
          </p>
          <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--graphite-dim)]">
            Algorand · x402 AVM · React · TestNet
          </p>
        </div>
      </div>
    </section>
  );
}