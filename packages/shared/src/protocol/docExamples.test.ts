/**
 * Protocol-doc conformance (#45). The example messages in docs/protocol.md MUST
 * validate against the published schemas — this test pins the examples so the
 * doc can't drift from the implementation, and freezes the v1 surface (version
 * number + action vocabulary + state shape).
 */
import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  ACTION_NAMES,
  commandMessageSchema,
  eventMessageSchema,
  protocolMessageSchema,
  stateSnapshotSchema,
  parseProtocolMessage,
  INITIAL_STATE,
} from './index.js';

describe('protocol v1 freeze (#45)', () => {
  it('pins the protocol version at 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('freezes the documented action vocabulary', () => {
    // Exactly the table in docs/protocol.md §5 — a change here is a doc + (maybe
    // version) change, so this guards against silent drift.
    expect([...ACTION_NAMES]).toEqual([
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
    ]);
  });

  it('INITIAL_STATE matches the documented snapshot', () => {
    expect(INITIAL_STATE).toEqual({
      screen: 'home',
      playback: { status: 'stopped', item_id: null, position_s: 0 },
      service_id: null,
      volume: 50,
    });
    expect(stateSnapshotSchema.safeParse(INITIAL_STATE).success).toBe(true);
  });
});

describe('docs/protocol.md examples validate against the published schemas', () => {
  // §4.1 / §10 command examples.
  const commandExamples = [
    { type: 'command', protocol_version: 1, action: 'play_pause', params: { level: 40 } },
    {
      type: 'command',
      protocol_version: 1,
      action: 'set_volume',
      params: { level: 40 },
    },
    { type: 'command', protocol_version: 1, action: 'play_item', params: { item_id: 'abc123' } },
    { type: 'command', protocol_version: 1, action: 'home' },
    // With the reserved auth field + correlation id.
    { type: 'command', protocol_version: 1, action: 'home', id: 'c-42', auth: 'tok' },
  ];

  it('every documented command validates', () => {
    for (const ex of commandExamples) {
      expect(commandMessageSchema.safeParse(ex).success).toBe(true);
      // Also valid as a member of the discriminated union.
      expect(() => parseProtocolMessage(ex)).not.toThrow();
    }
  });

  // §4.2 / §10 event example.
  it('the documented state_changed event validates', () => {
    const event = {
      type: 'event',
      protocol_version: 1,
      event: 'state_changed',
      state: {
        screen: 'player',
        playback: { status: 'playing', item_id: 'abc123', position_s: 0 },
        service_id: null,
        volume: 50,
      },
    };
    expect(eventMessageSchema.safeParse(event).success).toBe(true);
    expect(protocolMessageSchema.safeParse(event).success).toBe(true);
    // The embedded snapshot is itself a valid StateSnapshot.
    expect(stateSnapshotSchema.safeParse(event.state).success).toBe(true);
  });

  it('rejects a wrong protocol_version (the §10 invalid-command example)', () => {
    const bad = { type: 'command', protocol_version: 2, action: 'home' };
    expect(commandMessageSchema.safeParse(bad).success).toBe(false);
  });
});
