/**
 * Keyboard → action mapping (FR-R1 / FR-R4 / #46).
 *
 * Physical keys map onto the client-agnostic action vocabulary — exactly what a
 * phone remote would send (no keyboard-specific actions). The logical binding
 * names match `keybindings` in the config; each resolves to an action (+params).
 * Config supplies the physical keys per binding; unspecified bindings fall back
 * to the defaults here.
 *
 * Two invariants the resolver enforces (#46):
 *  - **Reserved Home/Back are protected** (FR-A3 / NFR-5): their default keys are
 *    always honored — config can *add* keys but can never remove the defaults or
 *    reassign them to another action — so Home/Back can't be configured into
 *    uselessness.
 *  - **Conflicts and unknown bindings are reported** (not silently dropped): the
 *    first binding (in declaration order) to claim a key keeps it, reserved
 *    bindings claim theirs first, and every collision / unknown name yields a
 *    warning the UI can surface.
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
  /** Reserved bindings (home/back) always retain their default keys. */
  reserved?: boolean;
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
  // `home`/`back` are reserved (FR-A3); defaults come from reserved.ts and are
  // always retained even when the user adds their own keys.
  { name: 'home', action: 'home', defaultKeys: DEFAULT_HOME_KEYS, reserved: true },
  { name: 'back', action: 'back', defaultKeys: DEFAULT_BACK_KEYS, reserved: true },
  { name: 'play_pause', action: 'play_pause', defaultKeys: [' '] },
  // `stop` is bindable but has no default key (Back already exits the player);
  // a user can map a dedicated stop key in config.
  { name: 'stop', action: 'stop', defaultKeys: [] },
];

const BINDING_NAMES: ReadonlySet<string> = new Set(BINDINGS.map((b) => b.name));

export type KeyMap = Map<string, BoundAction>;

export interface ResolvedKeyBindings {
  keyMap: KeyMap;
  /** Non-fatal problems (conflicts, unknown names, attempts to unbind reserved). */
  warnings: string[];
}

/** Resolve the physical keys for a binding from config, with reserved protection. */
function keysFor(binding: BindingDef, configured: readonly string[] | undefined): string[] {
  if (binding.reserved) {
    // Defaults are always present; the user's keys are added on top (deduped).
    return [...new Set([...binding.defaultKeys, ...(configured ?? [])])];
  }
  return [...(configured ?? binding.defaultKeys)];
}

/**
 * Resolve `keybindings` config into a `physicalKey → action` map plus a list of
 * warnings. Reserved bindings are assigned first (so their keys can't be stolen),
 * then the rest in declaration order; the first claimant of a key keeps it and
 * any later collision is reported.
 */
export function resolveKeyBindings(
  keybindings?: Record<string, readonly string[]>,
): ResolvedKeyBindings {
  const map: KeyMap = new Map();
  const owner = new Map<string, string>(); // key → owning binding name
  const warnings: string[] = [];

  // Unknown config binding names can't take effect — surface them.
  for (const name of Object.keys(keybindings ?? {})) {
    if (!BINDING_NAMES.has(name)) {
      warnings.push(`Unknown keybinding "${name}" in config was ignored.`);
    }
  }

  // Reserved first, then the rest — both in BINDINGS declaration order.
  const ordered = [...BINDINGS].sort((a, b) => Number(!!b.reserved) - Number(!!a.reserved));
  for (const binding of ordered) {
    const configured = keybindings?.[binding.name];
    if (binding.reserved && configured && configured.length === 0) {
      warnings.push(`"${binding.name}" is reserved; its default keys were kept.`);
    }
    for (const key of keysFor(binding, configured)) {
      const existing = owner.get(key);
      if (existing) {
        if (existing !== binding.name) {
          warnings.push(
            `Key "${key}" is already bound to "${existing}"; ignored for "${binding.name}".`,
          );
        }
        continue; // first claimant (reserved wins) keeps the key
      }
      owner.set(key, binding.name);
      map.set(key, { action: binding.action, params: binding.params });
    }
  }
  return { keyMap: map, warnings };
}

/**
 * Build a `physicalKey → action` map from the configured keybindings (the common
 * case that doesn't need the warnings). Thin wrapper over {@link resolveKeyBindings}.
 */
export function buildKeyMap(keybindings?: Record<string, readonly string[]>): KeyMap {
  return resolveKeyBindings(keybindings).keyMap;
}

/** Actions handled by the local focus engine (not sent to the server). */
export const FOCUS_ACTIONS: ReadonlySet<ActionName> = new Set([
  'navigate',
  'select',
  'home',
  'back',
]);
