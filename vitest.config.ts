/**
 * Test configuration.
 *
 * WHAT IS TESTED AND WHAT IS NOT
 * ------------------------------
 * These tests cover pure logic: group assembly, escalation decisions, payment
 * validation, service discovery. They deliberately do NOT test the facilitator,
 * the chain, or the wallet.
 *
 * That is not a gap. Those three are external systems, and a test that mocks
 * them proves only that the mock behaves as written. The evidence that they
 * work is the settled transaction group on the explorer, which is a stronger
 * claim than any assertion here could make.
 *
 * What these tests do prove is that the decisions leading up to a settlement
 * are correct — that a group is assembled in the right order with the right
 * amounts, that the agent escalates only when its own rules say it should, and
 * that a service refuses a payment pointed at the wrong slot.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      include: [
        'packages/shared/src/**/*.ts',
        'apps/orchestrator/src/agent/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});