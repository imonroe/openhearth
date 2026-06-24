// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for the OpenHearth workspace.
 *
 * The most important rule here is the **seam boundary**: `web` must never
 * import from `server`, and `server` must never import from `web`. Both may
 * import from `shared`. This is enforced below with `no-restricted-imports`
 * patterns scoped per package. TypeScript project references make the
 * cross-import fail to resolve as well; the lint rule makes the intent
 * explicit and the failure obvious.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.js', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Brain → must not import the Face.
  {
    files: ['packages/server/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@openhearth/web', '@openhearth/web/*', '**/packages/web/*'],
              message:
                'Seam violation: server (brain) must not import from web (face). Communicate via the shared protocol only.',
            },
          ],
        },
      ],
    },
  },
  // Face → must not import the Brain.
  {
    files: ['packages/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@openhearth/server', '@openhearth/server/*', '**/packages/server/*'],
              message:
                'Seam violation: web (face) must not import from server (brain). It is a pure client of the HTTP/WS API.',
            },
          ],
        },
      ],
    },
  },
);
