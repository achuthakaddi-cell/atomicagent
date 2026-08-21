/**
 * Service discovery and group capacity.
 *
 * WHAT THESE RULES PROTECT
 * ------------------------
 * A service registered from a URL is untrusted input. It might advertise a
 * different network, a different asset, or a price in a format we cannot place
 * in a transaction. Each of those has to be caught before a slot is built for
 * it, not after the user has signed.
 *
 * The capacity rules protect something else: Algorand rejects a group of more
 * than sixteen transactions outright. Catching that at registration gives the
 * user a clear message; catching it at settlement gives them a failed signature.
 */

import { describe, expect, it } from 'vitest';
import {
  chooseOption,
  serviceIdFromUrl,
  FIRST_EXTERNAL_SLOT,
  MAX_EXTERNAL_SERVICES,
  MAX_GROUP_SIZE,
} from './pluggable.js';
import type { DiscoveredOption } from './pluggable.js';

const OUR_NETWORK = 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=';
const OUR_ASSET = '769239123';

/**
 * Builds a discovered option for testing.
 *
 * @param overrides - fields to change from the default
 * @returns a complete DiscoveredOption
 */
function option(overrides: Partial<DiscoveredOption> = {}): DiscoveredOption {
  return {
    scheme: 'exact',
    network: OUR_NETWORK,
    asset: OUR_ASSET,
    amount: '10000',
    payTo: 'PI3C6YVL3ABA4ZIUAGCNWIF6R76V7HGEQPCVKZPF6OCL7FROQAYX5HMTP4',
    maxTimeoutSeconds: 120,
    extra: undefined,
    ...overrides,
  };
}

describe('chooseOption — compatibility', () => {
  it('accepts an option matching our network and asset', () => {
    const chosen = chooseOption([option()], OUR_NETWORK, OUR_ASSET);
    expect(chosen).not.toBeNull();
  });

  it('rejects an option on a different network', () => {
    // One group, one network. This is a property of the chain, not a rule we
    // invented, and a service on Base genuinely cannot join an Algorand group.
    const chosen = chooseOption(
      [option({ network: 'eip155:8453' })],
      OUR_NETWORK,
      OUR_ASSET,
    );

    expect(chosen).toBeNull();
  });

  it('rejects an option in a different asset', () => {
    const chosen = chooseOption(
      [option({ asset: '31566704' })],
      OUR_NETWORK,
      OUR_ASSET,
    );

    expect(chosen).toBeNull();
  });

  it('rejects a scheme other than exact', () => {
    const chosen = chooseOption(
      [option({ scheme: 'upto' })],
      OUR_NETWORK,
      OUR_ASSET,
    );

    expect(chosen).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(chooseOption([], OUR_NETWORK, OUR_ASSET)).toBeNull();
  });
});

describe('chooseOption — picks the cheapest', () => {
  it('chooses the lowest amount, not the first listed', () => {
    // A service listing its expensive option first should not cost more for
    // that reason. The agent buys the least it can, as it does with its own
    // tiered checks.
    const chosen = chooseOption(
      [
        option({ amount: '200000' }),
        option({ amount: '10000' }),
        option({ amount: '50000' }),
      ],
      OUR_NETWORK,
      OUR_ASSET,
    );

    expect(chosen?.amount).toBe('10000');
  });

  it('ignores cheaper options that are incompatible', () => {
    const chosen = chooseOption(
      [
        option({ amount: '1', network: 'eip155:8453' }),
        option({ amount: '50000' }),
      ],
      OUR_NETWORK,
      OUR_ASSET,
    );

    expect(chosen?.amount).toBe('50000');
  });

  it('compares amounts numerically, not as strings', () => {
    // '9000' sorts after '10000' as a string but is smaller as a number.
    // Comparing amounts as strings is a real and easy mistake here.
    const chosen = chooseOption(
      [option({ amount: '10000' }), option({ amount: '9000' })],
      OUR_NETWORK,
      OUR_ASSET,
    );

    expect(chosen?.amount).toBe('9000');
  });
});

describe('serviceIdFromUrl', () => {
  it('is deterministic for the same URL', () => {
    const url = 'https://carbon.example.com/estimate';
    expect(serviceIdFromUrl(url)).toBe(serviceIdFromUrl(url));
  });

  it('produces different ids for different URLs', () => {
    expect(serviceIdFromUrl('https://a.example.com/x')).not.toBe(
      serviceIdFromUrl('https://b.example.com/x'),
    );
  });

  it('distinguishes different paths on the same host', () => {
    expect(serviceIdFromUrl('https://x.com/carbon')).not.toBe(
      serviceIdFromUrl('https://x.com/water'),
    );
  });

  it('contains no characters that would break a React key or a URL', () => {
    const id = serviceIdFromUrl('https://sub.domain.example.com/path/to/thing');
    expect(id).toMatch(/^[a-z0-9-]+$/i);
  });

  it('does not throw on a malformed URL', () => {
    expect(() => serviceIdFromUrl('not a url at all')).not.toThrow();
  });
});

describe('group capacity', () => {
  it('reserves four slots before external services begin', () => {
    // Fee payer, then the three built-in checks. The order payment is NOT
    // counted here — it moves to the end so registering a service never
    // renumbers it. Counting it was a real off-by-one bug: the first external
    // service landed on the order's slot and was paid the order amount.
    expect(FIRST_EXTERNAL_SLOT).toBe(4);
  });

  it('leaves room for the order payment at the end', () => {
    expect(MAX_EXTERNAL_SERVICES).toBe(MAX_GROUP_SIZE - FIRST_EXTERNAL_SLOT - 1);
  });

  it('never allows a group larger than Algorand permits', () => {
    const largest = FIRST_EXTERNAL_SLOT + MAX_EXTERNAL_SERVICES + 1;
    expect(largest).toBeLessThanOrEqual(MAX_GROUP_SIZE);
  });

  it('allows at least one external service', () => {
    expect(MAX_EXTERNAL_SERVICES).toBeGreaterThan(0);
  });
});