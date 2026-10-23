import { describe, it, expect } from 'vitest';
import { SLIDESHOW_TRANSITIONS } from '@openhearth/shared';
import { TRANSITION_REGISTRY, TRANSITION_LIST, resolveTransition } from './transitions';

describe('slideshow transition registry (#164)', () => {
  it('has an entry for every shared transition id', () => {
    for (const id of SLIDESHOW_TRANSITIONS) {
      expect(TRANSITION_REGISTRY[id]?.id).toBe(id);
    }
    expect(TRANSITION_LIST.map((t) => t.id)).toEqual([...SLIDESHOW_TRANSITIONS]);
  });

  it('cut has no entrance class; crossfade/wipe keep the previous layer', () => {
    expect(TRANSITION_REGISTRY.cut.enterClass).toBe('');
    expect(TRANSITION_REGISTRY.crossfade.keepPrevious).toBe(true);
    expect(TRANSITION_REGISTRY.wipe.keepPrevious).toBe(true);
    expect(TRANSITION_REGISTRY.fade.keepPrevious).toBe(false);
  });

  it('resolveTransition falls back to crossfade for an unknown id', () => {
    expect(resolveTransition(undefined).id).toBe('crossfade');
    // @ts-expect-error — exercising the runtime fallback for a bad value
    expect(resolveTransition('bogus').id).toBe('crossfade');
  });
});
