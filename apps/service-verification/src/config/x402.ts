/**
 * x402 wiring for this service.
 *
 * TIERED PRICING
 * --------------
 * The 402 response advertises three payment options rather than one. That is
 * native to x402: the `accepts` array is a list, and a client picks whichever
 * entry it is willing to pay for.
 *
 * Most x402 deployments put a single entry there. Using the array as intended
 * is what lets the agent make an economic choice rather than paying a fixed toll.
 *
 * TWO SDK SUBTLETIES, both found by probing the installed package rather than
 * trusting the documentation:
 *
 * 1. `registerExactAvmScheme` IS exported at runtime from
 *    @x402-avm/avm/exact/server, but has no entry in the shipped .d.ts files,
 *    so calling it from TypeScript fails to compile. We use the fully-typed
 *    equivalent: server.register(network, new ExactAvmScheme()).
 *
 * 2. TWO different classes are both named `ExactAvmScheme`:
 *      @x402-avm/avm/exact/server       prices and builds requirements, no keys
 *      @x402-avm/avm/exact/facilitator  signs and submits, requires a signer
 *    A resource server must use the SERVER one, so we always import from the
 *    explicit subpath rather than the ambiguous package root.
 */

import { HTTPFacilitatorClient, x402ResourceServer } from '@x402-avm/core/server';
import { ExactAvmScheme } from '@x402-avm/avm/exact/server';
import { TIER_SPECS, TIERS } from '@atomicagent/shared';
import type { Caip2Network, PaymentRequirements, Tier } from '@atomicagent/shared';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Client for the public GoPlausible facilitator.
 * FacilitatorConfig is `{ url?: string; createAuthHeaders?: ... }` — verified.
 */
export const facilitatorClient = new HTTPFacilitatorClient({
  url: env.facilitatorUrl,
});

/**
 * The resource server, with the AVM exact scheme registered for our network.
 * `register` returns the server for chaining — verified in the declarations.
 */
export const resourceServer = new x402ResourceServer(facilitatorClient).register(
  env.network as Caip2Network,
  new ExactAvmScheme(),
);

logger.info(
  { facilitator: env.facilitatorUrl, network: env.network },
  'x402 resource server ready',
);

/**
 * Builds the payment requirements for one tier.
 *
 * @param tier - which price point
 * @returns the requirements for that tier
 */
export function buildTierRequirements(tier: Tier): PaymentRequirements {
  const spec = TIER_SPECS[tier];

  return {
    scheme: 'exact',
    network: env.network as Caip2Network,
    asset: env.asset.id,
    amount: spec.feeAtomic,
    payTo: env.payTo,
    maxTimeoutSeconds: 120,
    extra: {
      decimals: env.asset.decimals,
      name: env.asset.symbol,
      // Required by the Global x402 Challenge for leaderboard attribution.
      // The facilitator reads this to identify challenge participants.
      tag: 'x402-global-challenge',
      // Non-standard, and deliberately so. The agent reads these to decide
      // which tier is worth paying for.
      tier: spec.tier,
      method: spec.method,
      confidence: spec.confidence,
      latencyMs: spec.latencyMs,
    },
  };
}

/**
 * Every tier this service offers, cheapest first.
 *
 * @returns the full accepts array for a 402 response
 */
export function buildAllTierRequirements(): PaymentRequirements[] {
  return TIERS.map((tier) => buildTierRequirements(tier));
}

/**
 * Identifies which tier a payment is for, by its amount.
 *
 * A client declares the tier in the requirements it claims to satisfy, but we
 * verify against the amount rather than trusting the label. Paying the shallow
 * fee and asking for a deep answer is exactly the abuse this prevents.
 *
 * @param amountAtomic - the amount actually offered
 * @returns the tier that amount buys, or null if it matches none
 */
export function tierForAmount(amountAtomic: string): Tier | null {
  for (const tier of TIERS) {
    if (TIER_SPECS[tier].feeAtomic === amountAtomic) return tier;
  }
  return null;
}

/**
 * Default requirements, used where a single entry is needed.
 *
 * @returns the shallow tier's requirements
 */
export function buildPaymentRequirements(): PaymentRequirements {
  return buildTierRequirements('shallow');
}