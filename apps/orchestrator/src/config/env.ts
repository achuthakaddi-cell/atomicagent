/**
 * Environment loading and validation.
 *
 * The orchestrator needs more configuration than the three services: it must
 * reach all of them, reach algod, and know the supplier address for slot 4 of
 * the atomic group.
 *
 * Note what is NOT here: any private key or mnemonic. The orchestrator builds
 * unsigned transactions and hands them to the browser. The user's wallet signs.
 * The facilitator signs the fee payer. This service can never move funds, and
 * that is a structural property rather than a policy we promise to follow.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { ALGORAND_ADDRESS_REGEX } from '@atomicagent/shared';

// The monorepo keeps ONE .env at the root. Resolve upward from this file so the
// path is correct whether we run from src (tsx) or dist (node).
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const addressSchema = (label: string) =>
  z.string().regex(ALGORAND_ADDRESS_REGEX, `${label} must be a 58-char Algorand address`);

const envSchema = z.object({
  PORT_ORCHESTRATOR: z.coerce.number().int().positive().default(4100),

  X402_NETWORK: z
    .string()
    .regex(/^algorand:.+$/, 'X402_NETWORK must be an Algorand CAIP-2 identifier'),

  FACILITATOR_URL: z.string().url('FACILITATOR_URL must be a valid URL'),

  ALGOD_SERVER: z.string().url('ALGOD_SERVER must be a valid URL'),
  ALGOD_PORT: z.coerce.number().int().min(0).max(65535).default(443),
  ALGOD_TOKEN: z.string().default(''),

  EXPLORER_BASE_URL: z.string().url().default('https://lora.algokit.io/testnet'),

  // Where each microservice lives.
  URL_SERVICE_PRICE: z.string().url(),
  URL_SERVICE_AVAILABILITY: z.string().url(),
  URL_SERVICE_VERIFICATION: z.string().url(),

  // Slot 4 of the atomic group: the actual order payment.
  SUPPLIER_ADDRESS: addressSchema('SUPPLIER_ADDRESS'),

  PAYMENT_ASSET_ID: z.string().regex(/^\d+$/, 'PAYMENT_ASSET_ID must be a numeric ASA id'),
  PAYMENT_ASSET_DECIMALS: z.coerce.number().int().min(0).max(19).default(6),
  PAYMENT_ASSET_SYMBOL: z.string().min(1).default('USDC'),

  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Written with console because the logger is not configured yet at this point.
  console.error('\n[orchestrator] Invalid environment configuration:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCheck your .env file against .env.example.\n');
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  port: raw.PORT_ORCHESTRATOR,
  network: raw.X402_NETWORK,
  facilitatorUrl: raw.FACILITATOR_URL,

  algod: {
    server: raw.ALGOD_SERVER,
    port: raw.ALGOD_PORT,
    token: raw.ALGOD_TOKEN,
  },

  explorerBaseUrl: raw.EXPLORER_BASE_URL,

  services: {
    price: raw.URL_SERVICE_PRICE,
    availability: raw.URL_SERVICE_AVAILABILITY,
    verification: raw.URL_SERVICE_VERIFICATION,
  },

  supplierAddress: raw.SUPPLIER_ADDRESS,

  asset: {
    id: raw.PAYMENT_ASSET_ID,
    decimals: raw.PAYMENT_ASSET_DECIMALS,
    symbol: raw.PAYMENT_ASSET_SYMBOL,
  },

  corsOrigins: raw.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  rateLimit: {
    windowMs: raw.RATE_LIMIT_WINDOW_MS,
    max: raw.RATE_LIMIT_MAX_REQUESTS,
  },
  logLevel: raw.LOG_LEVEL,
  isProduction: raw.NODE_ENV === 'production',
} as const;

export type Env = typeof env;