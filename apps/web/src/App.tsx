/**
 * Application shell.
 *
 * A three-column instrument panel: run phase on the left, the binding and
 * checks in the centre, the spend ledger on the right. Everything a judge needs
 * to follow the run is on one screen with no scrolling.
 *
 * The right column is the differentiator. It shows the agent reasoning about
 * money in writing, as it happens.
 */

import { useWallet } from '@txnlab/use-wallet-react';
import { ServiceRegistry } from './features/services/ServiceRegistry.js';
import { AnimatePresence, motion } from 'motion/react';
import { Hud } from './components/Hud.js';
import { SourcingForm } from './features/sourcing/SourcingForm.js';
import { CheckCard } from './features/checks/CheckCard.js';
import { SpendLedger } from './features/spend/SpendLedger.js';
import { Aborted, Failed, Settled } from './features/settlement/Outcome.js';
import { TheBinding } from './features/binding/TheBinding.js';
import { useSourcingRun } from './hooks/useSourcingRun.js';
import { CHECK_IDS, checkStatus, isBusy, useRunStore } from './store/useRunStore.js';
import { formatAmount } from './lib/format.js';

/** Phases shown on the left rail, in order. */
const RAIL = [
  { id: 'quoting', label: 'Quote' },
  { id: 'signing', label: 'Sign' },
  { id: 'verifying', label: 'Verify' },
  { id: 'escalating', label: 'Escalate' },
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

  // Shown from the moment a run starts and kept visible through the outcome,
  // because the ledger is the record of what the agent decided — it matters
  // most once the run has ended.
  const showPanel = store.phase !== 'idle';

  /** How far through the rail we are. */
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
              'radial-gradient(ellipse at 50% 45%, transparent 0%, var(--void) 82%)',
          }}
          aria-hidden="true"
        />

        {/* ---- left rail ---- */}
        <aside className="relative hidden w-44 shrink-0 border-r hairline px-5 py-6 lg:block">
          <p className="mb-5 font-mono text-[9px] uppercase tracking-[0.24em] text-[var(--graphite-dim)]">
            Run phase
          </p>

          <ol className="space-y-3.5">
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

          {store.round > 0 && (
            <div className="mt-6 border-t hairline pt-4">
              <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--graphite-dim)]">
                Round
              </p>
              <p className="tabular mt-1 font-display text-2xl font-extrabold text-chalk">
                {store.round}
              </p>
            </div>
          )}

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
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-6">
          <AnimatePresence mode="wait">
            {store.phase === 'idle' && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="flex w-full flex-col items-center py-8"
                >
                <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.24em] text-graphite">
                  Algorand · x402 · adaptive spend
                </p>

                <h1 className="max-w-2xl text-center font-display text-3xl font-extrabold uppercase leading-[0.92] tracking-tightest text-chalk lg:text-4xl">
                  Payment bound to <span className="text-brass">outcome</span>
                </h1>

                <p className="mt-3 max-w-md text-center text-[13px] leading-relaxed text-graphite">
                  The agent buys the cheapest answer first and pays for certainty
                  only when a cheap answer is not good enough.
                </p>

                <div className="mt-7">
                  {activeAddress ? (
                    <>
                      <SourcingForm
                        onSubmit={(request) => void run.start(request)}
                        disabled={busy}
                      />

                      <div className="mt-4 w-full max-w-md">
                        <ServiceRegistry
                          assetSymbol={symbol}
                          assetDecimals={decimals}
                          disabled={busy}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="font-mono text-[11px] text-[var(--graphite-dim)]">
                      Connect a TestNet wallet to begin
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {store.phase === 'settled' && store.txId && store.explorerUrl && (
              <motion.div key="settled" exit={{ opacity: 0 }}>
                <Settled
                  txId={store.txId}
                  explorerUrl={store.explorerUrl}
                  totalPaidAtomic={store.totalPaidAtomic ?? '0'}
                  assetSymbol={symbol}
                  assetDecimals={decimals}
                  verdicts={store.verdicts}
                  ledger={store.ledger}
                  onReset={run.reset}
                />
              </motion.div>
            )}

            {store.phase === 'aborted' && (
              <motion.div key="aborted" exit={{ opacity: 0 }}>
                <Aborted
                  reason={
                    store.abortReason ??
                    'One or more checks could not be confirmed'
                  }
                  failedChecks={store.failedChecks}
                  verdicts={store.verdicts}
                  ledger={store.ledger}
                  assetSymbol={symbol}
                  assetDecimals={decimals}
                  onReset={run.reset}
                />
              </motion.div>
            )}

            {store.phase === 'error' && (
              <motion.div key="error" exit={{ opacity: 0 }}>
                <Failed
                  message={store.errorMessage ?? 'Something went wrong'}
                  detail={store.errorDetail}
                  onReset={run.reset}
                />
              </motion.div>
            )}

            {busy || store.phase === 'awaiting_signature' ? (
              <motion.div
                key="running"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex w-full max-w-2xl flex-col items-center"
              >
                <PhaseHeading phase={store.phase} round={store.round} />

                <div className="mt-3 w-full">
                  <TheBinding
                    phase={
                      store.phase === 'escalating'
                        ? 'verifying'
                        : store.phase
                    }
                    groupId={null}
                    verdicts={store.verdicts}
                    failedChecks={store.failedChecks}
                  />
                </div>

                <div className="mt-4 flex w-full gap-2.5">
                  {CHECK_IDS.map((checkId, index) => {
                    const verdict = store.verdicts.find(
                      (v) => v.checkId === checkId
                    );

                    return (
                      <CheckCard
                        key={checkId}
                        checkId={checkId}
                        status={checkStatus(
                          store.phase,
                          checkId,
                          store.verdicts
                        )}
                        reason={verdict?.reason ?? null}
                        wouldResolve={verdict?.wouldResolve ?? null}
                        tier={store.tiers[checkId]}
                        certainty={verdict?.certainty ?? null}
                        paymentIndex={SLOT[checkId]}
                        order={index}
                      />
                    );
                  })}
                </div>

                {store.grandTotalAtomic !== '0' && (
                  <div className="mt-4 flex gap-7 font-mono text-[11px]">
                    <Figure
                      label="Checks"
                      value={formatAmount(
                        store.totalFeesAtomic,
                        decimals,
                        3
                      )}
                      symbol={symbol}
                    />
                    <Figure
                      label="Order"
                      value={formatAmount(
                        store.orderTotalAtomic,
                        decimals
                      )}
                      symbol={symbol}
                    />
                    <Figure
                      label="Total"
                      value={formatAmount(
                        store.grandTotalAtomic,
                        decimals
                      )}
                      symbol={symbol}
                      accent
                    />
                  </div>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* ---- right column: the spend ledger ---- */}
        {showPanel && (
          <motion.aside
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="relative hidden w-80 shrink-0 overflow-y-auto border-l hairline px-4 py-6 lg:block"
          >
            <SpendLedger
              ledger={store.ledger}
              assetSymbol={symbol}
              assetDecimals={decimals}
              activeRound={store.round}
            />
          </motion.aside>
        )}
      </main>
    </div>
  );
}

/**
 * The heading shown during a run.
 *
 * @param props - the current phase and round
 * @returns a heading describing what is happening now
 */
function PhaseHeading({
  phase,
  round,
}: {
  phase: string;
  round: number;
}) {
  const text =
    phase === 'quoting'
      ? 'Collecting quotes'
      : phase === 'awaiting_signature'
        ? round > 1
          ? 'Approve the extra spend'
          : 'Group built'
        : phase === 'signing'
          ? 'Waiting for your signature'
          : phase === 'verifying'
            ? 'Verifying all three checks'
            : phase === 'escalating'
              ? 'The agent wants a better answer'
              : 'Settling on Algorand';

  const sub =
    phase === 'quoting'
      ? 'three services, three price tiers each'
      : phase === 'awaiting_signature'
        ? round > 1
          ? 'the group was rebuilt at a higher tier'
          : 'five transactions, one group id'
        : phase === 'signing'
          ? 'approve in your wallet. slot 0 stays unsigned for the facilitator'
          : phase === 'verifying'
            ? 'same signed group, three payment indices, no money moved yet'
            : phase === 'escalating'
              ? 'a cheap answer was too uncertain to trust'
              : 'one submission, five transactions, all or nothing';

  return (
    <div className="text-center">
      <motion.h2
        key={phase}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-display text-xl font-extrabold uppercase tracking-tightest text-chalk lg:text-2xl"
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
      <p
        className={
          'tabular mt-0.5 text-[13px] ' +
          (accent ? 'text-brass' : 'text-chalk')
        }
      >
        {value}{' '}
        <span className="text-[10px] text-graphite">{symbol}</span>
      </p>
    </div>
  );
}