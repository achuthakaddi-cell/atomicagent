/**
 * The run lifecycle API.
 *
 *   POST /api/runs/quote          collect quotes, build the unsigned group
 *   POST /api/runs/:runId/verify  fan out the signed group to all three checks
 *   POST /api/runs/:runId/settle  settle once, only if all three passed
 *   GET  /api/runs/:runId         read current state
 *
 * The phase machine in runStore enforces the order. Calling settle before
 * verify, or verifying twice, is rejected with a clear message rather than
 * producing undefined behaviour.
 */

import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { AppError } from '@atomicagent/shared';
import { ERROR_CODE } from '@atomicagent/shared';
import { ok } from '@atomicagent/shared';
import { ATOMIC_GROUP_SIZE } from '@atomicagent/shared';
import { GROUP_SLOT } from '@atomicagent/shared';
import { quoteRequestSchema } from '@atomicagent/shared';
import { verifyRequestSchema } from '@atomicagent/shared';
import { runIdParamSchema } from '@atomicagent/shared';
import { multiplyAtomicAmount } from '@atomicagent/shared';
import { sumAtomicAmounts } from '@atomicagent/shared';
import type { AbortResult } from '@atomicagent/shared';
import type { QuoteResult } from '@atomicagent/shared';
import type { SettleResult } from '@atomicagent/shared';
import type { VerifyResult } from '@atomicagent/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getFeePayer } from '../config/facilitator.js';
import { createRun } from '../agent/runStore.js';
import { getRun } from '../agent/runStore.js';
import { transition } from '../agent/runStore.js';
import { requirePhase } from '../agent/runStore.js';
import { claimSettleLock } from '../agent/runStore.js';
import { abortRun } from '../agent/runStore.js';
import { collectQuotes } from '../agent/quoteCollector.js';
import { buildAtomicGroup } from '../agent/groupBuilder.js';
import { validateSignedGroup } from '../agent/groupBuilder.js';
import { verifyAll } from '../agent/verifier.js';
import { settleGroup } from '../agent/settler.js';
import { describeAbort } from '../agent/settler.js';
import { asyncRoute } from '../middleware/errorHandler.js';
import { quoteLimiter } from '../middleware/rateLimit.js';
import { settleLimiter } from '../middleware/rateLimit.js';

/**
 * Explicit type annotation required.
 *
 * With `declaration: true`, TypeScript must write a .d.ts entry for this
 * export. Router() infers a type from @types/express-serve-static-core, a
 * transitive dependency pnpm nests inside .pnpm/ (error TS2742).
 */
export const runsRouter: ExpressRouter = Router();

/**
 * POST /api/runs/quote
 *
 * Collects the three 402 challenges, prices the order, and builds the unsigned
 * atomic group. Nothing is signed and nothing is spent.
 */
runsRouter.post(
  '/quote',
  quoteLimiter,
  asyncRoute(async (req, res) => {
    const body = quoteRequestSchema.parse(req.body);
    const run = createRun(body.request, body.buyerAddress);

    // ---- 1. Harvest the three 402 challenges ----
    const { quotes } = await collectQuotes(body.request);
    run.quotes = quotes;

    // ---- 2. Price the order for slot 4 ----
    //
    // The buyer's ceiling is used, not the supplier's quoted price. The price
    // check has not run yet, so we do not know the real figure. Signing for the
    // ceiling means the buyer can never be charged more than they agreed, and
    // the price check independently confirms the true price is at or below it.
    const orderTotalAtomic = multiplyAtomicAmount(
      body.request.maxUnitPriceAtomic,
      body.request.quantity,
    );

    run.orderTotalAtomic = orderTotalAtomic;

    // ---- 3. Build the atomic group ----
    const feePayer = getFeePayer();
    run.feePayer = feePayer;

    const built = await buildAtomicGroup({
      buyerAddress: body.buyerAddress,
      feePayer,
      quotes,
      orderTotalAtomic,
      runId: run.id,
    });

    run.unsignedGroup = built.unsignedGroup;
    run.groupId = built.groupId;
    run.totalFeesAtomic = built.totalFeesAtomic;

    transition(run, 'awaiting_signature');

    const result: QuoteResult = {
      runId: run.id,
      quotes: quotes.map((quote) => ({
        checkId: quote.checkId,
        feeAtomic: quote.feeAtomic,
        payTo: quote.payTo,
        asset: quote.asset,
        maxTimeoutSeconds: quote.maxTimeoutSeconds,
      })),
      totalFeesAtomic: built.totalFeesAtomic,
      orderTotalAtomic: built.orderTotalAtomic,
      grandTotalAtomic: built.grandTotalAtomic,
      asset: {
        id: env.asset.id,
        decimals: env.asset.decimals,
        symbol: env.asset.symbol,
      },
      unsignedGroup: built.unsignedGroup,
      groupLayout: {
        feePayer: GROUP_SLOT.FEE_PAYER,
        price: GROUP_SLOT.PRICE,
        availability: GROUP_SLOT.AVAILABILITY,
        verification: GROUP_SLOT.VERIFICATION,
        order: GROUP_SLOT.ORDER,
      },
    };

    res.status(200).json(ok(result));
  }),
);

/**
 * POST /api/runs/:runId/verify
 *
 * Accepts the signed group and fans it out to all three services, each with a
 * different paymentIndex. Returns the verdicts. Settles nothing.
 */
