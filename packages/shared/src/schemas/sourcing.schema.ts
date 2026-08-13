/**
 * Zod schemas for sourcing input.
 *
 * These run on BOTH sides. The frontend validates before sending so the user
 * gets instant feedback; the backend validates again because client-side
 * validation is a convenience, never a security control.
 */

import { z } from 'zod';
import { CHECK_IDS } from '../constants/pricing.js';
import { ALGORAND_ADDRESS_REGEX } from '../constants/network.js';

/**
 * An amount in an asset's smallest unit.
 * Always a digit string — never a JS number, which loses precision above 2^53.
 */
export const atomicAmountSchema = z
  .string()
  .regex(/^\d{1,24}$/, 'Must be a whole number in atomic units');

/** A 58-character Algorand address. */
export const algorandAddressSchema = z
  .string()
  .regex(ALGORAND_ADDRESS_REGEX, 'Must be a valid 58-character Algorand address');

/** One of the three check ids. */
export const checkIdSchema = z.enum(CHECK_IDS);

/** A calendar date, YYYY-MM-DD. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a real date');

/** What the MSME submits to start a run. */
export const sourcingRequestSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(3, 'SKU must be at least 3 characters')
    .max(64, 'SKU must be at most 64 characters')
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      'SKU may contain letters, numbers, dots, dashes and underscores',
    ),

  quantity: z
    .number()
    .int('Quantity must be a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(1_000_000, 'Quantity must be at most 1,000,000'),

  maxUnitPriceAtomic: atomicAmountSchema,

  requiredBy: isoDateSchema,

  supplierId: z
    .string()
    .trim()
    .min(2, 'Supplier id must be at least 2 characters')
    .max(64, 'Supplier id must be at most 64 characters')
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      'Supplier id may contain letters, numbers, dots, dashes and underscores',
    ),
});

/** Body for POST /api/runs/quote. */
export const quoteRequestSchema = z.object({
  request: sourcingRequestSchema,
  /** The connected wallet address that will sign and pay. */
  buyerAddress: algorandAddressSchema,
});

/** Body for POST /api/runs/:runId/verify. */
export const verifyRequestSchema = z.object({
  /** The full signed group, base64 msgpack, in slot order. */
  signedGroup: z
    .array(z.string().min(1))
    .min(2, 'A payment group needs at least two transactions')
    .max(16, 'Algorand allows at most 16 transactions in a group'),
});

/** Body for POST /api/runs/:runId/settle. Empty by design. */
export const settleRequestSchema = z.object({}).strict();

/** A run id in a URL path. */
export const runIdParamSchema = z.object({
  runId: z
    .string()
    .uuid('Run id must be a UUID'),
});

export type SourcingRequestInput = z.infer<typeof sourcingRequestSchema>;
export type QuoteRequestInput = z.infer<typeof quoteRequestSchema>;
export type VerifyRequestInput = z.infer<typeof verifyRequestSchema>;
export type SettleRequestInput = z.infer<typeof settleRequestSchema>;