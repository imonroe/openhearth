import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees between tests so the window keydown listener installed by
// FocusProvider doesn't leak across cases.
afterEach(() => {
  cleanup();
});
