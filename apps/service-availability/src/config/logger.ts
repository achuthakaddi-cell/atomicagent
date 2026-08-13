/**
 * Structured logging.
 *
 * Every log line carries the service name so the four processes can be read as
 * one stream during a demo.
 */

import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.logLevel,
  base: { service: 'service-availability' },
  // Pretty output in development; raw JSON in production for log aggregators.
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,service',
          messageFormat: '[avail] {msg}',
        },
      },
});