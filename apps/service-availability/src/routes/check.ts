/**
 * The availability check route.
 *
 * Reached only after x402VerifyOnly has confirmed a valid, unsettled payment.
 *
 * TWO-STAGE RESOURCE RELEASE
 * --------------------------
 * Returns the verdict and a hash of the detail, but not the detail itself.
 * The full payload is released after settlement. Without this, an orchestrator
 * could collect three answers and never settle. With it, the unpaid answer is
 * a single boolean — not enough to be worth stealing.
 */

import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ok, isoDateSchema, type CheckVerdict } from '@atomicagent/shared';
import { runAvailabilityCheck, listStock } from '../domain/stockLedger.js';
import { x402VerifyOnly, requirePaymentContext } from '../middleware/x402Verify.js';
import { checkLimiter } from '../middleware/rateLimit.js';
import { asyncRoute } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';

/**
 * Explicit type annotation required.
 *
 * With `declaration: true`, TypeScript must write a .d.ts entry for this
 * export. Router() infers a type from @types/express-serve-static-core, a
 * transitive dependency pnpm nests inside .pnpm/ — TypeScript can see it but
 * cannot write a portable import path to it (error TS2742).
 */
export const checkRouter: ExpressRouter = Router();

/** What the orchestrator must send alongside the payment. */
const checkBodySchema = z.object({
  sku: z.string().trim().min(3).max(64),
  quantity: z.number().int().min(1).max(1_000_000),
  requiredBy: isoDateSchema,
  supplierId: z.string().trim().min(2).max(64),
});

/**
 * Hashes the detail payload so the verdict can be proven unchanged later.
 *
 * The client receives this hash before settlement and the full detail after.
 * Hashing the same object again must reproduce the hash — so the service
 * cannot quietly revise its answer once it has been paid.
 *
 * @param detail - the withheld detail object
 * @returns a hex sha256 digest
 */
function hashDetail(detail: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(detail ?? null))
    .digest('hex');
}

/**
 * POST /check/availability
 *
 * Without X-PAYMENT  -> 402 with payment requirements
 * With X-PAYMENT     -> verify, run the check, return a verdict
 */
checkRouter.post(
  '/availability',
  checkLimiter,
  x402VerifyOnly(),
  asyncRoute(async (req, res) => {
    const context = requirePaymentContext(req);
    const body = checkBodySchema.parse(req.body);

    const result = runAvailabilityCheck({
      sku: body.sku,
      quantity: body.quantity,
      requiredBy: body.requiredBy,
      supplierId: body.supplierId,
    });

    const verdict: CheckVerdict = {
      checkId: 'availability',
      passed: result.passed,
      reason: result.reason,
      detailHash: hashDetail(result.detail),
      // detail deliberately omitted until settlement
    };

    logger.info(
      { sku: body.sku, passed: result.passed, payer: context.payer },
      'availability check complete',
    );

    res.status(200).json(ok(verdict));
  }),
);

/**
 * GET /stock
 *
 * Free and unpaid. Lets the demo UI show real stock numbers so a judge can see
 * why a given SKU will pass or fail before running the flow.
 */
checkRouter.get('/stock', (_req, res) => {
  res.status(200).json(ok({ items: listStock() }));
});