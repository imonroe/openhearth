/**
 * Slideshow transition registry (#164).
 *
 * Maps each `SlideshowTransition` id (the shared, validated vocabulary) to its
 * display metadata and the CSS class applied to the *incoming* image layer. This
 * is the single extension point, mirroring the screensaver registry: adding a
 * transition means adding its id to `SLIDESHOW_TRANSITIONS` in shared and one
 * entry here — the Settings picker and the overlay both read from this map.
 *
 * Transitions are pure CSS (opacity / clip-path keyframes in `slideshow.css`),
 * so they run on the compositor with no main-thread or server work.
 */
import { SLIDESHOW_TRANSITIONS, type SlideshowTransition } from '@openhearth/shared';

export interface TransitionDef {
  id: SlideshowTransition;
  /** Human label shown in the Settings picker. */
  label: string;
  /** One-line description for the picker. */
  description: string;
  /**
   * Class applied to the incoming image layer. Empty for `cut` (no animation).
   * The class is defined in `slideshow.css` and drives the entrance keyframes.
   */
  enterClass: string;
  /** True when a previous layer must stay mounted beneath during the animation. */
  keepPrevious: boolean;
}

export const TRANSITION_REGISTRY: Record<SlideshowTransition, TransitionDef> = {
  cut: {
    id: 'cut',
    label: 'Cut',
    description: 'Instant change, no animation',
    enterClass: '',
    keepPrevious: false,
  },
  fade: {
    id: 'fade',
    label: 'Fade',
    description: 'Fade through black between images',
    enterClass: 'slideshow__image--fade',
    keepPrevious: false,
  },
  crossfade: {
    id: 'crossfade',
    label: 'Crossfade',
    description: 'Dissolve the next image over the current one',
    enterClass: 'slideshow__image--crossfade',
    keepPrevious: true,
  },
  wipe: {
    id: 'wipe',
    label: 'Wipe',
    description: 'Reveal the next image with a moving edge',
    enterClass: 'slideshow__image--wipe',
    keepPrevious: true,
  },
};

/** Ordered list for the Settings picker (registry order = SLIDESHOW_TRANSITIONS). */
export const TRANSITION_LIST: TransitionDef[] = SLIDESHOW_TRANSITIONS.map(
  (id) => TRANSITION_REGISTRY[id],
);

/** Resolve a (possibly unknown) transition id to its def, defaulting to crossfade. */
export function resolveTransition(id: SlideshowTransition | undefined): TransitionDef {
  return (id && TRANSITION_REGISTRY[id]) || TRANSITION_REGISTRY.crossfade;
}
