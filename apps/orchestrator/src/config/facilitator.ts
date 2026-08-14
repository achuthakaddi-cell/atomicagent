/**
 * Facilitator capability discovery.
 *
 * Slot 0 of every AtomicAgent group is an UNSIGNED transaction that only the
 * facilitator can sign. It accepts unsigned transactions solely from its own
 * addresses, so we must know that address before building a group.
 *
 * VERIFIED against the live facilitator (probe-facilitator.mjs):
 *
 *   GET https://facilitator.goplausible.xyz/supported
 *   -> kinds[] contains
 *      { scheme: "exact",
 *        network: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
 *        extra: { feePayer: "ZMFK2OI7..." } }
 *   -> signers["algorand:*"] lists the same address
 *
 * Notably, the EVM entries carry NO feePayer. Fee abstraction on this
 * facilitator is available for Algorand and Solana only.
 *
 * The address is fetched at startup and cached. It is not hardcoded, because
 * the facilitator may rotate it — but a fallback constant keeps the demo alive
 * if /supported is briefly unreachable at the venue.
 */

import { AppError, ERROR_CODE } from '@atomicagent/shared';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Fallback fee payer, observed on 2026-08-13.
 *
 * Used only if /supported cannot be reached at startup. If the facilitator has
 * rotated its key, settlement fails with a clear error rather than silently
 * building an invalid group.
 */
const FALLBACK_FEE_PAYER =
  'ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA';

/** One supported scheme/network pair from the facilitator. */
interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: { feePayer?: string };
}

/** Shape of the /supported response. */
interface SupportedResponse {
  kinds?: SupportedKind[];
  extensions?: unknown[];
  signers?: Record<string, string[]>;
}

/** Cached capabilities, populated by loadFacilitatorCapabilities(). */
let cached: { feePayer: string; fetchedAt: number } | null = null;

/**
 * Fetches the facilitator's capabilities and caches the fee payer address.
 *
 * Called once at startup. Failure is non-fatal — we fall back to the known
 * address and log a warning, so a flaky venue network cannot stop the service
 * from booting.
 *
 * @returns the fee payer address for our network
 */
export async function loadFacilitatorCapabilities(): Promise<string> {
  const url = env.facilitatorUrl + '/supported';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const body = (await response.json()) as SupportedResponse;

    const match = body.kinds?.find(
      (kind) => kind.network === env.network && kind.scheme === 'exact',
    );

    if (!match) {
      throw new Error(`facilitator does not support exact on ${env.network}`);
    }

    const feePayer = match.extra?.feePayer;

    if (!feePayer) {
      throw new Error('no feePayer advertised for this network');
    }

    cached = { feePayer, fetchedAt: Date.now() };

    logger.info(
      { feePayer, network: env.network },
      'facilitator capabilities loaded, fee abstraction available',
    );

    return feePayer;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown error';

    logger.warn(
      { detail, fallback: FALLBACK_FEE_PAYER },
      'could not load facilitator capabilities, using fallback fee payer',
    );

    cached = { feePayer: FALLBACK_FEE_PAYER, fetchedAt: Date.now() };
    return FALLBACK_FEE_PAYER;
  }
}

/**
 * Returns the cached fee payer address.
 *
 * Throws rather than fetching lazily: a group built with the wrong fee payer
 * fails at settlement, after the user has already signed. Better to fail at
 * startup than mid-demo.
 *
 * @returns the fee payer address
 * @throws AppError if capabilities were never loaded
 */
export function getFeePayer(): string {
  if (!cached) {
    throw new AppError(
      ERROR_CODE.INTERNAL,
      'Facilitator capabilities were not loaded at startup',
    );
  }
  return cached.feePayer;
}

/**
 * Whether capabilities have been loaded. Used by the health endpoint.
 *
 * @returns cached fee payer and age, or null
 */
export function facilitatorStatus(): {
  feePayer: string;
  ageMs: number;
} | null {
  if (!cached) return null;
  return {
    feePayer: cached.feePayer,
    ageMs: Date.now() - cached.fetchedAt,
  };
}