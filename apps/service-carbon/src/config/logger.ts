/**
 * Structured logging.
 *
 * Pretty-printed in development, JSON in production so Railway can index it.
 */

import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.logLevel,
  base: { service: 'carbon' },
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          messageFormat: '[carbon] {msg}',
        },
      },
});