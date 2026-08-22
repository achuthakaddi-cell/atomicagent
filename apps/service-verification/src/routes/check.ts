/**
 * The seller-verification check route, tiered.
 *
 * The tier is decided by what the client paid, not what it asked for. A
 * shallow payment buys a cached registry snapshot that may predate a recent
 * suspension; a deep payment retrieves dispute history and adverse filings.
 * The agent escalates when a cheap answer is not good enough, which is only a
 * meaningful decision because each tier costs money.
 *
 * TWO-STAGE RESOURCE RELEASE
 * --------------------------
 * The verdict and a hash of the detail are returned; the detail itself —
 * including the GSTIN — is withheld until settlement.
 */

import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ok } from '@atomicagent/shared';
import { TIER_SPECS } from '@atomicagent/shared';
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
 * transitive dependency pnpm nests inside .pnpm/ (error TS2742).
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
 * Without X-PAYMENT  -> 402 listing all three tiers
 * With X-PAYMENT     -> verify, run the check at the paid tier, return a verdict
 */
checkRouter.post(
  '/verification',
  checkLimiter,
  x402VerifyOnly(),
  asyncRoute(async (req, res) => {
    const context = requirePaymentContext(req);
    const body = checkBodySchema.parse(req.body);

    // Simulate the latency of the tier that was paid for. A full audit takes
    // longer than a cache read, and the UI shows that difference.
    const latency = TIER_SPECS[context.tier].latencyMs;
    await new Promise((resolve) => setTimeout(resolve, Math.min(latency, 2600)));

    const result = await runVerificationCheck({
      supplierId: body.supplierId,
      tier: context.tier,
    });

    const verdict = {
      checkId: 'verification' as const,
      tier: result.tier,
      confidence: result.confidence,
      certainty: result.certainty,
      // Retained for compatibility with the existing UI. Only a confirmed
      // answer counts as a pass; ambiguous is explicitly not one.
      passed: result.confidence === 'confirmed',
      reason: result.reason,
      wouldResolve: result.wouldResolve ?? null,
      detailHash: hashDetail(result.detail),
      // detail deliberately omitted until settlement
    };

    logger.info(
      {
        supplierId: body.supplierId,
        tier: context.tier,
        confidence: result.confidence,
        certainty: result.certainty,
        payer: context.payer,
      },
      'verification check complete',
    );

    res.status(200).json(ok(verdict));
  }),
);

/**
 * GET /sellers
 *
 * Free and unpaid, with GSTINs and dispute history withheld. Those are paid
 * information, so publishing them here would undercut the tier system.
 */
checkRouter.get('/sellers', (_req, res) => {
  res.status(200).json(ok({ items: listSellers() }));
});

/**
 * GET /tiers
 *
 * The price ladder, so a client can see the options before committing.
 */
checkRouter.get('/tiers', (_req, res) => {
  res.status(200).json(ok({ tiers: TIER_SPECS }));
});