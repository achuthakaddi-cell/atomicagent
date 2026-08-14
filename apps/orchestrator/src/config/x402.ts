/**
 * x402 facilitator client for the orchestrator.
 *
 * Unlike the three services, the orchestrator does not register a resource
 * server scheme. It is not a resource server; it is a client that builds
 * payments and asks the facilitator to settle them.
 *
 * Note what this file does NOT contain: any signer, key, or mnemonic. The
 * orchestrator builds unsigned transactions and asks the facilitator to settle
 * a group the user has already signed. It has no ability to move funds, which
 * is a structural property rather than a policy.
 */

import { HTTPFacilitatorClient } from '@x402-avm/core/server';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Client for the public GoPlausible facilitator.
 * FacilitatorConfig is `{ url?: string; createAuthHeaders?: ... }` — verified.
 */
export const facilitatorClient = new HTTPFacilitatorClient({
  url: env.facilitatorUrl,
});

logger.info(
  { facilitator: env.facilitatorUrl, network: env.network },
  'facilitator client ready',
);