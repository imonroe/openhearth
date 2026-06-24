/**
 * shared/protocol — the remote-control protocol (the "seam").
 *
 * Pins `PROTOCOL_VERSION`, declares the action vocabulary, and defines the
 * command/event envelopes + authoritative state. As of #45 the v1 surface is
 * **frozen** and fully specified in `docs/protocol.md`; this module is its single
 * source of truth (TypeScript types and JSON Schemas derive from these Zod
 * schemas — see ../README.md). A breaking change bumps `PROTOCOL_VERSION`;
 * additive changes (new optional fields, actions, event types) do not.
 *
 * Isomorphic: depends only on `zod`, never on Node- or browser-only APIs.
 */
import { z } from 'zod';

/**
 * Protocol version. Bumped only on a breaking change to the envelope or action
 * vocabulary. Clients and the server exchange this so a mismatch is detectable.
 */
export const PROTOCOL_VERSION = 1 as const;

/**
 * The complete action vocabulary. The keyboard handler maps configured keys to
 * exactly these actions — no action is keyboard-specific. `home` is reserved and
 * always returns to the OpenHearth home screen (FR-A3 / NFR-5).
 */
export const ACTION_NAMES = [
  'navigate',
  'select',
  'back',
  'home',
  'play_pause',
  'seek',
  'stop',
  'launch_service',
  'play_item',
  'set_volume',
] as const;

export const actionNameSchema = z.enum(ACTION_NAMES);
export type ActionName = z.infer<typeof actionNameSchema>;

/**
 * Command envelope: client → server. `params` is an open bag for now; later
 * phases tighten it per-action (e.g. `seek` requires a position). `id` lets a
 * client correlate an acknowledgement/result with the command it sent.
 */
export const commandMessageSchema = z.object({
  type: z.literal('command'),
  // Wire key is snake_case to match the documented envelope (PRD §11.3).
  protocol_version: z.literal(PROTOCOL_VERSION),
  id: z.string().optional(),
  action: actionNameSchema,
  params: z.record(z.string(), z.unknown()).optional(),
  /** Reserved shared-token auth field (wired in #47); ignored in v1. */
  auth: z.string().optional(),
});
export type CommandMessage = z.infer<typeof commandMessageSchema>;

/**
 * Event envelope: server → client(s), broadcast. v1 carries `state_changed`;
 * the union is left open via the enum so new event types extend it.
 */
export const eventTypeSchema = z.enum(['state_changed']);
export type EventType = z.infer<typeof eventTypeSchema>;

export const eventMessageSchema = z.object({
  type: z.literal('event'),
  protocol_version: z.literal(PROTOCOL_VERSION),
  event: eventTypeSchema,
  // Wire key `state` matches the documented envelope (PRD §11.3).
  state: z.record(z.string(), z.unknown()).optional(),
});
export type EventMessage = z.infer<typeof eventMessageSchema>;

/** Any message crossing the seam, discriminated by `type`. */
export const protocolMessageSchema = z.discriminatedUnion('type', [
  commandMessageSchema,
  eventMessageSchema,
]);
export type ProtocolMessage = z.infer<typeof protocolMessageSchema>;

/** Parse-and-validate an unknown value as a protocol message. */
export function parseProtocolMessage(input: unknown): ProtocolMessage {
  return protocolMessageSchema.parse(input);
}

/** JSON Schema for the protocol message union (for non-TS clients / docs). */
export const protocolMessageJsonSchema = z.toJSONSchema(protocolMessageSchema);

// --- Authoritative control state ------------------------------------------

export const playbackStatusSchema = z.enum(['stopped', 'playing', 'paused']);
export type PlaybackStatus = z.infer<typeof playbackStatusSchema>;

export const screenSchema = z.enum(['home', 'service', 'player']);
export type Screen = z.infer<typeof screenSchema>;

/**
 * The authoritative UI/playback state the ControlService holds and broadcasts.
 * Focus is a client-side concern (it depends on the rendered grid), so it is not
 * part of the server snapshot; the snapshot tracks the state the server can
 * reason about: screen, playback, and volume.
 */
export const stateSnapshotSchema = z
  .object({
    screen: screenSchema,
    playback: z
      .object({
        status: playbackStatusSchema,
        item_id: z.string().nullable(),
        position_s: z.number().int().min(0),
      })
      .strict(),
    /** Service most recently launched (Strategy A), or null. */
    service_id: z.string().nullable(),
    /** Output volume, 0–100. */
    volume: z.number().int().min(0).max(100),
  })
  .strict();
export type StateSnapshot = z.infer<typeof stateSnapshotSchema>;

export const INITIAL_STATE: StateSnapshot = {
  screen: 'home',
  playback: { status: 'stopped', item_id: null, position_s: 0 },
  service_id: null,
  volume: 50,
};

const numParam = (command: CommandMessage, key: string): number | undefined => {
  const value = command.params?.[key];
  // Reject non-finite (Infinity/NaN) so the reducer can never park the snapshot
  // in a shape that violates its own schema (z.number().int()).
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};
const strParam = (command: CommandMessage, key: string): string | undefined => {
  const value = command.params?.[key];
  return typeof value === 'string' ? value : undefined;
};

/**
 * Pure reducer: apply a validated command to the state, returning the next
 * state. Isomorphic and side-effect-free so it can be unit-tested and (later)
 * mirrored on clients for optimistic updates. Navigation/focus actions
 * (`navigate`/`select`) don't change the server snapshot — focus is client-side
 * — so they return the same reference; the ControlService treats that as a
 * no-op and does not broadcast.
 */
export function applyCommand(state: StateSnapshot, command: CommandMessage): StateSnapshot {
  switch (command.action) {
    case 'home':
      return { ...state, screen: 'home' };
    case 'back':
      // One level up: player → service if a service is active, else → home.
      if (state.screen === 'player') {
        return { ...state, screen: state.service_id ? 'service' : 'home' };
      }
      return { ...state, screen: 'home' };
    case 'launch_service':
      return {
        ...state,
        screen: 'service',
        service_id: strParam(command, 'service_id') ?? state.service_id,
      };
    case 'play_item':
      return {
        ...state,
        screen: 'player',
        playback: {
          status: 'playing',
          item_id: strParam(command, 'item_id') ?? null,
          position_s: 0,
        },
      };
    case 'play_pause': {
      const status = state.playback.status;
      if (status === 'playing')
        return { ...state, playback: { ...state.playback, status: 'paused' } };
      if (status === 'paused')
        return { ...state, playback: { ...state.playback, status: 'playing' } };
      return state; // nothing loaded
    }
    case 'stop':
      return {
        ...state,
        playback: { status: 'stopped', item_id: null, position_s: 0 },
      };
    case 'seek': {
      const position = numParam(command, 'position_s');
      if (position === undefined || position < 0) return state;
      return { ...state, playback: { ...state.playback, position_s: Math.floor(position) } };
    }
    case 'set_volume': {
      const level = numParam(command, 'level');
      if (level === undefined) return state;
      return { ...state, volume: Math.max(0, Math.min(100, Math.floor(level))) };
    }
    case 'navigate':
    case 'select':
      return state; // focus is client-side; command is still broadcast
    default:
      return state;
  }
}

/** Build a `state_changed` event carrying the given snapshot. */
export function makeStateEvent(state: StateSnapshot): EventMessage {
  return {
    type: 'event',
    protocol_version: PROTOCOL_VERSION,
    event: 'state_changed',
    // The event envelope types `state` as an open record; the snapshot is a
    // concrete object that satisfies it structurally.
    state: { ...state } as Record<string, unknown>,
  };
}
