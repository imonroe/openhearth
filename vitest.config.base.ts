import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest defaults. Each package extends this via `mergeConfig` in its
 * own `vitest.config.ts`, overriding only what it needs (e.g. `web` swaps in a
 * DOM environment once it has component tests).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    clearMocks: true,
  },
});
