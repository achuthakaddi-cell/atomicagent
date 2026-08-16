/**
 * The run lifecycle API, with adaptive spend.
 *
 *   POST /api/runs/quote          collect quotes, build the group at shallow tiers
 *   POST /api/runs/:runId/verify  verify at current tiers, then either settle,
 *                                 escalate, or abort
 *   POST /api/runs/:runId/settle  settle once, paying every fee earned
 *   GET  /api/runs/:runId         read current state and the spend ledger
 *
 * THE ESCALATION LOOP
 * -------------------
 * Verification can end three ways:
 *
 *   all confirmed      -> the run is ready to settle
 *   uncertain, funded  -> the agent buys a deeper answer and asks the user to
 *                         approve the extra spend, which means a new signature
 *   uncertain, unfunded, or refuted -> abort, nothing settled
 *
 * The re-signature is deliberate. Pre-authorising a maximum would let the agent
 * spend money the user never specifically approved, which is the model this
 * project argues against. Asking again is both more honest and more legible.
 */

import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { AppError } from '@atomicagent/shared';
import { ERROR_CODE } from '@atomicagent/shared';
import { ok } from '@atomicagent/shared';
import { ATOMIC_GROUP_SIZE } from '@atomicagent/shared';
import { GROUP_SLOT } from '@atomicagent/shared';
import { TIER_SPECS } from '@atomicagent/shared';
import { quoteRequestSchema } from '@atomicagent/shared';
import { verifyRequestSchema } from '@atomicagent/shared';
import { runIdParamSchema } from '@atomicagent/shared';
import { multiplyAtomicAmount } from '@atomicagent/shared';
import { sumAtomicAmounts } from '@atomicagent/shared';
import type { CheckId } from '@atomicagent/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getFeePayer } from '../config/facilitator.js';
import { createRun } from '../agent/runStore.js';
import { getRun } from '../agent/runStore.js';
import { transition } from '../agent/runStore.js';
import { requirePhase } from '../agent/runStore.js';
import { claimSettleLock } from '../agent/runStore.js';
import { abortRun } from '../agent/runStore.js';
import type { Run } from '../agent/runStore.js';
import { collectQuotes } from '../agent/quoteCollector.js';
import { buildAtomicGroup } from '../agent/groupBuilder.js';
import { validateSignedGroup } from '../agent/groupBuilder.js';
import { verifyAll } from '../agent/verifier.js';
import { settleGroup } from '../agent/settler.js';
import { openingPlan } from '../agent/spendPlanner.js';
import { planEscalation } from '../agent/spendPlanner.js';
import { recordRound } from '../agent/spendPlanner.js';
import { blockingReason } from '../agent/spendPlanner.js';
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

/** Highest number of escalation rounds. Three tiers means at most two. */
const MAX_ROUNDS = 3;

/**
 * Builds the payee map from a run's quotes.
 *
 * @param run - the run
 * @returns each check's payee address
 */
function payeeMap(run: Run): Record<CheckId, string> {
  const find = (checkId: CheckId): string => {
    const quote = run.quotes.find((entry) => entry.checkId === checkId);
    if (!quote) {
      throw new AppError(
        ERROR_CODE.GROUP_MALFORMED,
        'Missing the ' + checkId + ' quote',
        { runId: run.id },
      );
    }
    return quote.payTo;
  };

  return {
    price: find('price'),
    availability: find('availability'),
    verification: find('verification'),
  };
}

/**
 * Rebuilds the atomic group at the run's current tiers and returns it unsigned.
 *
 * Called for the opening round and every escalation, because changing a tier
 * changes an amount, which changes the group, which requires a fresh signature.
 *
 * WHY THE GROUP CARRIES ONE TIER FEE, NOT A RUNNING TOTAL
 * -------------------------------------------------------
 * A service identifies which tier a client paid for by matching the amount
 * against its price list. A cumulative figure — shallow plus standard — matches
 * no tier and is rejected outright. So the group always carries exactly the
 * current tier's fee, and an escalated round replaces the earlier payment
 * rather than adding to it.
 *
 * The earlier round's group was never broadcast, so nothing was actually paid
 * for the answer that got superseded. That is a real cost the services absorb,
 * and the honest framing is that a superseded shallow answer was never bought.
 *
 * @param run - the run to build for
 * @returns the unsigned group and its totals
 */
