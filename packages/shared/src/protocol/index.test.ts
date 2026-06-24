import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  ACTION_NAMES,
  parseProtocolMessage,
  protocolMessageSchema,
  protocolMessageJsonSchema,
  type CommandMessage,
} from './index';

describe('protocol', () => {
  it('pins the protocol version at 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('exposes the full reserved action vocabulary', () => {
    expect(ACTION_NAMES).toContain('home');
    expect(ACTION_NAMES).toContain('launch_service');
    expect(ACTION_NAMES).toHaveLength(10);
  });

  it('validates a well-formed command message', () => {
    const sample: CommandMessage = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'command',
      action: 'navigate',
      params: { direction: 'down' },
    };
    expect(parseProtocolMessage(sample)).toEqual(sample);
  });

  it('validates a well-formed event message', () => {
    const sample = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'event' as const,
      event: 'state_changed' as const,
      payload: { focus: 'tile-3' },
    };
    expect(parseProtocolMessage(sample)).toEqual(sample);
  });

  it('rejects an unknown action', () => {
    const bad = { protocolVersion: 1, type: 'command', action: 'explode' };
    expect(protocolMessageSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a mismatched protocol version', () => {
    const bad = { protocolVersion: 2, type: 'command', action: 'home' };
    expect(protocolMessageSchema.safeParse(bad).success).toBe(false);
  });

  it('emits a JSON Schema for non-TS clients', () => {
    expect(protocolMessageJsonSchema).toBeTypeOf('object');
  });
});
