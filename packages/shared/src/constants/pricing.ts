/**
 * The atomic group layout — the single most important file in the project.
 *
 * Every AtomicAgent run builds ONE Algorand atomic transaction group with a
 * fixed five-slot shape. The orchestrator builds it, three services each verify
 * one slot, and the facilitator settles the whole thing once.
 *
 *   index 0  pay    feePayer -> feePayer      facilitator signs, covers all fees
 *   index 1  axfer  buyer    -> price svc     check fee
 *   index 2  axfer  buyer    -> availability  check fee
 *   index 3  axfer  buyer    -> verification  check fee
 *   index 4  axfer  buyer    -> supplier      THE ORDER PAYMENT
 *
 * Slot 4 is what makes the pitch true. Because it shares a group id with slots
 * 1-3, the order money cannot move unless the whole group commits. Not "we
 * choose not to send it" — the protocol will not let it happen.
 */

import { MAX_ATOMIC_GROUP_SIZE } from './network.js';

/** The three checks, in fixed order. Order defines the payment indices below. */
export const CHECK_IDS = ['price', 'availability', 'verification'] as const;

/** Fixed position of every transaction in the group. */
export const GROUP_SLOT = {
  FEE_PAYER: 0,
  PRICE: 1,
  AVAILABILITY: 2,
  VERIFICATION: 3,
  ORDER: 4,
} as const;

/** Total transactions in an AtomicAgent group. 5 of a possible 16. */
export const ATOMIC_GROUP_SIZE = 5;

/**
 * Load-time invariant check.
 *
 * If someone grows the group past Algorand's protocol limit, every service
 * that imports this module fails to start with a clear message — instead of
 * the facilitator rejecting the group at settlement time with an opaque error.
 *
 * A runtime assertion is used rather than a type-level one because TypeScript
 * cannot evaluate numeric comparisons in the type system; `5 <= 16` has type
 * `boolean`, not `true`.
 */
if (ATOMIC_GROUP_SIZE > MAX_ATOMIC_GROUP_SIZE) {
  throw new Error(
    `AtomicAgent group layout is invalid: ATOMIC_GROUP_SIZE (${ATOMIC_GROUP_SIZE}) ` +
      `exceeds Algorand's MAX_ATOMIC_GROUP_SIZE (${MAX_ATOMIC_GROUP_SIZE}).`,
  );
}

/**
 * Which slot each service verifies.
 *
 * All three services receive an IDENTICAL paymentGroup array and differ only
 * in paymentIndex. This is the mechanism the whole project rests on, and the
 * x402 AVM spec supports it directly: ExactAvmPayloadV2 carries
 * { paymentGroup: string[]; paymentIndex: number }.
 */
export const PAYMENT_INDEX_BY_CHECK = {
  price: GROUP_SLOT.PRICE,
  availability: GROUP_SLOT.AVAILABILITY,
  verification: GROUP_SLOT.VERIFICATION,
} as const;

/** Human labels for the UI. Kept here so backend and frontend never disagree. */
export const CHECK_LABELS = {
  price: 'Price check',
  availability: 'Stock availability',
  verification: 'Seller verification',
} as const;

/** One-line description of what each check actually does. */
export const CHECK_DESCRIPTIONS = {
  price: 'Confirms the quoted unit price is within your stated ceiling.',
  availability: 'Confirms the supplier holds enough stock to fill the order.',
  verification: 'Confirms the seller is registered and in good standing.',
} as const;

/** Default per-check fee in atomic units. 10000 = 0.01 USDC at 6 decimals. */
export const DEFAULT_CHECK_FEE_ATOMIC = '10000';

/**
 * Timeout budget for every network call, in milliseconds.
 *
 * Judging criteria call out "zero hangs", so every call has a hard ceiling.
 * A timeout is always treated as a FAILURE, never as "wait a bit longer" —
 * we never settle on ambiguity.
 */
export const TIMEOUTS_MS = {
  /** Collecting the 402 challenge from one service. */
  QUOTE: 6_000,
  /** Verifying one service's slot in the group. */
  VERIFY: 8_000,
  /** Settling the group through the facilitator. */
  SETTLE: 20_000,
  /** Waiting for algod to confirm a submitted group. */
  ALGOD_CONFIRM: 15_000,
} as const;

/** Retry policy. Only quote collection retries — verify and settle never do. */
export const RETRY = {
  QUOTE_ATTEMPTS: 2,
  QUOTE_BACKOFF_MS: 750,
} as const;

/**
 * Formats an atomic amount as a human-readable decimal string.
 *
 * Uses BigInt throughout. Floating point is never allowed near money — 0.1 + 0.2
 * is not 0.3 in IEEE 754, and a wrong figure on screen destroys trust instantly.
 *
 * @param atomic - amount in the asset's smallest unit, as a digit string
 * @param decimals - decimal places for the asset (6 for USDC)
 * @returns decimal string, e.g. "0.010000"
 */
export function formatAtomicAmount(atomic: string, decimals: number): string {
  if (!/^\d+$/.test(atomic)) {
    throw new Error(`formatAtomicAmount: expected digits, received "${atomic}"`);
  }
  if (decimals === 0) return atomic;

  const padded = atomic.padStart(decimals + 1, '0');
  const cut = padded.length - decimals;
  const whole = padded.slice(0, cut);
  const fraction = padded.slice(cut);
  return `${whole}.${fraction}`;
}

/**
 * Sums atomic amounts without precision loss.
 *
 * @param amounts - digit strings in the same asset's smallest unit
 * @returns the total as a digit string
 */
export function sumAtomicAmounts(amounts: readonly string[]): string {
  let total = 0n;
  for (const amount of amounts) {
    if (!/^\d+$/.test(amount)) {
      throw new Error(`sumAtomicAmounts: expected digits, received "${amount}"`);
    }
    total += BigInt(amount);
  }
  return total.toString();
}

/**
 * Multiplies a unit price by a quantity, exactly.
 *
 * @param unitPriceAtomic - unit price in atomic units
 * @param quantity - whole number of units
 * @returns total in atomic units
 */
export function multiplyAtomicAmount(
  unitPriceAtomic: string,
  quantity: number,
): string {
  if (!/^\d+$/.test(unitPriceAtomic)) {
    throw new Error(
      `multiplyAtomicAmount: expected digits, received "${unitPriceAtomic}"`,
    );
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`multiplyAtomicAmount: quantity must be a non-negative integer`);
  }
  return (BigInt(unitPriceAtomic) * BigInt(quantity)).toString();
}