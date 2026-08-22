/**
 * The sourcing request form.
 *
 * Preset scenarios sit alongside the free-form fields, so a judge can trigger
 * a pass or either failure path in one click rather than typing SKUs. Making
 * the failure case easy to demonstrate is deliberate: it is the more
 * interesting half of the pitch.
 *
 * The opt-in gate sits above the presets. A wallet that cannot receive the
 * payment asset cannot settle, so the run button stays locked until it can.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import type { SourcingRequest } from '../../lib/api.js';
import { OptInGate } from '../../components/OptInGate';
import { useAssetOptIn } from '../../hooks/useAssetOptIn';

interface Preset {
  label: string;
  outcome: 'settles' | 'aborts';
  hint: string;
  request: SourcingRequest;
}

/** Scenarios chosen so every path is one click away. */
const PRESETS: Preset[] = [
  {
    label: 'Steel sheet',
    outcome: 'settles',
    hint: 'all three checks pass',
    request: {
      sku: 'SKU-4471',
      quantity: 500,
      maxUnitPriceAtomic: '8333',
      requiredBy: '2026-09-15',
      supplierId: 'SUP-BLR-011',
    },
  },
  {
    label: 'Galvanised coil',
    outcome: 'aborts',
    hint: 'only 400 units in stock',
    request: {
      sku: 'SKU-4472',
      quantity: 500,
      maxUnitPriceAtomic: '8333',
      requiredBy: '2026-09-15',
      supplierId: 'SUP-BLR-011',
    },
  },
  {
    label: 'Bearing assembly',
    outcome: 'aborts',
    hint: 'quoted 82.00 against a 5.00 ceiling',
    request: {
      sku: 'SKU-9002',
      quantity: 10,
      maxUnitPriceAtomic: '8333',
      requiredBy: '2026-09-15',
      supplierId: 'SUP-PUN-004',
    },
  },
];

interface SourcingFormProps {
  onSubmit: (request: SourcingRequest) => void;
  disabled: boolean;
}

export function SourcingForm({ onSubmit, disabled }: SourcingFormProps) {
  const [selected, setSelected] = useState(0);
  const { ready } = useAssetOptIn();

  const preset = PRESETS[selected] ?? PRESETS[0];

  if (!preset) return null;

  // A run that cannot settle is worse than a run that never starts.
  const runBlocked = disabled || !ready;

  return (
    <div className="w-full max-w-md">
      <OptInGate />

      <p className="mb-3 mt-4 font-mono text-[10px] uppercase tracking-[0.24em] text-graphite">
        Select a sourcing request
      </p>

      <div className="space-y-2">
        {PRESETS.map((entry, index) => {
          const active = index === selected;

          return (
            <motion.button
              key={entry.request.sku}
              type="button"
              disabled={disabled}
              onClick={() => setSelected(index)}
              whileHover={disabled ? undefined : { x: 3 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className={
                'group flex w-full items-center gap-3 rounded border px-4 py-3 text-left transition-colors duration-200 ' +
                (active
                  ? 'border-[var(--verify-dim)] bg-blueprint'
                  : 'hairline bg-blueprint/40 hover:border-[var(--graphite-dim)]') +
                (disabled ? ' cursor-not-allowed opacity-50' : '')
              }
            >
              <span
                className={
                  'h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200 ' +
                  (active ? 'bg-verify' : 'bg-[var(--hairline)]')
                }
              />

              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-chalk">
                  {entry.label}
                </span>
                <span className="block font-mono text-[10px] text-[var(--graphite-dim)]">
                  {entry.request.sku} - {entry.request.quantity} units - {entry.hint}
                </span>
              </span>

              <span
                className={
                  'shrink-0 font-mono text-[9px] uppercase tracking-wider ' +
                  (entry.outcome === 'settles' ? 'text-verify' : 'text-halt')
                }
              >
                {entry.outcome}
              </span>
            </motion.button>
          );
        })}
      </div>

      <motion.button
        type="button"
        disabled={runBlocked}
        onClick={() => onSubmit(preset.request)}
        whileHover={runBlocked ? undefined : { scale: 1.01 }}
        whileTap={runBlocked ? undefined : { scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className={
          'mt-4 w-full rounded border border-[var(--brass-dim)] bg-brass/10 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-brass transition-colors duration-200 ' +
          (runBlocked
            ? 'cursor-not-allowed opacity-40'
            : 'hover:border-brass hover:bg-brass/20')
        }
      >
        Run sourcing agent
      </motion.button>
    </div>
  );
}