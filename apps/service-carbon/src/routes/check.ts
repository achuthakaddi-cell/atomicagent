/**
 * The carbon estimation endpoint.
 *
 * ACCEPTS AN EMPTY BODY, DELIBERATELY
 * -----------------------------------
 * A generic x402 client discovering this service from its 402 challenge alone
 * cannot know what fields it wants. If this endpoint required specific input it
 * could not be called generically, and the pluggability claim would be false.
 *
 * So every field is optional and sensible defaults apply. A caller that knows
 * more sends more and gets a better answer; one that knows nothing still gets a
 * usable estimate and is told which assumptions were made.
 *
 * That is a reasonable way to design an x402 service generally, not a
 * concession made for this demonstration.
 */

import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { ok } from '@atomicagent/shared';
import { estimateCarbon } from '../domain/carbonEngine.js';
import { x402Verify, requirePaymentContext } from '../middleware/x402Verify.js';
import { checkLimiter } from '../middleware/rateLimit.js';
import { asyncRoute } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Explicit type annotation required.
 *
 * With `declaration: true`, TypeScript must write a .d.ts entry for this
 * export. Router() infers a type from @types/express-serve-static-core, a
 * transitive dependency pnpm nests inside .pnpm/ (error TS2742).
 */
export const checkRouter: ExpressRouter = Router();

/** Every field optional. See the note above. */
const bodySchema = z.object({
  origin: z.string().trim().min(2).max(64).optional(),
  destination: z.string().trim().min(2).max(64).optional(),
  weightKg: z.number().positive().max(1_000_000).optional(),
  units: z.number().int().positive().max(1_000_000).optional(),
  mode: z.enum(['road', 'rail', 'sea', 'air']).optional(),
});

/**
 * POST /estimate
 *
 * Without X-PAYMENT  -> 402 with the terms
 * With X-PAYMENT     -> verify, estimate, return 200
 */
checkRouter.post(
  '/estimate',
  checkLimiter,
  x402Verify(),
  asyncRoute(async (req, res) => {
    const context = requirePaymentContext(req);

    // An empty body is valid. safeParse rather than parse, so a caller sending
    // something unexpected still gets an estimate rather than a 400.
    const parsed = bodySchema.safeParse(req.body ?? {});
    const body = parsed.success ? parsed.data : {};

    // Real work takes real time.
    await new Promise((resolve) => setTimeout(resolve, 900));

    const estimate = estimateCarbon(body);

    logger.info(
      {
        paymentIndex: context.paymentIndex,
        payer: context.payer,
        totalKgCo2e: estimate.totalKgCo2e,
        assumedDefaults: !parsed.success || Object.keys(body).length === 0,
      },
      'carbon estimate served',
    );

    res.status(200).json(
      ok({
        service: 'carbon',
        estimate,
        // Echoed so a caller can confirm which slot was charged. This service
        // did not choose the slot; it verified the one it was pointed at.
        paidFromSlot: context.paymentIndex,
        feeAtomic: env.feeAtomic,
      }),
    );
  }),
);

/**
 * GET /factors
 *
 * The emissions factors, free. Publishing the method costs nothing and lets a
 * caller judge the estimate rather than take it on trust. What is paid for is
 * the computation, not the constants.
 */
checkRouter.get('/factors', (_req, res) => {
  res.status(200).json(
    ok({
      unit: 'grams CO2e per tonne-kilometre',
      factors: { road: 62, rail: 22, sea: 8, air: 602 },
      cbamThresholdKg: 1000,
      note:
        'Sector averages, not measurements. A production service would use ' +
        'route-specific data, actual load factors and fuel mix.',
    }),
  );
});