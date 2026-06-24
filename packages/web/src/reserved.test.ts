import { describe, it, expect } from 'vitest';
import { isHomeKey, isBackKey, DEFAULT_HOME_KEYS, DEFAULT_BACK_KEYS } from './reserved';

describe('reserved keys', () => {
  it('recognizes the default home keys', () => {
    expect(isHomeKey('Home')).toBe(true);
    expect(isHomeKey('BrowserHome')).toBe(true);
    expect(isHomeKey('a')).toBe(false);
    expect(DEFAULT_HOME_KEYS).toContain('Home');
  });

  it('recognizes the default back keys', () => {
    expect(isBackKey('Backspace')).toBe(true);
    expect(isBackKey('Escape')).toBe(true);
    expect(isBackKey('Enter')).toBe(false);
    expect(DEFAULT_BACK_KEYS).toContain('Escape');
  });

  it('accepts a custom key set', () => {
    expect(isHomeKey('h', ['h'])).toBe(true);
    expect(isHomeKey('Home', ['h'])).toBe(false);
  });
});
