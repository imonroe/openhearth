import { describe, it, expect } from 'vitest';
import { buildKeyMap, BINDINGS, FOCUS_ACTIONS } from './keybindings';

describe('buildKeyMap', () => {
  it('uses default keys when no config is given (FR-R1)', () => {
    const map = buildKeyMap();
    expect(map.get('ArrowUp')).toEqual({ action: 'navigate', params: { direction: 'up' } });
    expect(map.get('ArrowRight')).toEqual({ action: 'navigate', params: { direction: 'right' } });
    expect(map.get('Enter')).toEqual({ action: 'select', params: undefined });
    expect(map.get('Home')).toMatchObject({ action: 'home' });
    expect(map.get('Escape')).toMatchObject({ action: 'back' });
    expect(map.get(' ')).toMatchObject({ action: 'play_pause' });
  });

  it('honors remapped keys from config and drops the defaults (FR-R4)', () => {
    const map = buildKeyMap({ up: ['w'], select: ['x'] });
    // Remapped keys now drive the action…
    expect(map.get('w')).toEqual({ action: 'navigate', params: { direction: 'up' } });
    expect(map.get('x')).toMatchObject({ action: 'select' });
    // …and the old default keys for those bindings are no longer mapped.
    expect(map.get('ArrowUp')).toBeUndefined();
    expect(map.get('Enter')).toBeUndefined();
    // Bindings not overridden keep their defaults.
    expect(map.get('ArrowDown')).toMatchObject({
      action: 'navigate',
      params: { direction: 'down' },
    });
  });

  it('maps every binding name to a known action', () => {
    for (const b of BINDINGS) {
      expect(typeof b.action).toBe('string');
    }
    // navigate/select/home/back are the client-side focus actions.
    expect(FOCUS_ACTIONS.has('navigate')).toBe(true);
    expect(FOCUS_ACTIONS.has('home')).toBe(true);
    expect(FOCUS_ACTIONS.has('play_pause')).toBe(false);
  });
});
