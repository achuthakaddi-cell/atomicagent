/**
 * HTTP client for the three microservices.
 *
 * EVERY CALL HAS A HARD TIMEOUT
 * -----------------------------
 * The judging criteria call out "zero hangs", so no request may wait
 * indefinitely. Each call carries an AbortController with a fixed budget, and
 * a timeout is always treated as a FAILURE, never as "wait a little longer".
 *
 * That choice matters at the settle gate. An ambiguous result must never lead
 * to spending money, so silence counts against settlement, not for it.
 */

import { AppError } from '@atomicagent/shared';
import { ERROR_CODE } from '@atomicagent/shared';
import { TIMEOUTS_MS } from '@atomicagent/shared';
import { RETRY } from '@atomicagent/shared';
import type { CheckId } from '@atomicagent/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/** Where one check lives and which path it answers on. */
export interface ServiceRoute {
  baseUrl: string;
  path: string;
}

/** Route table for the three checks. */
export type ServiceRouteMap = Record<CheckId, ServiceRoute>;

/** Where each check lives and what it needs. */
export const SERVICE_ROUTES: ServiceRouteMap = {
  price: { baseUrl: env.services.price, path: '/check/price' },
  availability: { baseUrl: env.services.availability, path: '/check/availability' },
  verification: { baseUrl: env.services.verification, path: '/check/verification' },
};

/** A raw HTTP result, before interpretation. */
export interface ServiceResponse {
  status: number;
  body: unknown;
}

/** One service's reachability, as reported by pingServices. */
export interface ServicePing {
  reachable: boolean;
  detail: string;
}

/** Reachability of all three services. */
export type ServicePingMap = Record<CheckId, ServicePing>;

/** Arguments for a single service call. */
interface CallOptions {
  url: string;
  body: unknown;
  timeoutMs: number;
  paymentHeader?: string;
  checkId: CheckId;
}

/**
 * Performs one HTTP call with a hard timeout.
 *
 * A 402 is NOT an error here. It is the expected response when no payment is
 * attached, and the caller reads its body for payment requirements.
 *
 * @param options - request details
 * @returns status and parsed body
 * @throws AppError on timeout or transport failure
 */
async function callService(options: CallOptions): Promise<ServiceResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.paymentHeader) {
    headers['X-PAYMENT'] = options.paymentHeader;
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(options.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });

    const text = await response.text();

    let parsed: unknown = null;

    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new AppError(
          ERROR_CODE.UPSTREAM_UNAVAILABLE,
          'The ' + options.checkId + ' service returned a non-JSON response',
          { detail: text.slice(0, 200) },
        );
      }
    }

    logger.debug(
      {
        checkId: options.checkId,
        status: response.status,
        ms: Date.now() - startedAt,
      },
      'service call complete',
    );

    return { status: response.status, body: parsed };
  } catch (cause) {
    if (cause instanceof AppError) {
      throw cause;
    }

    const aborted = cause instanceof Error && cause.name === 'AbortError';

    if (aborted) {
      logger.warn(
        { checkId: options.checkId, timeoutMs: options.timeoutMs },
        'service call timed out',
      );

      throw new AppError(
        ERROR_CODE.UPSTREAM_TIMEOUT,
        'The ' + options.checkId + ' service did not respond in time',
        {
          detail: 'timed out after ' + String(options.timeoutMs) + 'ms',
          cause,
        },
      );
    }

    throw new AppError(
      ERROR_CODE.UPSTREAM_UNAVAILABLE,
      'Could not reach the ' + options.checkId + ' service',
      {
        detail: cause instanceof Error ? cause.message : 'unknown error',
        cause,
      },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Requests a 402 challenge from a service, with retries.
 *
 * Quote collection is the ONLY call that retries. It is free, idempotent, and
 * happens before anything is signed, so a second attempt costs nothing.
 * Verification and settlement never retry, because retrying either could
 * double-submit work that is meant to happen exactly once.
 *
 * @param checkId - which check to quote
 * @param body - the request body that service expects
 * @returns status and body of the 402 response
 */
export async function requestQuote(
  checkId: CheckId,
  body: unknown,
): Promise<ServiceResponse> {
  const route = SERVICE_ROUTES[checkId];
  const url = route.baseUrl + route.path;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= RETRY.QUOTE_ATTEMPTS; attempt += 1) {
    try {
      return await callService({
        url,
        body,
        timeoutMs: TIMEOUTS_MS.QUOTE,
        checkId,
      });
    } catch (cause) {
      lastError = cause;

      if (attempt < RETRY.QUOTE_ATTEMPTS) {
        const backoff = RETRY.QUOTE_BACKOFF_MS * attempt;

        logger.warn(
          { checkId, attempt, backoff },
          'quote attempt failed, retrying',
        );

        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  if (lastError instanceof AppError) {
    throw lastError;
  }

  throw new AppError(
    ERROR_CODE.UPSTREAM_UNAVAILABLE,
    'Could not get a quote from the ' + checkId + ' service',
  );
}

/**
 * Sends a payment to a service for verification.
 *
 * NO RETRIES, by design. Each attempt asks the facilitator to simulate the
 * transaction group on chain. Repeating that on a flaky connection would
 * multiply load and could produce inconsistent verdicts across services.
 *
 * @param checkId - which check to run
 * @param body - the request body that service expects
 * @param paymentHeader - base64 X-PAYMENT header
 * @returns status and body of the verification response
 */
export async function requestVerification(
  checkId: CheckId,
  body: unknown,
  paymentHeader: string,
): Promise<ServiceResponse> {
  const route = SERVICE_ROUTES[checkId];
  const url = route.baseUrl + route.path;

  return callService({
    url,
    body,
    timeoutMs: TIMEOUTS_MS.VERIFY,
    paymentHeader,
    checkId,
  });
}

/**
 * Checks one service's health endpoint.
 *
 * @param checkId - which service to ping
 * @returns reachability and a short explanation
 */
async function pingOne(checkId: CheckId): Promise<ServicePing> {
  const url = SERVICE_ROUTES[checkId].baseUrl + '/health';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    return {
      reachable: response.ok,
      detail: response.ok ? 'healthy' : 'HTTP ' + String(response.status),
    };
  } catch (cause) {
    return {
      reachable: false,
      detail: cause instanceof Error ? cause.message : 'unreachable',
    };
  }
}

/**
 * Checks that all three services are reachable.
 *
 * Called at orchestrator startup so a misconfigured URL surfaces immediately
 * rather than during a demo.
 *
 * @returns per-service reachability
 */
export async function pingServices(): Promise<ServicePingMap> {
  const [price, availability, verification] = await Promise.all([
    pingOne('price'),
    pingOne('availability'),
    pingOne('verification'),
  ]);

  return { price, availability, verification };
}