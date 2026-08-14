/**
 * Harvests the three 402 challenges.
 *
 * Each service is called WITHOUT payment. Each answers 402 with its payment
 * requirements: how much, to which address, in which asset, on which network.
 * Nothing is signed and nothing is spent at this stage.
 *
 * All three run in parallel. Sequential calls would triple the wait for no
 * benefit, since the three services are independent.
 *
 * If any one fails, the whole quote fails. A group can only be built when the
 * cost of every slot is known.
 */

import { AppError } from '@atomicagent/shared';
import { ERROR_CODE } from '@atomicagent/shared';
import { paymentRequirementsSchema } from '@atomicagent/shared';
import { PAYMENT_INDEX_BY_CHECK } from '@atomicagent/shared';
import type { CheckId } from '@atomicagent/shared';
import type { CheckQuote } from '@atomicagent/shared';
import type { SourcingRequest } from '@atomicagent/shared';
import { logger } from '../config/logger.js';
import { requestQuote } from '../clients/serviceClient.js';

/** What one service returns in its 402 body. */
interface Challenge402 {
  x402Version?: number;
  error?: string;
  accepts?: unknown[];
  atomicAgent?: {
    paymentIndex?: number;
    checkId?: string;
  };
}

/** A quote plus the slot the service expects to be paid from. */
export interface QuoteWithIndex extends CheckQuote {
  /** Slot this service verifies. Cross-checked against our own constant. */
  declaredPaymentIndex: number;
}

/**
 * Builds the request body each service expects.
 *
 * The three services need different fields. Price needs the ceiling and
 * quantity; availability needs the deadline; verification needs only the
 * supplier. Sending each exactly what it needs keeps the contracts narrow.
 *
 * @param checkId - which service the body is for
 * @param request - the buyer's sourcing request
 * @returns the body to POST
 */
export function buildCheckBody(
  checkId: CheckId,
  request: SourcingRequest,
): unknown {
  if (checkId === 'price') {
    return {
      sku: request.sku,
      quantity: request.quantity,
      maxUnitPriceAtomic: request.maxUnitPriceAtomic,
      supplierId: request.supplierId,
    };
  }

  if (checkId === 'availability') {
    return {
      sku: request.sku,
      quantity: request.quantity,
      requiredBy: request.requiredBy,
      supplierId: request.supplierId,
    };
  }

  return {
    supplierId: request.supplierId,
  };
}

/**
 * Reads one 402 response into a quote.
 *
 * Validates the payment requirements against our schema before trusting them.
 * A service could advertise a malformed requirement, or one for the wrong
 * network, and we would rather find out here than at settlement.
 *
 * @param checkId - which check this response came from
 * @param status - HTTP status returned
 * @param body - parsed response body
 * @returns the parsed quote
 * @throws AppError if the response is not a usable 402
 */
function parseChallenge(
  checkId: CheckId,
  status: number,
  body: unknown,
): QuoteWithIndex {
  if (status !== 402) {
    throw new AppError(
      ERROR_CODE.UPSTREAM_UNAVAILABLE,
      'The ' + checkId + ' service did not ask for payment',
      { detail: 'expected HTTP 402, received ' + String(status) },
    );
  }

  const challenge = body as Challenge402;
  const accepts = challenge.accepts;

  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new AppError(
      ERROR_CODE.UPSTREAM_UNAVAILABLE,
      'The ' + checkId + ' service returned no payment requirements',
    );
  }

  const parsed = paymentRequirementsSchema.safeParse(accepts[0]);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => issue.path.join('.') + ': ' + issue.message)
      .join('; ');

    throw new AppError(
      ERROR_CODE.UPSTREAM_UNAVAILABLE,
      'The ' + checkId + ' service returned malformed payment requirements',
      { detail },
    );
  }

  const requirements = parsed.data;

  // The service tells us which slot it wants to be paid from. We compare that
  // against our own constant. A mismatch means the deployment is inconsistent,
  // and building a group on top of it would fail at verification with a far
  // more confusing error.
  const declaredIndex = challenge.atomicAgent?.paymentIndex;
  const expectedIndex = PAYMENT_INDEX_BY_CHECK[checkId];

  if (typeof declaredIndex !== 'number') {
    throw new AppError(
      ERROR_CODE.UPSTREAM_UNAVAILABLE,
      'The ' + checkId + ' service did not declare its payment index',
      { detail: 'expected atomicAgent.paymentIndex in the 402 body' },
    );
  }

  if (declaredIndex !== expectedIndex) {
    throw new AppError(
      ERROR_CODE.GROUP_MALFORMED,
      'The ' + checkId + ' service expects a different slot than we assign',
      {
        detail:
          'service says index ' +
          String(declaredIndex) +
          ', orchestrator assigns ' +
          String(expectedIndex),
      },
    );
  }

  return {
    checkId,
    feeAtomic: requirements.amount,
    payTo: requirements.payTo,
    asset: requirements.asset,
    maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    declaredPaymentIndex: declaredIndex,
  };
}

/**
 * Collects a quote from one service.
 *
 * @param checkId - which check to quote
 * @param request - the buyer's sourcing request
 * @returns the parsed quote
 */
async function collectOne(
  checkId: CheckId,
  request: SourcingRequest,
): Promise<QuoteWithIndex> {
  const body = buildCheckBody(checkId, request);
  const response = await requestQuote(checkId, body);
  return parseChallenge(checkId, response.status, response.body);
}

/**
 * Collects all three quotes in parallel.
 *
 * Promise.all is deliberate over allSettled. If one service is down we cannot
 * build a group at all, so there is nothing useful to do with two out of three
 * quotes. Failing fast gives the user a clear message sooner.
 *
 * @param request - the buyer's sourcing request
 * @returns quotes in slot order, and their total
 * @throws AppError if any service fails to quote
 */
export async function collectQuotes(request: SourcingRequest): Promise<{
  quotes: QuoteWithIndex[];
  assets: string[];
}> {
  const startedAt = Date.now();

  logger.info({ sku: request.sku, supplierId: request.supplierId }, 'collecting quotes');

  const [price, availability, verification] = await Promise.all([
    collectOne('price', request),
    collectOne('availability', request),
    collectOne('verification', request),
  ]);

  const quotes = [price, availability, verification];

  // Every slot must be paid in the same asset. A group mixing two ASAs would
  // still settle atomically, but the totals we show the user would be
  // meaningless, and the buyer would need to hold both.
  const assets = [...new Set(quotes.map((quote) => quote.asset))];

  if (assets.length !== 1) {
    throw new AppError(
      ERROR_CODE.GROUP_MALFORMED,
      'The three services want payment in different assets',
      { detail: 'assets seen: ' + assets.join(', ') },
    );
  }

  logger.info(
    {
      ms: Date.now() - startedAt,
      asset: assets[0],
      fees: quotes.map((quote) => quote.feeAtomic),
    },
    'quotes collected',
  );

  return { quotes, assets };
}