async function rebuildGroup(run: Run) {
  const feePayer = run.feePayer ?? getFeePayer();
  run.feePayer = feePayer;

  // Exactly the current tier's fee per check. Never a running total.
  const fees: Record<CheckId, string> = {
    price: TIER_SPECS[run.tiers.price].feeAtomic,
    availability: TIER_SPECS[run.tiers.availability].feeAtomic,
    verification: TIER_SPECS[run.tiers.verification].feeAtomic,
  };

  run.cumulativeFees = fees;

  const built = await buildAtomicGroup({
    buyerAddress: run.buyerAddress,
    feePayer,
    quotes: run.quotes,
    orderTotalAtomic: run.orderTotalAtomic,
    runId: run.id,
    cumulativeFees: fees,
  });

  run.unsignedGroup = built.unsignedGroup;
  run.groupId = built.groupId;
  run.totalFeesAtomic = built.totalFeesAtomic;
  run.signedGroup = null;

  return built;
}

/**
 * The response shape for a round that needs a signature.
 *
 * @param run - the run
 * @param built - the freshly built group
 * @returns the payload for the client
 */
function signaturePayload(run: Run, built: Awaited<ReturnType<typeof rebuildGroup>>) {
  return {
    runId: run.id,
    round: run.ledger.rounds,
    needsSignature: true as const,
    tiers: run.tiers,
    quotes: run.quotes.map((quote) => ({
      checkId: quote.checkId,
      feeAtomic: run.cumulativeFees[quote.checkId],
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
    ledger: run.ledger,
    verdicts: run.verdicts,
  };
}

/**
 * POST /api/runs/quote
 *
 * Collects the three 402 challenges, prices the order, and builds the group at
 * shallow tiers. Nothing is signed and nothing is spent.
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
    // The buyer's ceiling is used, not the supplier's price. The price check
    // has not run yet, so we do not know the real figure. Signing for the
    // ceiling means the buyer can never be charged more than they agreed.
    run.orderTotalAtomic = multiplyAtomicAmount(
      body.request.maxUnitPriceAtomic,
      body.request.quantity,
    );

    // ---- 3. Open at the cheapest tier ----
    //
    // Buying certainty before knowing whether it is needed is the waste this
    // design exists to avoid.
    const plan = openingPlan(run.ledger.policy);
    run.tiers = plan.tiers;

    recordRound(run.ledger, plan);

    const built = await rebuildGroup(run);

    transition(run, 'awaiting_signature');

    res.status(200).json(ok(signaturePayload(run, built)));
  }),
);

/**
 * POST /api/runs/:runId/verify
 *
 * Verifies at the current tiers, then decides: settle, escalate, or abort.
 */
runsRouter.post(
  '/:runId/verify',
  asyncRoute(async (req, res) => {
    const params = runIdParamSchema.parse(req.params);
    const body = verifyRequestSchema.parse(req.body);

    const run = getRun(params.runId);
    requirePhase(run, 'awaiting_signature');

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

    // ---- fan out at the current tiers ----
    const outcome = await verifyAll({
      runId: run.id,
      request: run.request,
      tiers: run.tiers,
      payTo: payeeMap(run),
      signedGroup: body.signedGroup,
    });

    run.verdicts = outcome.verdicts;

    // ---- all confirmed: ready to settle ----
    if (outcome.allConfirmed) {
      res.status(200).json(
        ok({
          runId: run.id,
          round: run.ledger.rounds,
          needsSignature: false as const,
          readyToSettle: true as const,
          verdicts: outcome.verdicts,
          tiers: run.tiers,
          ledger: run.ledger,
        }),
      );
      return;
    }

    // ---- can the agent afford to resolve the uncertainty? ----
    const escalation =
      run.ledger.rounds < MAX_ROUNDS
        ? planEscalation({
            verdicts: outcome.verdicts,
            ledger: run.ledger,
            currentTiers: run.tiers,
          })
        : null;

    if (escalation !== null) {
      logger.info(
        {
          runId: run.id,
          round: run.ledger.rounds + 1,
          tiers: escalation.tiers,
          cost: escalation.roundCostAtomic,
        },
        'agent escalating, requesting a fresh signature',
      );

      run.tiers = escalation.tiers;

      recordRound(run.ledger, escalation);

      const built = await rebuildGroup(run);

      // Back to awaiting_signature. The group changed, so the user must
      // approve the new amount.
      transition(run, 'awaiting_signature');

      res.status(200).json(ok(signaturePayload(run, built)));
      return;
    }

    // ---- nothing left to try: abort ----
    //
    // Either a check was refuted, or the budget cannot resolve the remaining
    // uncertainty. Settling on an uncertain verification is precisely what
    // this system exists to prevent.
    const reason =
      blockingReason(outcome.verdicts) ??
      outcome.summary ??
      'one or more checks could not be confirmed';

    abortRun(run, reason);

    res.status(200).json(
      ok({
        runId: run.id,
        round: run.ledger.rounds,
        needsSignature: false as const,
        readyToSettle: false as const,
        nothingSettled: true as const,
        failedChecks: outcome.unresolved,
        verdicts: outcome.verdicts,
        reason,
        ledger: run.ledger,
      }),
    );
  }),
);

/**
 * POST /api/runs/:runId/settle
 *
 * Submits the atomic group. Reachable only from the verifying phase with every
 * check confirmed. There is no other path to this call.
 */
runsRouter.post(
  '/:runId/settle',
  settleLimiter,
  asyncRoute(async (req, res) => {
    const params = runIdParamSchema.parse(req.params);
    const run = getRun(params.runId);

    requirePhase(run, 'verifying');

    // ---- the gate ----
    //
    // Re-checked here rather than trusted from the verify call. A client could
    // call settle directly, and this route must refuse without relying on the
    // previous step having been honest.
    const unconfirmed = run.verdicts.filter((v) => v.confidence !== 'confirmed');

    if (unconfirmed.length > 0 || run.verdicts.length !== 3) {
      throw new AppError(
        ERROR_CODE.RUN_STATE_INVALID,
        'Cannot settle: not every check confirmed',
        {
          runId: run.id,
          detail:
            unconfirmed.length > 0
              ? 'unconfirmed: ' + unconfirmed.map((v) => v.checkId).join(', ')
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
        tiers: run.tiers,
      });
    } catch (cause) {
      // Settlement failed. The run is dead either way, but we cannot claim
      // "nothing settled" because the group may have reached the network
      // before the failure. The message stays honest about that.
      abortRun(run, 'settlement failed');
      throw cause;
    }

    run.txId = outcome.txId;
    transition(run, 'settled');

    const totalPaidAtomic = sumAtomicAmounts([
      run.totalFeesAtomic,
      run.orderTotalAtomic,
    ]);

    logger.info(
      {
        runId: run.id,
        txId: outcome.txId,
        totalPaidAtomic,
        rounds: run.ledger.rounds,
        verificationSpend: run.ledger.spentAtomic,
      },
      'run settled',
    );

    res.status(200).json(
      ok({
        runId: run.id,
        txId: outcome.txId,
        explorerUrl: outcome.explorerUrl,
        verdicts: run.verdicts,
        tiers: run.tiers,
        totalPaidAtomic,
        ledger: run.ledger,
      }),
    );
  }),
);

/**
 * GET /api/runs/:runId
 *
 * Reads current run state and the full spend ledger. Never returns the signed
 * transactions.
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
        tiers: run.tiers,
        cumulativeFees: run.cumulativeFees,
        ledger: run.ledger,
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
      }),
    );

    return Promise.resolve();
  }),
);