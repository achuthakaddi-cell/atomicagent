/**
 * Live GST registry lookup.
 *
 * WHAT THIS REPLACES
 * ------------------
 * The seller check previously read from a hardcoded fixture. The tier ladder
 * was real in shape but not in substance: "cached snapshot" versus "live
 * lookup" was simulated by which fields the code chose to reveal.
 *
 * This makes the distinction real. The shallow tier runs a genuine structural
 * check offline — check digit, state code, embedded PAN — and the deeper tiers
 * query an actual registry over the network.
 *
 * WHY THE FALLBACK EXISTS AND IS DECLARED
 * ---------------------------------------
 * A live API can be down, rate-limited, or unconfigured. A demo that breaks
 * because a third party is having a bad afternoon is a worse demo than one that
 * degrades honestly, so an unreachable registry falls back to structural
 * validation and SAYS SO in the response.
 *
 * The alternative — silently returning a cached answer as though it were live —
 * would be dishonest in exactly the way this project exists to argue against.
 * If the buyer paid for a live lookup and did not get one, they are told.
 */

import { validateGstinStructure } from './gstin.js';
import type { GstinStructure } from './gstin.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/** How a registry answer was obtained. */
export type LookupSource = 'structural' | 'live' | 'live-failed';

/** What a registry lookup establishes. */
export interface RegistryRecord {
  gstin: string;
  /** How this answer was reached. Never hidden from the caller. */
  source: LookupSource;
  /** Structural findings, always present — they cost nothing. */
  structure: GstinStructure;
  /** Registration status, when a live lookup succeeded. */
  status: string | null;
  /** Legal name on the registration. */
  legalName: string | null;
  /** Trading name, where it differs. */
  tradeName: string | null;
  /** Date of registration. */
  registeredOn: string | null;
  /** Taxpayer type — Regular, Composition, and so on. */
  taxpayerType: string | null;
  /** Constitution of business — Company, Proprietorship, LLP. */
  constitution: string | null;
  /** State jurisdiction. */
  jurisdiction: string | null;
  /** Why a live lookup failed, when it did. */
  lookupError: string | null;
}

/** Hard ceiling on the registry call. A slow registry is a failed registry. */
const LOOKUP_TIMEOUT_MS = 6_000;

/**
 * Reads a string from an unknown object without throwing.
 *
 * The registry response comes from a third party whose schema we do not
 * control. Every field is treated as absent until proven present.
 *
 * @param source - the unknown object
 * @param key - the field to read
 * @returns the string, or null
 */
function readString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Reads a nested object without throwing.
 *
 * @param source - the unknown object
 * @param key - the field to read
 * @returns the object, or null
 */
function readObject(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return null;
  return (source as Record<string, unknown>)[key] ?? null;
}

/**
 * Structural validation only. No network.
 *
 * What the shallow tier buys. It is genuine verification — the check digit
 * catches almost every typo and most invented numbers — but it establishes only
 * that a number COULD exist, not that it does or that it is still in force.
 *
 * @param gstin - the number to check
 * @returns a record sourced from structure alone
 */
export function lookupStructural(gstin: string): RegistryRecord {
  const structure = validateGstinStructure(gstin);

  return {
    gstin: structure.gstin,
    source: 'structural',
    structure,
    status: null,
    legalName: null,
    tradeName: null,
    registeredOn: null,
    taxpayerType: null,
    constitution: null,
    jurisdiction: null,
    lookupError: null,
  };
}

/**
 * Live registry lookup.
 *
 * Structural validation runs first and short-circuits on failure: a number that
 * cannot be genuine is not worth a network call, and spending the buyer's
 * latency on one would be careless.
 *
 * @param gstin - the number to look up
 * @returns a record sourced live, or a declared fallback
 */
export async function lookupLive(gstin: string): Promise<RegistryRecord> {
  const structural = lookupStructural(gstin);

  // A malformed number cannot be registered. No point asking.
  if (!structural.structure.valid) {
    return structural;
  }

  if (!env.gstApiKey || !env.gstApiUrl) {
    logger.warn(
      'no GST registry credentials configured, falling back to structural validation',
    );

    return {
      ...structural,
      source: 'live-failed',
      lookupError:
        'No registry credentials are configured, so this answer rests on ' +
        'structural validation alone.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  try {
    const url =
      env.gstApiUrl +
      '?gstNo=' +
      encodeURIComponent(structural.structure.gstin) +
      '&key_secret=' +
      encodeURIComponent(env.gstApiKey);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('registry returned HTTP ' + String(response.status));
    }

    const body = (await response.json()) as unknown;

    // The registry nests taxpayer fields. Shape is read defensively because a
    // third party can change it without telling us.
    const taxpayer = readObject(body, 'taxpayerInfo') ?? body;

    const status = readString(taxpayer, 'sts');

    if (!status) {
      throw new Error('registry response carried no status field');
    }

    logger.info(
      { gstin: structural.structure.gstin, status },
      'live registry lookup succeeded',
    );

    return {
      ...structural,
      source: 'live',
      status,
      legalName: readString(taxpayer, 'lgnm'),
      tradeName: readString(taxpayer, 'tradeNam'),
      registeredOn: readString(taxpayer, 'rgdt'),
      taxpayerType: readString(taxpayer, 'dty'),
      constitution: readString(taxpayer, 'ctb'),
      jurisdiction: readString(taxpayer, 'stj'),
      lookupError: null,
    };
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';

    const message = aborted
      ? 'the registry did not respond within ' +
        String(LOOKUP_TIMEOUT_MS / 1000) + ' seconds'
      : cause instanceof Error
        ? cause.message
        : 'unknown error';

    logger.warn(
      { gstin: structural.structure.gstin, error: message },
      'live registry lookup failed, falling back to structural validation',
    );

    return {
      ...structural,
      source: 'live-failed',
      lookupError:
        'The registry could not be reached — ' + message + '. This answer ' +
        'rests on structural validation alone.',
    };
  } finally {
    clearTimeout(timer);
  }
}