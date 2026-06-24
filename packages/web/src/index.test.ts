import { describe, it, expect } from 'vitest';
import { appTitle } from './index';

describe('@openhearth/web', () => {
  it('derives the app title from the shared project name', () => {
    expect(appTitle()).toBe('OpenHearth');
  });
});
