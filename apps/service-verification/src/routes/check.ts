/**
 * The seller-verification check route.
 *
 * Reached only after x402VerifyOnly has confirmed a valid, unsettled payment.
 *
 * TWO-STAGE RESOURCE RELEASE
 * --------------------------
 * Returns the verdict and a hash of the detail, but not the detail itself.
 * The full payload — including the GSTIN — is released after settlement.
 */

import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ok, type CheckVerdict } from '@atomicagent/shared';
import { runVerificationCheck, listSellers } from '../domain/sellerRegistry.js';
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
  supplierId: z.string().trim().min(2).max(64),
});

/**
 * Hashes the detail payload so the verdict can be proven unchanged later.
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
 * POST /check/verification
 *
 * Without X-PAYMENT  -> 402 with payment requirements
 * With X-PAYMENT     -> verify, run the check, return a verdict
 */
checkRouter.post(
  '/verification',
  checkLimiter,
  x402VerifyOnly(),
  asyncRoute(async (req, res) => {
    const context = requirePaymentContext(req);
    const body = checkBodySchema.parse(req.body);

    const result = runVerificationCheck({ supplierId: body.supplierId });

    const verdict: CheckVerdict = {
      checkId: 'verification',
      passed: result.passed,
      reason: result.reason,
      detailHash: hashDetail(result.detail),
      // detail deliberately omitted until settlement
    };

    logger.info(
      { supplierId: body.supplierId, passed: result.passed, payer: context.payer },
      'verification check complete',
    );

    res.status(200).json(ok(verdict));
  }),
);

/**
 * GET /sellers
 *
 * Free and unpaid, with GSTINs withheld. Lets the demo UI show which suppliers
 * exist and why one might fail, without giving away the paid detail.
 */
checkRouter.get('/sellers', (_req, res) => {
  res.status(200).json(ok({ items: listSellers() }));
});