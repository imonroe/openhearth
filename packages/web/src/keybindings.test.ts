import { describe, it, expect } from 'vitest';
import { buildKeyMap, resolveKeyBindings, BINDINGS, FOCUS_ACTIONS } from './keybindings';

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

  it('exposes every action in the vocabulary as bindable (stop included)', () => {
    expect(BINDINGS.some((b) => b.action === 'stop')).toBe(true);
    // `stop` has no default key but is configurable.
    expect(buildKeyMap({ stop: ['x'] }).get('x')).toMatchObject({ action: 'stop' });
    expect(buildKeyMap().get('x')).toBeUndefined();
  });
});

describe('resolveKeyBindings — reserved protection (#46, FR-A3)', () => {
  it('always keeps the reserved Home/Back default keys, adding configured ones', () => {
    const { keyMap } = resolveKeyBindings({ home: ['h'], back: ['z'] });
    // Defaults retained…
    expect(keyMap.get('Home')).toMatchObject({ action: 'home' });
    expect(keyMap.get('BrowserHome')).toMatchObject({ action: 'home' });
    expect(keyMap.get('Escape')).toMatchObject({ action: 'back' });
    // …plus the user's extra keys.
    expect(keyMap.get('h')).toMatchObject({ action: 'home' });
    expect(keyMap.get('z')).toMatchObject({ action: 'back' });
  });

  it('cannot unbind a reserved binding (empty config keeps defaults, with a warning)', () => {
    const { keyMap, warnings } = resolveKeyBindings({ home: [] });
    expect(keyMap.get('Home')).toMatchObject({ action: 'home' });
    expect(warnings.some((w) => /reserved/.test(w))).toBe(true);
  });

  it('a non-reserved binding cannot steal a reserved key', () => {
    const { keyMap, warnings } = resolveKeyBindings({ play_pause: ['Home'] });
    expect(keyMap.get('Home')).toMatchObject({ action: 'home' }); // reserved wins
    expect(warnings.some((w) => w.includes('Home') && w.includes('home'))).toBe(true);
  });

  it("a reserved binding's added key cannot capture another reserved binding's default", () => {
    // Escape is one of `back`'s default keys; adding it to `home` must not steal it.
    const { keyMap, warnings } = resolveKeyBindings({ home: ['Escape'] });
    expect(keyMap.get('Escape')).toMatchObject({ action: 'back' }); // back keeps Escape
    expect(keyMap.get('Backspace')).toMatchObject({ action: 'back' }); // and its other defaults
    expect(keyMap.get('Home')).toMatchObject({ action: 'home' }); // home keeps its own
    expect(warnings.some((w) => w.includes('Escape'))).toBe(true);
  });
});

describe('resolveKeyBindings — validation warnings (#46)', () => {
  it('warns on an unknown binding name', () => {
    const { warnings } = resolveKeyBindings({ teleport: ['t'] });
    expect(warnings.some((w) => w.includes('teleport'))).toBe(true);
  });

  it('warns when two bindings claim the same key and keeps the first', () => {
    const { keyMap, warnings } = resolveKeyBindings({ up: ['k'], down: ['k'] });
    expect(keyMap.get('k')).toMatchObject({ params: { direction: 'up' } }); // first wins
    expect(warnings.some((w) => w.includes('"k"'))).toBe(true);
  });

  it('clean defaults produce no warnings', () => {
    expect(resolveKeyBindings().warnings).toEqual([]);
  });
});
