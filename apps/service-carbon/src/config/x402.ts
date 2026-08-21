/**
 * x402 wiring for the carbon service.
 *
 * WRITTEN AS A THIRD PARTY WOULD WRITE IT
 * ---------------------------------------
 * One price, one payee, no tiers. No knowledge of AtomicAgent, its group
 * layout, or which slot it might be paid from.
 *
 * This is what a service published to the Bazaar by someone else looks like,
 * and it is deliberately the least sophisticated of the four — because the
 * claim being tested is that the orchestrator can pay ANY x402 service, not
 * only ones designed alongside it.
 *
 * The same two SDK subtleties apply as everywhere else, both found by probing
 * the installed package rather than trusting the documentation:
 *
 * 1. `registerExactAvmScheme` exists at runtime but has no .d.ts entry, so
 *    calling it from TypeScript fails to compile. Use server.register().
 *
 * 2. TWO classes are named `ExactAvmScheme` — the server one prices requests,
 *    the facilitator one signs and submits. A resource server needs the server
 *    one, so we import from the explicit subpath.
 */

import { HTTPFacilitatorClient, x402ResourceServer } from '@x402-avm/core/server';
import { ExactAvmScheme } from '@x402-avm/avm/exact/server';
import type { Caip2Network, PaymentRequirements } from '@atomicagent/shared';
import { env } from './env.js';
import { logger } from './logger.js';

/** Client for the public GoPlausible facilitator. */
export const facilitatorClient = new HTTPFacilitatorClient({
  url: env.facilitatorUrl,
});

/** The resource server, with the AVM exact scheme registered for our network. */
export const resourceServer = new x402ResourceServer(facilitatorClient).register(
  env.network as Caip2Network,
  new ExactAvmScheme(),
);

logger.info(
  { facilitator: env.facilitatorUrl, network: env.network, payTo: env.payTo },
  'x402 resource server ready',
);

/**
 * The payment terms for this service.
 *
 * A single entry. Most x402 services look like this — the tiered `accepts`
 * array AtomicAgent's own services publish is an unusual use of the spec, not
 * the common case.
 *
 * @returns the requirements to advertise in a 402
 */
export function buildPaymentRequirements(): PaymentRequirements {
  return {
    scheme: 'exact',
    network: env.network as Caip2Network,
    asset: env.asset.id,
    amount: env.feeAtomic,
    payTo: env.payTo,
    maxTimeoutSeconds: 120,
    extra: {
      decimals: env.asset.decimals,
      name: env.asset.symbol,
      // Required by the Global x402 Challenge for leaderboard attribution.
      tag: 'x402-global-challenge',
    },
  };
}