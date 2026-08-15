/**
 * Application shell.
 *
 * Sized to a single viewport with no scrolling. Judges view this on a projector
 * from the back of a room, so nothing important may sit below the fold.
 *
 * The left rail is the persistent state indicator: it shows which phase the run
 * is in and fills as phases complete. The centre holds the binding (stage C) and
 * the three check cards.
 */

import { useWallet } from '@txnlab/use-wallet-react';
import { AnimatePresence, motion } from 'motion/react';
import { Hud } from './components/Hud.js';
import { SourcingForm } from './features/sourcing/SourcingForm.js';
import { CheckCard } from './features/checks/CheckCard.js';
import { Aborted, Failed, Settled } from './features/settlement/Outcome.js';
import { useSourcingRun } from './hooks/useSourcingRun.js';
import { TheBinding } from './features/binding/TheBinding.js';
import { CHECK_IDS, checkStatus, isBusy, useRunStore } from './store/useRunStore.js';
import { formatAmount } from './lib/format.js';

/** Phases shown on the left rail, in order. */
const RAIL = [
  { id: 'quoting', label: 'Quote' },
  { id: 'signing', label: 'Sign' },
  { id: 'verifying', label: 'Verify' },
  { id: 'settling', label: 'Settle' },
] as const;

/** Which group slot each check is paid from. */
const SLOT = { price: 1, availability: 2, verification: 3 } as const;

