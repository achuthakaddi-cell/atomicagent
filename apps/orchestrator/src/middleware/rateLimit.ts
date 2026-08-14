/**
 * Rate limiting.
 *
 * Settlement gets the tightest budget of all. It is the only operation that
 * spends money, and it hits both the facilitator and the Algorand network.
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

/** Applies to every route. */
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

/** Quote collection: three downstream calls plus an algod lookup. */
export const quoteLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: Math.max(10, Math.floor(env.rateLimit.max / 3)),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitBody,
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip }, 'quote rate limit exceeded');
    res.status(options.statusCode).json(limitBody);
  },
});

/** Settlement: the only operation that moves money. Tightest budget. */
export const settleLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: Math.max(5, Math.floor(env.rateLimit.max / 10)),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitBody,
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip }, 'settle rate limit exceeded');
    res.status(options.statusCode).json(limitBody);
  },
});