import { mergeConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import base from '../../vitest.config.base';

// Web tests run in jsdom (DOM + React Testing Library) and need the React
// plugin to transform JSX/TSX.
export default mergeConfig(base, {
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