export default function App() {
  const { activeAddress } = useWallet();
  const run = useSourcingRun();
  const store = useRunStore();

  const busy = isBusy(store.phase);
  const decimals = store.asset?.decimals ?? 6;
  const symbol = store.asset?.symbol ?? 'aUSDC';

  /**
   * How far through the rail we are.
   *
   * Terminal phases count as complete, so the rail does not appear stuck after
   * a run finishes.
   */
  const railIndex = (() => {
    if (store.phase === 'settled' || store.phase === 'aborted') return RAIL.length;
    if (store.phase === 'awaiting_signature') return 1;
    const found = RAIL.findIndex((entry) => entry.id === store.phase);
    return found === -1 ? 0 : found;
  })();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-void">
      <Hud
        assetSymbol={symbol}
        balanceDisplay={
          store.grandTotalAtomic !== '0'
            ? formatAmount(store.grandTotalAtomic, decimals)
            : null
        }
      />

      <main className="grid-bg relative flex min-h-0 flex-1">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 55% 45%, transparent 0%, var(--void) 80%)',
          }}
          aria-hidden="true"
        />

        {/* ---- left rail: persistent phase indicator ---- */}
        <aside className="relative hidden w-48 shrink-0 border-r hairline px-5 py-6 lg:block">
          <p className="mb-5 font-mono text-[9px] uppercase tracking-[0.24em] text-[var(--graphite-dim)]">
            Run phase
          </p>

          <ol className="space-y-4">
            {RAIL.map((entry, index) => {
              const done = index < railIndex;
              const active = store.phase === entry.id;

              return (
                <li key={entry.id} className="flex items-center gap-3">
                  <span
                    className={
                      'h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300 ' +
                      (active
                        ? 'bg-brass'
                        : done
                          ? 'bg-verify'
                          : 'bg-[var(--hairline)]')
                    }
                  />
                  <span
                    className={
                      'font-mono text-[11px] uppercase tracking-wider transition-colors duration-300 ' +
                      (active
                        ? 'text-brass'
                        : done
                          ? 'text-graphite'
                          : 'text-[var(--graphite-dim)]')
                    }
                  >
                    {entry.label}
                  </span>
                </li>
              );
            })}
          </ol>

          {run.signerLabel && (
            <div className="absolute bottom-6 left-5 right-5 border-t hairline pt-4">
              <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--graphite-dim)]">
                Signer
              </p>
              <p className="mt-1 truncate font-mono text-[10px] text-graphite">
                {run.signerLabel}
              </p>
            </div>
          )}
        </aside>

        {/* ---- centre ---- */}
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-6">
          <AnimatePresence mode="wait">
            {/* ---- idle: headline and form ---- */}
            {store.phase === 'idle' && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col items-center"
              >
                <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.24em] text-graphite">
                  Algorand · x402 · atomic settlement
                </p>

                <h1 className="max-w-3xl text-center font-display text-4xl font-extrabold uppercase leading-[0.92] tracking-tightest text-chalk lg:text-5xl">
                  Payment bound to <span className="text-brass">outcome</span>
                </h1>

                <p className="mt-4 max-w-md text-center text-[13px] leading-relaxed text-graphite">
                  Three checks, one settlement. Every check passes and one
                  guaranteed payment fires, or nothing moves at all.
                </p>

                <div className="mt-8">
                  {activeAddress ? (
                    <SourcingForm onSubmit={(request) => void run.start(request)} disabled={busy} />
                  ) : (
                    <p className="font-mono text-[11px] text-[var(--graphite-dim)]">
                      Connect a TestNet wallet to begin
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {/* ---- settled ---- */}
            {store.phase === 'settled' && store.txId && store.explorerUrl && (
              <motion.div key="settled" exit={{ opacity: 0 }}>
                <Settled
                  txId={store.txId}
                  explorerUrl={store.explorerUrl}
                  totalPaidAtomic={store.totalPaidAtomic ?? '0'}
                  assetSymbol={symbol}
                  assetDecimals={decimals}
                  onReset={run.reset}
                />
              </motion.div>
            )}

            {/* ---- aborted ---- */}
            {store.phase === 'aborted' && (
              <motion.div key="aborted" exit={{ opacity: 0 }}>
                <Aborted
                  reason={store.abortReason ?? 'One or more checks failed'}
                  failedChecks={store.failedChecks}
                  onReset={run.reset}
                />
              </motion.div>
            )}

            {/* ---- error ---- */}
            {store.phase === 'error' && (
              <motion.div key="error" exit={{ opacity: 0 }}>
                <Failed
                  message={store.errorMessage ?? 'Something went wrong'}
                  detail={store.errorDetail}
                  onReset={run.reset}
                />
              </motion.div>
            )}

            {/* ---- in flight ---- */}
            {busy || store.phase === 'awaiting_signature' ? (
              <motion.div
                key="running"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex w-full max-w-3xl flex-col items-center"
              >
                <PhaseHeading phase={store.phase} />

                {/* Where THE BINDING renders in stage C. */}
                <div className="mt-2 w-full max-w-4xl">
                  <TheBinding
                    phase={store.phase}
                    groupId={null}
                    verdicts={store.verdicts}
                    failedChecks={store.failedChecks}
                  />
                </div>

                <div className="mt-6 flex w-full gap-3">
                  {CHECK_IDS.map((checkId, index) => (
                    <CheckCard
                      key={checkId}
                      checkId={checkId}
                      status={checkStatus(store.phase, checkId, store.verdicts)}
                      reason={
                        store.verdicts.find((v) => v.checkId === checkId)?.reason ?? null
                      }
                      paymentIndex={SLOT[checkId]}
                      order={index}
                    />
                  ))}
                </div>

                {store.grandTotalAtomic !== '0' && (
                  <div className="mt-5 flex gap-8 font-mono text-[11px]">
                    <Figure label="Fees" value={formatAmount(store.totalFeesAtomic, decimals)} symbol={symbol} />
                    <Figure label="Order" value={formatAmount(store.orderTotalAtomic, decimals)} symbol={symbol} />
                    <Figure label="Total" value={formatAmount(store.grandTotalAtomic, decimals)} symbol={symbol} accent />
                  </div>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

/**
 * The heading shown during a run.
 *
 * @param props - the current phase
 * @returns a heading describing what is happening now
 */
function PhaseHeading({ phase }: { phase: string }) {
  const text =
    phase === 'quoting'
      ? 'Collecting quotes'
      : phase === 'awaiting_signature'
        ? 'Group built'
        : phase === 'signing'
          ? 'Waiting for your signature'
          : phase === 'verifying'
            ? 'Verifying all three checks'
            : 'Settling on Algorand';

  const sub =
    phase === 'quoting'
      ? 'three services, three 402 challenges'
      : phase === 'awaiting_signature'
        ? 'five transactions, one group id'
        : phase === 'signing'
          ? 'approve in your wallet. slot 0 stays unsigned for the facilitator'
          : phase === 'verifying'
            ? 'same signed group, three payment indices, no money moved yet'
            : 'one submission, five transactions, all or nothing';

  return (
    <div className="text-center">
      <motion.h2
        key={phase}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-display text-2xl font-extrabold uppercase tracking-tightest text-chalk"
      >
        {text}
      </motion.h2>
      <p className="mt-1 font-mono text-[10px] tracking-wider text-[var(--graphite-dim)]">
        {sub}
      </p>
    </div>
  );
}

/**
 * A labelled figure in the totals row.
 *
 * @param props - label, value, symbol and whether to accent it
 * @returns the figure
 */
function Figure({
  label,
  value,
  symbol,
  accent,
}: {
  label: string;
  value: string;
  symbol: string;
  accent?: boolean;
}) {
  return (
    <div className="text-center">
      <p className="text-[9px] uppercase tracking-wider text-[var(--graphite-dim)]">
        {label}
      </p>
      <p className={'tabular mt-0.5 text-[13px] ' + (accent ? 'text-brass' : 'text-chalk')}>
        {value} <span className="text-[10px] text-graphite">{symbol}</span>
      </p>
    </div>
  );
}