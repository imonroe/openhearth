import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest defaults. Each package extends this via `mergeConfig` in its
 * own `vitest.config.ts`. Today every package runs the `node` environment with
 * an empty override; the per-package config files exist as the extension point
 * for when, e.g., `web` needs a DOM environment for component tests.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    clearMocks: true,
  },
});
