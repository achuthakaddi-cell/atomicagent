/**
 * x402 wiring for this service.
 *
 * Two subtleties, both discovered by probing the installed package rather than
 * trusting the documentation:
 *
 * 1. `registerExactAvmScheme` IS exported at runtime from
 *    @x402-avm/avm/exact/server, but it has no entry in the shipped .d.ts
 *    files. Calling it from TypeScript therefore fails to compile. We use the
 *    fully-typed equivalent instead:
 *        server.register(network, new ExactAvmScheme())
 *
 * 2. TWO different classes are both named `ExactAvmScheme`:
 *      @x402-avm/avm/exact/server       — prices and builds requirements. No keys.
 *      @x402-avm/avm/exact/facilitator  — signs and submits. Requires a signer.
 *    A resource server must use the SERVER one. Importing from the package root
 *    is ambiguous, so we always use the explicit subpath.
 */

import { HTTPFacilitatorClient, x402ResourceServer } from '@x402-avm/core/server';
import { ExactAvmScheme } from '@x402-avm/avm/exact/server';
import type { Caip2Network, PaymentRequirements } from '@atomicagent/shared';
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
 * `register` returns the server for chaining — verified in the type declarations.
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
 * Builds the payment requirements this service advertises in its 402.
 *
 * @returns the requirements for a seller-verification check
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
    },
  };
}