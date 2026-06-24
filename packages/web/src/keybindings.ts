/**
 * Keyboard → action mapping (FR-R1 / FR-R4).
 *
 * Physical keys map onto the client-agnostic action vocabulary — exactly what a
 * phone remote would send (no keyboard-specific actions). The logical binding
 * names match `keybindings` in the config; each resolves to an action (+params).
 * Config supplies the physical keys per binding; unspecified bindings fall back
 * to the defaults here.
 */
import type { ActionName } from '@openhearth/shared';
import { DEFAULT_HOME_KEYS, DEFAULT_BACK_KEYS } from './reserved';

export interface BoundAction {
  action: ActionName;
  params?: Record<string, unknown>;
}

interface BindingDef extends BoundAction {
  /** Logical binding name (matches config `keybindings` keys). */
  name: string;
  /** Physical keys used when config doesn't override this binding. */
  defaultKeys: readonly string[];
}

/** The canonical bindings and their default physical keys. */
export const BINDINGS: readonly BindingDef[] = [
  { name: 'up', action: 'navigate', params: { direction: 'up' }, defaultKeys: ['ArrowUp'] },
  { name: 'down', action: 'navigate', params: { direction: 'down' }, defaultKeys: ['ArrowDown'] },
  { name: 'left', action: 'navigate', params: { direction: 'left' }, defaultKeys: ['ArrowLeft'] },
  {
    name: 'right',
    action: 'navigate',
    params: { direction: 'right' },
    defaultKeys: ['ArrowRight'],
  },
  { name: 'select', action: 'select', defaultKeys: ['Enter'] },
  // `home`/`back` are reserved (FR-A3); defaults come from reserved.ts.
  { name: 'home', action: 'home', defaultKeys: DEFAULT_HOME_KEYS },
  { name: 'back', action: 'back', defaultKeys: DEFAULT_BACK_KEYS },
  { name: 'play_pause', action: 'play_pause', defaultKeys: [' '] },
];

export type KeyMap = Map<string, BoundAction>;

/**
 * Build a `physicalKey → action` map from the configured keybindings. Each
 * binding uses its configured keys, or its defaults when unspecified. Later
 * bindings win if two map the same key (deterministic: BINDINGS order).
 */
export function buildKeyMap(keybindings?: Record<string, readonly string[]>): KeyMap {
  const map: KeyMap = new Map();
  for (const binding of BINDINGS) {
    const keys = keybindings?.[binding.name] ?? binding.defaultKeys;
    for (const key of keys) {
      map.set(key, { action: binding.action, params: binding.params });
    }
  }
  return map;
}

/** Actions handled by the local focus engine (not sent to the server). */
export const FOCUS_ACTIONS: ReadonlySet<ActionName> = new Set([
  'navigate',
  'select',
  'home',
  'back',
]);
