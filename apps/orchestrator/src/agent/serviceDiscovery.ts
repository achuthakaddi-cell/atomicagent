/**
 * Discovering an arbitrary x402 service from its URL alone.
 *
 * THE CLAIM THIS SUPPORTS
 * -----------------------
 * Everything the orchestrator knows about a registered service is read from
 * that service's own 402 challenge at runtime. There is no import, no config
 * entry, and no code written for any particular provider. Paste a URL and the
 * service becomes a real slot in the atomic group, with a real veto over
 * settlement.
 *
 * That is what it means to have built against a protocol rather than against
 * three endpoints.
 *
 * WHAT WE READ AND WHAT WE IGNORE
 * -------------------------------
 * We read the `accepts` array, because x402 defines it. We read `description`
 * if present, because the Bazaar spec uses that field. We ignore everything
 * else, including any hints a service might offer about how it wants to be
 * called — a service that requires a bespoke request body cannot be driven
 * generically, and pretending otherwise would make the claim false.
 *
 * FAILURE IS EXPLICIT
 * -------------------
 * Every rejection carries a reason a person can act on. "Wrong network" is
 * useful; "discovery failed" is not.
 */

import {
    chooseOption,
    serviceIdFromUrl,
    MAX_EXTERNAL_SERVICES,
    RESERVED_SLOTS,
  } from '@atomicagent/shared';
  import type {
    DiscoveredOption,
    DiscoveredService,
    DiscoveryResult,
  } from '@atomicagent/shared';
  import { env } from '../config/env.js';
  import { logger } from '../config/logger.js';
  
  /** Hard ceiling on the discovery probe. A slow service is a failed service. */
  const PROBE_TIMEOUT_MS = 8_000;
  
  /**
   * Reads one value from an unknown object without throwing.
   *
   * The 402 body comes from a server we do not control and have never seen. Every
   * field is treated as absent until proven otherwise.
   *
   * @param source - the unknown object
   * @param key - the field to read
   * @returns the value, or undefined
   */
  function field(source: unknown, key: string): unknown {
    if (typeof source !== 'object' || source === null) return undefined;
    return (source as Record<string, unknown>)[key];
  }
  
  /**
   * Reads a string field, or returns null.
   *
   * @param source - the unknown object
   * @param key - the field to read
   * @returns the string, or null
   */
  function stringField(source: unknown, key: string): string | null {
    const value = field(source, key);
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  
  /**
   * Parses one entry of the `accepts` array.
   *
   * @param raw - one accepts entry
   * @returns the option, or null if it is not usable
   */
  function parseOption(raw: unknown): DiscoveredOption | null {
    const scheme = stringField(raw, 'scheme');
    const network = stringField(raw, 'network');
    const asset = stringField(raw, 'asset');
    const amount = stringField(raw, 'amount');
    const payTo = stringField(raw, 'payTo');
  
    if (!scheme || !network || !asset || !amount || !payTo) return null;
  
    // The amount has to be a non-negative integer in atomic units. A service
    // quoting "$0.01" is using a different convention and cannot be placed in an
    // asset transfer without guessing at decimals.
    if (!/^\d+$/.test(amount)) return null;
  
    const timeout = field(raw, 'maxTimeoutSeconds');
    const extra = field(raw, 'extra');
  
    return {
      scheme,
      network,
      asset,
      amount,
      payTo,
      maxTimeoutSeconds: typeof timeout === 'number' ? timeout : 120,
      extra:
        typeof extra === 'object' && extra !== null
          ? (extra as Record<string, unknown>)
          : undefined,
    };
  }
  
  /**
   * Probes a URL and reads its 402 challenge.
   *
   * @param url - the service endpoint
   * @param slotIndex - which slot this service would occupy
   * @returns the discovery result, success or failure with a reason
   */
  export async function discoverService(
    url: string,
    slotIndex: number,
  ): Promise<DiscoveryResult> {
    // ---- 0. Is there room? ----
    const externalCount = slotIndex - RESERVED_SLOTS + 1;
  
    if (externalCount > MAX_EXTERNAL_SERVICES) {
      return {
        ok: false,
        service: null,
        failure: 'group_full',
        message:
          'An Algorand atomic group holds at most 16 transactions. Five are ' +
          'reserved for the fee payer, the three built-in checks and the order ' +
          'payment, leaving room for ' + String(MAX_EXTERNAL_SERVICES) +
          ' external services.',
      };
    }
  
    // ---- 1. Is it a URL at all? ----
    let parsed: URL;
  
    try {
      parsed = new URL(url);
    } catch {
      return {
        ok: false,
        service: null,
        failure: 'malformed',
        message: 'That is not a valid URL.',
      };
    }
  
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      return {
        ok: false,
        service: null,
        failure: 'malformed',
        message:
          'Only HTTPS endpoints can be registered. A payment request sent over ' +
          'plain HTTP can be read and altered in transit.',
      };
    }
  
    // ---- 2. Probe it with no payment attached ----
    //
    // A 402 is the expected, correct response. Any other status means this is
    // not an x402 resource.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  
    let status: number;
    let body: unknown;
  
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // An empty object. A service needing specific fields will say so in its
        // 402, and we are only reading payment terms at this stage.
        body: '{}',
        signal: controller.signal,
      });
  
      status = response.status;
  
      const text = await response.text();
  
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        return {
          ok: false,
          service: null,
          failure: 'not_x402',
          message:
            'The endpoint responded with HTTP ' + String(status) +
            ' but the body was not JSON.',
        };
      }
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
  
      return {
        ok: false,
        service: null,
        failure: 'unreachable',
        message: aborted
          ? 'The endpoint did not respond within ' +
            String(PROBE_TIMEOUT_MS / 1000) + ' seconds.'
          : 'Could not reach the endpoint. ' +
            (cause instanceof Error ? cause.message : 'unknown error'),
      };
    } finally {
      clearTimeout(timer);
    }
  
    // ---- 3. It must be a 402 ----
    if (status !== 402) {
      return {
        ok: false,
        service: null,
        failure: 'not_x402',
        message:
          'Expected HTTP 402 Payment Required, received ' + String(status) +
          '. This endpoint is not payment-gated, or it is gated by something ' +
          'other than x402.',
      };
    }
  
    // ---- 4. Read the accepts array ----
    const accepts = field(body, 'accepts');
  
    if (!Array.isArray(accepts) || accepts.length === 0) {
      return {
        ok: false,
        service: null,
        failure: 'no_accepts',
        message:
          'The 402 response carried no `accepts` array, so there is nothing ' +
          'saying what this service charges or who it pays.',
      };
    }
  
    const options: DiscoveredOption[] = [];
  
    for (const entry of accepts) {
      const option = parseOption(entry);
      if (option) options.push(option);
    }
  
    if (options.length === 0) {
      return {
        ok: false,
        service: null,
        failure: 'malformed',
        message:
          'The `accepts` array had ' + String(accepts.length) +
          ' entries but none carried a usable scheme, network, asset, amount ' +
          'and payTo.',
      };
    }
  
    // ---- 5. Can it join OUR group? ----
    //
    // One group, one network, one asset. This is a property of the chain, not a
    // limitation we invented.
    const chosen = chooseOption(options, env.network, env.asset.id);
  
    if (!chosen) {
      const networks = [...new Set(options.map((o) => o.network))];
      const assets = [...new Set(options.map((o) => o.asset))];
  
      const networkMismatch = !networks.includes(env.network);
  
      return {
        ok: false,
        service: null,
        failure: networkMismatch ? 'wrong_network' : 'wrong_asset',
        message: networkMismatch
          ? 'This service accepts payment on ' + networks.join(', ') +
            '. Every transaction in one atomic group must be on the same ' +
            'network, and ours is ' + env.network + '.'
          : 'This service accepts asset ' + assets.join(', ') +
            '. Every transaction in one group must move the same asset, and ' +
            'ours is ' + env.asset.symbol + ' (' + env.asset.id + ').',
      };
    }
  
    // ---- 6. Registered ----
    const service: DiscoveredService = {
      id: serviceIdFromUrl(url),
      url,
      description: stringField(body, 'description'),
      options,
      chosen,
      paymentIndex: slotIndex,
      discoveredAt: Date.now(),
    };
  
    logger.info(
      {
        url,
        slotIndex,
        amount: chosen.amount,
        payTo: chosen.payTo,
        optionCount: options.length,
      },
      'registered an external x402 service from its 402 challenge alone',
    );
  
    return {
      ok: true,
      service,
      failure: null,
      message:
        'Registered. This service charges ' + chosen.amount +
        ' atomic units to ' + chosen.payTo.slice(0, 8) + '… and will occupy ' +
        'slot ' + String(slotIndex) + ' of the atomic group.',
    };
  }