/**
 * Registering external x402 services.
 *
 *   POST /api/services/discover   probe a URL and read its 402 challenge
 *   GET  /api/services            list what is currently registered
 *   DELETE /api/services/:id      remove one
 *
 * WHAT THIS DEMONSTRATES
 * ----------------------
 * Everything the orchestrator knows about a registered service is read from
 * that service's own 402 response at runtime. No import, no config entry, no
 * code written for any particular provider.
 *
 * Once registered, the service occupies a real slot in the atomic group and its
 * verdict gates settlement exactly like the three built-in checks. A refusal
 * from a service we have never seen aborts the run.
 *
 * WHY REGISTRY STATE IS IN MEMORY
 * -------------------------------
 * The same reason run state is: this is a demonstration with a single
 * orchestrator instance and a defined demo window. A database would add
 * deployment surface and prove nothing about the protocol. In production this
 * is the one piece that would need to persist.
 */

import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { AppError } from '@atomicagent/shared';
import { ERROR_CODE } from '@atomicagent/shared';
import { ok } from '@atomicagent/shared';
import { RESERVED_SLOTS, MAX_EXTERNAL_SERVICES } from '@atomicagent/shared';
import type { DiscoveredService } from '@atomicagent/shared';
import { discoverService } from '../agent/serviceDiscovery.js';
import { asyncRoute } from '../middleware/errorHandler.js';
import { quoteLimiter } from '../middleware/rateLimit.js';
import { logger } from '../config/logger.js';

/**
 * Explicit type annotation required.
 *
 * With `declaration: true`, TypeScript must write a .d.ts entry for this
 * export. Router() infers a type from @types/express-serve-static-core, a
 * transitive dependency pnpm nests inside .pnpm/ (error TS2742).
 */
export const servicesRouter: ExpressRouter = Router();

/**
 * Registered external services, in registration order.
 *
 * Order matters: it determines slot assignment, and a service's slot must not
 * change once a group has been built around it.
 */
const registry = new Map<string, DiscoveredService>();

const discoverBodySchema = z.object({
  url: z.string().trim().min(8).max(512),
});

/**
 * The slot the next registered service would occupy.
 *
 * Slots 0 to 4 are the fee payer, the three built-in checks, and the order
 * payment. External services start at 5.
 *
 * @returns the next available slot index
 */
function nextSlot(): number {
  return RESERVED_SLOTS + registry.size;
}

/**
 * Everything currently registered, in slot order.
 *
 * @returns registered services
 */
export function registeredServices(): DiscoveredService[] {
  return [...registry.values()].sort((a, b) => a.paymentIndex - b.paymentIndex);
}

/**
 * Clears the registry.
 *
 * Exposed for tests and for the demo reset button, so a presenter can register
 * a service, show it working, and start clean without redeploying.
 */
export function clearRegistry(): void {
  registry.clear();
}

/**
 * POST /api/services/discover
 *
 * Probes a URL, reads its 402 challenge, and registers it if it can join the
 * group. Every rejection carries a reason a person can act on.
 */
servicesRouter.post(
  '/discover',
  quoteLimiter,
  asyncRoute(async (req, res) => {
    const body = discoverBodySchema.parse(req.body);

    // Already registered? Return what we have rather than probing again and
    // handing out a second slot for the same service.
    const existing = [...registry.values()].find(
      (service) => service.url === body.url,
    );

    if (existing) {
      res.status(200).json(
        ok({
          ok: true,
          service: existing,
          failure: null,
          message:
            'Already registered at slot ' + String(existing.paymentIndex) + '.',
          registered: registeredServices(),
        }),
      );
      return;
    }

    const slot = nextSlot();
    const result = await discoverService(body.url, slot);

    if (result.ok && result.service) {
      registry.set(result.service.id, result.service);

      logger.info(
        {
          url: body.url,
          slot,
          registered: registry.size,
        },
        'external service joined the atomic group',
      );
    }

    res.status(result.ok ? 200 : 200).json(
      ok({
        ...result,
        registered: registeredServices(),
        slotsRemaining: MAX_EXTERNAL_SERVICES - registry.size,
      }),
    );
  }),
);

/**
 * GET /api/services
 *
 * What is registered, and how much room is left in the group.
 */
servicesRouter.get('/', (_req, res) => {
  res.status(200).json(
    ok({
      registered: registeredServices(),
      slotsUsed: RESERVED_SLOTS + registry.size,
      slotsRemaining: MAX_EXTERNAL_SERVICES - registry.size,
      maxExternal: MAX_EXTERNAL_SERVICES,
    }),
  );
});

/**
 * DELETE /api/services/:id
 *
 * Removes a service and re-slots the rest.
 *
 * Re-slotting matters: leaving a gap would mean building a group with an empty
 * index, and Algorand groups are contiguous.
 */
servicesRouter.delete(
  '/:id',
  asyncRoute(async (req) => {
    const id = String(req.params.id ?? '');

    if (!registry.has(id)) {
      throw new AppError(
        ERROR_CODE.VALIDATION_FAILED,
        'No service registered with that id',
        { detail: id },
      );
    }

    registry.delete(id);

    // Reassign slots so they stay contiguous from RESERVED_SLOTS upward.
    const remaining = registeredServices();
    registry.clear();

    remaining.forEach((service, index) => {
      registry.set(service.id, {
        ...service,
        paymentIndex: RESERVED_SLOTS + index,
      });
    });

    return Promise.resolve();
  }),
);

/**
 * POST /api/services/reset
 *
 * Clears everything. For the demo, so a presenter can start clean.
 */
servicesRouter.post('/reset', (_req, res) => {
  const count = registry.size;
  registry.clear();

  logger.info({ cleared: count }, 'service registry reset');

  res.status(200).json(ok({ cleared: count, registered: [] }));
});