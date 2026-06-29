/**
 * Screensaver registry (#126).
 *
 * Maps each `ScreensaverType` id (the shared, validated vocabulary) to its
 * display metadata and React component. This is the single extension point:
 * adding a saver means adding its id to `SCREENSAVERS` in shared and one entry
 * here — the Settings picker and the runtime both read from this map.
 */
import {
  SCREENSAVERS,
  SCREENSAVER_DEFAULT_TIMEOUT_MINUTES,
  type ScreensaverConfig,
  type ScreensaverType,
} from '@openhearth/shared';
import type { ReactNode } from 'react';
import { AuroraScreensaver } from './AuroraScreensaver';

export interface ScreensaverDef {
  id: ScreensaverType;
  /** Human label shown in the Settings picker. */
  label: string;
  /** One-line description for the picker. */
  description: string;
  Component: () => ReactNode;
}

export const SCREENSAVER_REGISTRY: Record<ScreensaverType, ScreensaverDef> = {
  aurora: {
    id: 'aurora',
    label: 'Aurora',
    description: 'Slow drifting colour fields',
    Component: AuroraScreensaver,
  },
};

/**
 * Ordered list of savers for the Settings picker (registry order = SCREENSAVERS
 * order). `SCREENSAVER_REGISTRY` is typed `Record<ScreensaverType, …>`, so adding
 * an id to `SCREENSAVERS` in shared without a matching entry here is a *compile*
 * error — the picker can never map to an `undefined` saver.
 */
export const SCREENSAVER_LIST: ScreensaverDef[] = SCREENSAVERS.map(
  (id) => SCREENSAVER_REGISTRY[id],
);

/** The default saver id (first registered). */
export const DEFAULT_SCREENSAVER: ScreensaverType = SCREENSAVERS[0];

export interface ResolvedScreensaver {
  enabled: boolean;
  timeoutMinutes: number;
  type: ScreensaverType;
}

/**
 * Apply defaults to a (possibly absent) screensaver config: on by default, with
 * the default timeout and saver. An unknown `type` (shouldn't happen — shared
 * validates it) falls back to the default so the runtime never renders nothing.
 */
export function resolveScreensaver(config: ScreensaverConfig | undefined): ResolvedScreensaver {
  const type = config?.type;
  return {
    enabled: config?.enabled ?? true,
    timeoutMinutes: config?.timeoutMinutes ?? SCREENSAVER_DEFAULT_TIMEOUT_MINUTES,
    type: type && type in SCREENSAVER_REGISTRY ? type : DEFAULT_SCREENSAVER,
  };
}
