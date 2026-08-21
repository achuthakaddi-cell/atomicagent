/**
 * Rate limiting for the x402-gated endpoint.
 *
 * The 402 challenge is free to request, which makes it a cheap thing to hammer.
 * Verification is far more expensive — it decodes a transaction group and asks
 * the facilitator to simulate it on chain. So the two get different budgets.
 */

import rateLimit from 'express-rate-limit';
import { ERROR_CODE } from '@atomicagent/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/** Body returned when a limit is hit. Same shape as every other error. */
const limitBody = {
  ok: false,
  code: ERROR_CODE.RATE_LIMITED,
  message: 'Too many requests. Please wait a moment and try again.',
};

/** Applies to every route on this service. */
export const globalLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitBody,
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip, path: req.path }, 'rate limit exceeded');
    res.status(options.statusCode).json(limitBody);
  },
});

/**
 * Tighter limit on the paid check endpoint.
 *
 * A quarter of the global budget: verification costs us a facilitator call and
 * an on-chain simulation, so it deserves a stricter ceiling than a plain GET.
 */
export const checkLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: Math.max(10, Math.floor(env.rateLimit.max / 4)),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitBody,
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip, path: req.path }, 'check rate limit exceeded');
    res.status(options.statusCode).json(limitBody);
  },
});