/**
 * Environment loading and validation.
 *
 * Validates at startup and exits immediately if anything is missing. A service
 * that boots with a bad address and fails on the first request during a live
 * demo is far worse than one that refuses to start with a clear message.
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

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().optional(),
  PORT_SERVICE_VERIFICATION: z.coerce.number().int().positive().default(4103),

  X402_NETWORK: z
    .string()
    .regex(/^algorand:.+$/, 'X402_NETWORK must be an Algorand CAIP-2 identifier'),

  FACILITATOR_URL: z.string().url('FACILITATOR_URL must be a valid URL'),

  SVC_VERIFICATION_ADDRESS: z
    .string()
    .regex(
      ALGORAND_ADDRESS_REGEX,
      'SVC_VERIFICATION_ADDRESS must be a 58-char Algorand address',
    ),

  PAYMENT_ASSET_ID: z.string().regex(/^\d+$/, 'PAYMENT_ASSET_ID must be a numeric ASA id'),
  PAYMENT_ASSET_DECIMALS: z.coerce.number().int().min(0).max(19).default(6),
  PAYMENT_ASSET_SYMBOL: z.string().min(1).default('USDC'),

  /**
   * Live GST registry credentials.
   *
   * Optional by design. Without them the service degrades to structural
   * validation and declares that it has done so, rather than pretending to a
   * liveness it does not have.
   */
  GST_API_URL: z.string().url().optional(),
  GST_API_KEY: z.string().optional(),

  FEE_VERIFICATION: z
    .string()
    .regex(/^\d+$/, 'FEE_VERIFICATION must be atomic units (digits only)'),

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
  console.error('\n[service-verification] Invalid environment configuration:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCheck your .env file against .env.example.\n');
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  port: raw.PORT ?? raw.PORT_SERVICE_VERIFICATION,
  network: raw.X402_NETWORK,
  facilitatorUrl: raw.FACILITATOR_URL,
  payTo: raw.SVC_VERIFICATION_ADDRESS,
  asset: {
    id: raw.PAYMENT_ASSET_ID,
    decimals: raw.PAYMENT_ASSET_DECIMALS,
    symbol: raw.PAYMENT_ASSET_SYMBOL,
  },

  /**
   * Live registry endpoint and key.
   *
   * Null when unconfigured, which the lookup treats as a declared fallback
   * rather than a silent one.
   */
  gstApiUrl: raw.GST_API_URL ?? null,
  gstApiKey: raw.GST_API_KEY ?? null,

  feeAtomic: raw.FEE_VERIFICATION,
  corsOrigins: raw.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  rateLimit: {
    windowMs: raw.RATE_LIMIT_WINDOW_MS,
    max: raw.RATE_LIMIT_MAX_REQUESTS,
  },
  logLevel: raw.LOG_LEVEL,
  isProduction: raw.NODE_ENV === 'production',
} as const;

export type Env = typeof env;