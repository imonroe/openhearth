import { describe, it, expect } from 'vitest';
import { SCREENSAVER_DEFAULT_TIMEOUT_MINUTES } from '@openhearth/shared';
import {
  resolveScreensaver,
  SCREENSAVER_LIST,
  DEFAULT_SCREENSAVER,
  SCREENSAVER_REGISTRY,
} from './screensavers';

describe('resolveScreensaver (#126)', () => {
  it('applies defaults when nothing is configured (enabled, default timeout/type)', () => {
    expect(resolveScreensaver(undefined)).toEqual({
      enabled: true,
      timeoutMinutes: SCREENSAVER_DEFAULT_TIMEOUT_MINUTES,
      type: DEFAULT_SCREENSAVER,
    });
  });

  it('respects explicit values', () => {
    expect(resolveScreensaver({ enabled: false, timeoutMinutes: 20, type: 'aurora' })).toEqual({
      enabled: false,
      timeoutMinutes: 20,
      type: 'aurora',
    });
  });

  it('keeps enabled=false distinct from unset', () => {
    expect(resolveScreensaver({ enabled: false }).enabled).toBe(false);
  });
});

describe('screensaver registry (#126)', () => {
  it('every listed saver has a component and matching id', () => {
    expect(SCREENSAVER_LIST.length).toBeGreaterThan(0);
    for (const def of SCREENSAVER_LIST) {
      expect(SCREENSAVER_REGISTRY[def.id]).toBe(def);
      expect(typeof def.Component).toBe('function');
      expect(def.label.length).toBeGreaterThan(0);
    }
  });
});
