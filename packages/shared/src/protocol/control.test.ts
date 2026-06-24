import { describe, it, expect } from 'vitest';
import {
  INITIAL_STATE,
  applyCommand,
  makeStateEvent,
  PROTOCOL_VERSION,
  type CommandMessage,
} from './index';

const cmd = (
  action: CommandMessage['action'],
  params?: Record<string, unknown>,
): CommandMessage => ({
  type: 'command',
  protocol_version: PROTOCOL_VERSION,
  action,
  ...(params ? { params } : {}),
});

describe('applyCommand', () => {
  it('starts stopped on the home screen', () => {
    expect(INITIAL_STATE.screen).toBe('home');
    expect(INITIAL_STATE.playback.status).toBe('stopped');
  });

  it('launch_service moves to the service screen and records the id', () => {
    const s = applyCommand(INITIAL_STATE, cmd('launch_service', { service_id: 'netflix' }));
    expect(s.screen).toBe('service');
    expect(s.service_id).toBe('netflix');
  });

  it('play_item starts playback on the player screen', () => {
    const s = applyCommand(INITIAL_STATE, cmd('play_item', { item_id: 'movie-1' }));
    expect(s).toMatchObject({
      screen: 'player',
      playback: { status: 'playing', item_id: 'movie-1', position_s: 0 },
    });
  });

  it('play_pause toggles only when something is loaded', () => {
    expect(applyCommand(INITIAL_STATE, cmd('play_pause'))).toEqual(INITIAL_STATE); // nothing loaded
    const playing = applyCommand(INITIAL_STATE, cmd('play_item', { item_id: 'x' }));
    const paused = applyCommand(playing, cmd('play_pause'));
    expect(paused.playback.status).toBe('paused');
    expect(applyCommand(paused, cmd('play_pause')).playback.status).toBe('playing');
  });

  it('seek sets a non-negative integer position; ignores bad input', () => {
    const playing = applyCommand(INITIAL_STATE, cmd('play_item', { item_id: 'x' }));
    expect(applyCommand(playing, cmd('seek', { position_s: 42.9 })).playback.position_s).toBe(42);
    expect(applyCommand(playing, cmd('seek', { position_s: -5 })).playback.position_s).toBe(0);
    expect(applyCommand(playing, cmd('seek', {})).playback.position_s).toBe(0);
  });

  it('stop clears playback', () => {
    const playing = applyCommand(INITIAL_STATE, cmd('play_item', { item_id: 'x' }));
    expect(applyCommand(playing, cmd('stop')).playback).toEqual({
      status: 'stopped',
      item_id: null,
      position_s: 0,
    });
  });

  it('set_volume clamps to 0–100', () => {
    expect(applyCommand(INITIAL_STATE, cmd('set_volume', { level: 80 })).volume).toBe(80);
    expect(applyCommand(INITIAL_STATE, cmd('set_volume', { level: 200 })).volume).toBe(100);
    expect(applyCommand(INITIAL_STATE, cmd('set_volume', { level: -3 })).volume).toBe(0);
  });

  it('home/back change the screen; navigate/select are no-ops on the snapshot', () => {
    const onService = applyCommand(INITIAL_STATE, cmd('launch_service', { service_id: 's' }));
    expect(applyCommand(onService, cmd('home')).screen).toBe('home');
    const onPlayer = applyCommand(onService, cmd('play_item', { item_id: 'x' }));
    expect(applyCommand(onPlayer, cmd('back')).screen).toBe('service'); // player -> service
    expect(applyCommand(INITIAL_STATE, cmd('navigate', { direction: 'down' }))).toEqual(
      INITIAL_STATE,
    );
    expect(applyCommand(INITIAL_STATE, cmd('select'))).toEqual(INITIAL_STATE);
  });

  it('does not mutate the input state', () => {
    const before = structuredClone(INITIAL_STATE);
    applyCommand(INITIAL_STATE, cmd('set_volume', { level: 10 }));
    expect(INITIAL_STATE).toEqual(before);
  });
});

describe('makeStateEvent', () => {
  it('wraps a snapshot in a state_changed event envelope', () => {
    const event = makeStateEvent(INITIAL_STATE);
    expect(event).toMatchObject({
      type: 'event',
      protocol_version: PROTOCOL_VERSION,
      event: 'state_changed',
    });
    expect(event.state).toMatchObject({ screen: 'home' });
  });
});
