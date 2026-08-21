/**
 * Configuration for the carbon service.
 *
 * WHAT MAKES THIS SERVICE DIFFERENT
 * ---------------------------------
 * The other three are built as parts of AtomicAgent: each knows which slot of
 * the atomic group it is paid from, and rejects a payment pointed anywhere
 * else. That is correct for them.
 *
 * This one is deliberately written as a third party would write it. It has no
 * idea AtomicAgent exists. It verifies whatever payment index the client
 * declares, charges a single flat price, and knows nothing about tiers.
 *
 * That absence is the point of the whole exercise: if the orchestrator can pay
 * this service and bind it into a settlement, it can pay any x402 service.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { ALGORAND_ADDRESS_REGEX } from '@atomicagent/shared';

const here = path.dirname(fileURLToPath(import.meta.url));

// The .env lives at the repo root, four levels up from src/config.
dotenv.config({ path: path.resolve(here, '../../../../.env') });

const schema = z.object({
  // Railway and most container platforms assign a port at runtime via PORT.
  PORT: z.coerce.number().int().positive().optional(),
  PORT_SERVICE_CARBON: z.coerce.number().int().positive().default(4104),

  X402_NETWORK: z.string().min(10),
  FACILITATOR_URL: z.string().url(),

  SVC_CARBON_ADDRESS: z.string().regex(ALGORAND_ADDRESS_REGEX, {
    message: 'SVC_CARBON_ADDRESS is not a valid Algorand address',
  }),

  PAYMENT_ASSET_ID: z.string().regex(/^\d+$/),
  PAYMENT_ASSET_DECIMALS: z.coerce.number().int().min(0).max(19).default(6),
  PAYMENT_ASSET_SYMBOL: z.string().default('aUSDC'),

  /**
   * What this service charges. One price, no tiers.
   *
   * Deliberately not matching any of AtomicAgent's tier prices, so it is
   * visibly a different service when the settled group is inspected.
   */
  FEE_CARBON: z.string().regex(/^\d+$/).default('25000'),

  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((issue) => issue.path.join('.') + ': ' + issue.message)
    .join('\n  ');

  console.error('\nCarbon service configuration is invalid:\n  ' + detail + '\n');
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  port: raw.PORT ?? raw.PORT_SERVICE_CARBON,
  network: raw.X402_NETWORK,
  facilitatorUrl: raw.FACILITATOR_URL,
  payTo: raw.SVC_CARBON_ADDRESS,
  asset: {
    id: raw.PAYMENT_ASSET_ID,
    decimals: raw.PAYMENT_ASSET_DECIMALS,
    symbol: raw.PAYMENT_ASSET_SYMBOL,
  },
  feeAtomic: raw.FEE_CARBON,
  corsOrigins: raw.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  rateLimit: {
    windowMs: raw.RATE_LIMIT_WINDOW_MS,
    max: raw.RATE_LIMIT_MAX_REQUESTS,
  },
  logLevel: raw.LOG_LEVEL,
  isProduction: raw.NODE_ENV === 'production',
} as const;

export type Env = typeof env;