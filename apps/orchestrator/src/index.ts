/**
 * Orchestrator entry point.
 *
 * Startup order matters: facilitator capabilities must load BEFORE the server
 * accepts requests, because the fee payer address is needed to build slot 0 of
 * every group. Serving traffic without it would fail on the first quote.
 */

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ERROR_CODE } from '@atomicagent/shared';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { loadFacilitatorCapabilities } from './config/facilitator.js';
import { facilitatorStatus } from './config/facilitator.js';
import { runsRouter } from './routes/runs.js';
import { runCount } from './agent/runStore.js';
import { pingServices } from './clients/serviceClient.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/errorHandler.js';

const app = express();

// Railway and Render sit behind a proxy. Without this, express-rate-limit sees
// every request as coming from the proxy IP and rate-limits all users as one.
app.set('trust proxy', 1);

app.use(helmet());

app.use(
  cors({
    origin: env.corsOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  }),
);

// Signed transaction groups are larger than typical JSON, so the cap is higher
// here than on the three services.
app.use(express.json({ limit: '256kb' }));

/**
 * Body-parser error trap.
 *
 * express.json() throws a SyntaxError on malformed JSON. Left alone that
 * surfaces as a 500, which wrongly implies our service is broken when the
 * client simply sent bad data.
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

/**
 * Health probe.
 *
 * Reports downstream service reachability too, so one call tells you whether
 * the whole system is ready rather than just this process.
 */
app.get('/health', (_req, res) => {
  void (async () => {
    const services = await pingServices();
    const facilitator = facilitatorStatus();

    const allReachable =
      services.price.reachable &&
      services.availability.reachable &&
      services.verification.reachable;

    res.status(200).json({
      ok: true,
      data: {
        service: 'orchestrator',
        status: allReachable && facilitator ? 'healthy' : 'degraded',
        network: env.network,
        facilitator: facilitator
          ? { feePayer: facilitator.feePayer, ageMs: facilitator.ageMs }
          : null,
        asset: env.asset,
        supplierAddress: env.supplierAddress,
        activeRuns: runCount(),
        services,
      },
    });
  })();
});

app.use('/api/runs', runsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Boots the orchestrator.
 *
 * Facilitator capabilities load first. If that fails entirely we still start,
 * using the known fallback fee payer, because a venue network hiccup should not
 * stop the service from running.
 */
async function start(): Promise<void> {
  const feePayer = await loadFacilitatorCapabilities();

  const services = await pingServices();

  for (const [checkId, ping] of Object.entries(services)) {
    if (!ping.reachable) {
      logger.warn(
        { checkId, detail: ping.detail },
        'downstream service is not reachable at startup',
      );
    }
  }

  // 0.0.0.0 rather than the default localhost. A container that binds only to
  // localhost is unreachable from outside itself, which presents as a service
  // that starts cleanly and then fails every health check.
  const server = app.listen(env.port, '0.0.0.0', () => {
    logger.info(
      {
        port: env.port,
        feePayer,
        supplier: env.supplierAddress,
        asset: env.asset.id,
        services: env.services,
      },
      'orchestrator listening on http://localhost:' + String(env.port),
    );
  });

  /**
   * Graceful shutdown.
   *
   * Without this, a redeploy kills in-flight requests and the client sees a
   * connection reset rather than a clean error.
   */
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      logger.info('closed cleanly');
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn('forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((cause: unknown) => {
  logger.fatal({ cause }, 'orchestrator failed to start');
  process.exit(1);
});