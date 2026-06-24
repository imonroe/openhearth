import { describe, it, expect } from 'vitest';
import { DEFAULT_HOME_KEYS, DEFAULT_BACK_KEYS } from './reserved';

describe('reserved key defaults', () => {
  it('includes the physical Home key (and BrowserHome)', () => {
    expect(DEFAULT_HOME_KEYS).toContain('Home');
    expect(DEFAULT_HOME_KEYS).toContain('BrowserHome');
  });

  it('includes the default back keys', () => {
    expect(DEFAULT_BACK_KEYS).toContain('Backspace');
    expect(DEFAULT_BACK_KEYS).toContain('Escape');
  });
});
