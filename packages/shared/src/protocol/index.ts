/**
 * shared/protocol — the seed of the remote-control protocol (the "seam").
 *
 * This is intentionally a Phase-0 stub: it pins `PROTOCOL_VERSION`, declares the
 * action vocabulary, and defines the command/event message envelopes so later
 * phases extend this contract rather than reinvent it. Schemas are the single
 * source of truth — TypeScript types are inferred from them (see ../README.md).
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
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal('command'),
  id: z.string().optional(),
  action: actionNameSchema,
  params: z.record(z.string(), z.unknown()).optional(),
});
export type CommandMessage = z.infer<typeof commandMessageSchema>;

/**
 * Event envelope: server → client(s), broadcast. v1 carries `state_changed`;
 * the union is left open via the enum so new event types extend it.
 */
export const eventTypeSchema = z.enum(['state_changed']);
export type EventType = z.infer<typeof eventTypeSchema>;

export const eventMessageSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal('event'),
  event: eventTypeSchema,
  payload: z.record(z.string(), z.unknown()).optional(),
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
