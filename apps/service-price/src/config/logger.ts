/**
 * Structured logging.
 *
 * Every log line carries the service name so the four processes can be read as
 * one stream during a demo. Request logging attaches a request id, which the
 * orchestrator can quote back when something goes wrong.
 */

import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.logLevel,
  base: { service: 'service-price' },
  // Pretty output in development; raw JSON in production for log aggregators.
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,service',
          messageFormat: '[price] {msg}',
        },
      },
});