runsRouter.post(
  '/:runId/verify',
  asyncRoute(async (req, res) => {
    const params = runIdParamSchema.parse(req.params);
    const body = verifyRequestSchema.parse(req.body);

    const run = getRun(params.runId);
    requirePhase(run, 'awaiting_signature');

    // ---- Validate what the wallet returned ----
    const validation = validateSignedGroup(body.signedGroup, ATOMIC_GROUP_SIZE);

    if (!validation.valid) {
      throw new AppError(
        ERROR_CODE.GROUP_MALFORMED,
        'The signed group is not valid',
        { runId: run.id, detail: validation.reason ?? 'unknown problem' },
      );
    }

    run.signedGroup = body.signedGroup;
    transition(run, 'verifying');

    // ---- Fan out ----
    const outcome = await verifyAll({
      runId: run.id,
      request: run.request,
      quotes: run.quotes,
      signedGroup: body.signedGroup,
    });

    run.verdicts = outcome.verdicts;

    // ---- If anything failed, abort here. Nothing is submitted. ----
    if (!outcome.allPassed) {
      abortRun(run, outcome.failureSummary ?? 'one or more checks failed');

      const abortResult: AbortResult = {
        runId: run.id,
        failedChecks: outcome.failedChecks,
        verdicts: outcome.verdicts,
        nothingSettled: true,
        reason: outcome.failureSummary ?? 'one or more checks failed',
      };

      // 200, not an error status. A failed check is a valid, useful answer:
      // the agent did its job and correctly refused to pay.
      res.status(200).json(ok(abortResult));
      return;
    }

    const result: VerifyResult = {
      runId: run.id,
      verdicts: outcome.verdicts,
      allPassed: true,
      failedChecks: [],
    };

    res.status(200).json(ok(result));
  }),
);

/**
 * POST /api/runs/:runId/settle
 *
 * Submits the atomic group. Reachable only from the `verifying` phase with
 * every check passed. There is no other path to this call.
 */
runsRouter.post(
  '/:runId/settle',
  settleLimiter,
  asyncRoute(async (req, res) => {
    const params = runIdParamSchema.parse(req.params);
    const run = getRun(params.runId);

    requirePhase(run, 'verifying');

    // ---- The gate ----
    //
    // Re-checked here rather than trusted from the verify call. A client could
    // call settle directly, and this route must refuse without relying on the
    // previous step having been honest.
    const failed = run.verdicts.filter((verdict) => !verdict.passed);

    if (failed.length > 0 || run.verdicts.length !== 3) {
      throw new AppError(
        ERROR_CODE.RUN_STATE_INVALID,
        'Cannot settle: not every check passed',
        {
          runId: run.id,
          detail:
            failed.length > 0
              ? 'failed: ' + failed.map((verdict) => verdict.checkId).join(', ')
              : 'only ' + String(run.verdicts.length) + ' of 3 verdicts recorded',
        },
      );
    }

    if (!run.signedGroup || !run.groupId) {
      throw new AppError(
        ERROR_CODE.RUN_STATE_INVALID,
        'Cannot settle: no signed group on file',
        { runId: run.id },
      );
    }

    // Synchronous, before any await. Two concurrent requests cannot both pass.
    claimSettleLock(run);
    transition(run, 'settling');

    let outcome;

    try {
      outcome = await settleGroup({
        runId: run.id,
        signedGroup: run.signedGroup,
        quotes: run.quotes,
        groupId: run.groupId,
      });
    } catch (cause) {
      // Settlement failed. The run is dead either way — but we cannot claim
      // "nothing settled", because the group may have reached the network
      // before the failure. The message stays honest about that uncertainty.
      abortRun(run, 'settlement failed');
      throw cause;
    }

    run.txId = outcome.txId;
    transition(run, 'settled');

    const totalPaidAtomic = sumAtomicAmounts([
      run.totalFeesAtomic,
      run.orderTotalAtomic,
    ]);

    const result: SettleResult = {
      runId: run.id,
      txId: outcome.txId,
      explorerUrl: outcome.explorerUrl,
      verdicts: run.verdicts,
      totalPaidAtomic,
    };

    logger.info(
      { runId: run.id, txId: outcome.txId, totalPaidAtomic },
      'run settled',
    );

    res.status(200).json(ok(result));
  }),
);

/**
 * GET /api/runs/:runId
 *
 * Reads current run state. Never returns the signed transactions.
 */
runsRouter.get(
  '/:runId',
  asyncRoute(async (req, res) => {
    const params = runIdParamSchema.parse(req.params);
    const run = getRun(params.runId);

    res.status(200).json(
      ok({
        runId: run.id,
        phase: run.phase,
        request: run.request,
        buyerAddress: run.buyerAddress,
        quotes: run.quotes,
        groupId: run.groupId,
        totalFeesAtomic: run.totalFeesAtomic,
        orderTotalAtomic: run.orderTotalAtomic,
        verdicts: run.verdicts,
        txId: run.txId,
        explorerUrl: run.txId
          ? env.explorerBaseUrl + '/transaction/' + run.txId
          : null,
        abortReason: run.abortReason,
        nothingSettled: run.phase === 'aborted' ? true : undefined,
        abortDetail:
          run.phase === 'aborted' && run.abortReason
            ? describeAbort(run.id, run.abortReason).explanation
            : undefined,
      }),
    );

    return Promise.resolve();
  }),
);