import { describe, it, expect } from 'vitest';
import { PROJECT_NAME } from './index';

describe('@openhearth/shared', () => {
  it('exposes the project name', () => {
    expect(PROJECT_NAME).toBe('OpenHearth');
  });
});
