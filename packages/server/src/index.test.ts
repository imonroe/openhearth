import { describe, it, expect } from 'vitest';
import { banner } from './index';

describe('@openhearth/server', () => {
  it('builds a banner from the shared project name', () => {
    expect(banner()).toBe('OpenHearth server');
  });
});
