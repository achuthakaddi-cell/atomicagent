/**
 * Zod schemas for x402 wire data.
 *
 * These validate anything arriving over HTTP before it reaches the SDK. The
 * facilitator does its own deep verification, but rejecting malformed input at
 * the edge keeps error messages clear and denies bad data a path inward.
 */

import { z } from 'zod';
import { MAX_ATOMIC_GROUP_SIZE } from '../constants/network.js';
import { algorandAddressSchema, atomicAmountSchema } from './sourcing.schema.js';

/** CAIP-2 network identifier: "namespace:reference". */
export const caip2NetworkSchema = z
  .string()
  .regex(/^[a-z0-9-]{3,8}:.+$/, 'Must be a CAIP-2 network identifier');

/** Payment requirements as they appear in a 402 response. */
export const paymentRequirementsSchema = z.object({
  scheme: z.literal('exact'),
  network: caip2NetworkSchema,
  asset: z.string().regex(/^\d+$/, 'Asset must be a numeric ASA id'),
  amount: atomicAmountSchema,
  payTo: algorandAddressSchema,
  maxTimeoutSeconds: z.number().int().positive().max(3600),
  extra: z.record(z.unknown()).default({}),
});

/**
 * The AVM exact-scheme payload.
 *
 * The superRefine is the important part: paymentIndex must land inside
 * paymentGroup. Without it, an out-of-range index reaches the facilitator and
 * comes back as an opaque error instead of a clear one.
 */
export const exactAvmPayloadSchema = z
  .object({
    paymentGroup: z
      .array(z.string().min(1, 'Transactions must be non-empty base64 strings'))
      .min(1, 'paymentGroup cannot be empty')
      .max(
        MAX_ATOMIC_GROUP_SIZE,
        `Algorand allows at most ${MAX_ATOMIC_GROUP_SIZE} transactions in a group`,
      ),
    paymentIndex: z.number().int().min(0),
  })
  .superRefine((value, ctx) => {
    if (value.paymentIndex >= value.paymentGroup.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['paymentIndex'],
        message: `paymentIndex ${value.paymentIndex} is outside a group of ${value.paymentGroup.length}`,
      });
    }
  });

/** The decoded X-PAYMENT header. */
export const paymentPayloadSchema = z.object({
  x402Version: z.number().int().positive(),
  resource: z.record(z.unknown()).optional(),
  accepted: paymentRequirementsSchema,
  payload: z.record(z.unknown()),
  extensions: z.record(z.unknown()).optional(),
});

export type PaymentRequirementsInput = z.infer<typeof paymentRequirementsSchema>;
export type ExactAvmPayloadInput = z.infer<typeof exactAvmPayloadSchema>;
export type PaymentPayloadInput = z.infer<typeof paymentPayloadSchema>;