/**
 * Availability microservice entry point.
 *
 * Middleware order matters and is deliberate:
 *   1. helmet        security headers before anything else runs
 *   2. cors          reject disallowed origins early
 *   3. json parser   with a size cap
 *   4. json trap     turn malformed bodies into 400, not 500
 *   5. rate limit    before any real work happens
 *   6. routes
 *   7. 404 handler
 *   8. error handler LAST, or Express will not use it
 */

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ERROR_CODE } from '@atomicagent/shared';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { checkRouter } from './routes/check.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

// Railway and Render sit behind a proxy. Without this, express-rate-limit sees
// every request as coming from the proxy IP and rate-limits all users as one.
app.set('trust proxy', 1);

app.use(helmet());

app.use(
  cors({
    origin: env.corsOrigins,
    methods: ['GET', 'POST'],
    // X-PAYMENT is a custom header, so it must be explicitly allowed or the
    // browser preflight will strip it and every paid request will 402 forever.
    allowedHeaders: ['Content-Type', 'X-PAYMENT'],
    exposedHeaders: ['X-PAYMENT-RESPONSE'],
    maxAge: 600,
  }),
);

app.use(express.json({ limit: '64kb' }));

/**
 * Body-parser error trap.
 *
 * express.json() throws a SyntaxError on malformed JSON. Left alone that
 * surfaces as a 500, which wrongly implies our service is broken when the
 * client simply sent bad data. A client error deserves a 4xx.
 */
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    logger.warn({ err: err.message }, 'malformed JSON body rejected');
    res.status(400).json({
      ok: false,
      code: ERROR_CODE.VALIDATION_FAILED,
      message: 'Request body is not valid JSON',
    });
    return;
  }
  next(err);
});

app.use(globalLimiter);

/** Liveness probe. Deployment platforms poll this; keep it cheap and unguarded. */
app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    data: {
      service: 'service-availability',
      status: 'healthy',
      network: env.network,
      payTo: env.payTo,
      asset: env.asset,
      feeAtomic: env.feeAtomic,
      paymentIndex: 2,
    },
  });
});

app.use('/check', checkRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.port, () => {
  logger.info(
    {
      port: env.port,
      payTo: env.payTo,
      asset: env.asset.id,
      fee: env.feeAtomic,
      facilitator: env.facilitatorUrl,
    },
    `availability service listening on http://localhost:${env.port}`,
  );
});

/**
 * Graceful shutdown.
 *
 * Without this, a redeploy kills in-flight requests mid-verification and the
 * client sees a connection reset rather than a clean error.
 */
function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    logger.info('closed cleanly');
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));