import { describe, it, expect, vi } from 'vitest';
import { PROTOCOL_VERSION, type CommandMessage } from '@openhearth/shared';
import { ControlService } from './ControlService.js';

const cmd = (
  action: CommandMessage['action'],
  params?: Record<string, unknown>,
): CommandMessage => ({
  type: 'command',
  protocol_version: PROTOCOL_VERSION,
  action,
  ...(params ? { params } : {}),
});

describe('ControlService', () => {
  it('applies a command and exposes the new state', () => {
    const svc = new ControlService();
    expect(svc.getState().volume).toBe(50);
    const next = svc.dispatch(cmd('set_volume', { level: 70 }));
    expect(next.volume).toBe(70);
    expect(svc.getState().volume).toBe(70);
  });

  it('broadcasts a state_changed event to every subscriber', () => {
    const svc = new ControlService();
    const a = { send: vi.fn() };
    const b = { send: vi.fn() };
    svc.subscribe(a);
    svc.subscribe(b);
    svc.dispatch(cmd('launch_service', { service_id: 'netflix' }));
    expect(a.send).toHaveBeenCalledTimes(1);
    expect(b.send).toHaveBeenCalledTimes(1);
    expect(a.send.mock.calls[0]![0]).toMatchObject({
      event: 'state_changed',
      state: { screen: 'service', service_id: 'netflix' },
    });
  });

  it('does not broadcast a no-op command (unchanged state)', () => {
    const svc = new ControlService();
    const sub = { send: vi.fn() };
    svc.subscribe(sub);
    svc.dispatch(cmd('navigate', { direction: 'down' })); // focus is client-side -> no-op
    svc.dispatch(cmd('select'));
    expect(sub.send).not.toHaveBeenCalled();
  });

  it('stops sending to a subscriber after it unsubscribes', () => {
    const svc = new ControlService();
    const sub = { send: vi.fn() };
    const off = svc.subscribe(sub);
    off();
    svc.dispatch(cmd('home'));
    expect(sub.send).not.toHaveBeenCalled();
    expect(svc.subscriberCount).toBe(0);
  });

  it('drops a subscriber whose send throws, without breaking the loop', () => {
    const svc = new ControlService();
    const bad = {
      send: () => {
        throw new Error('dead socket');
      },
    };
    const good = { send: vi.fn() };
    svc.subscribe(bad);
    svc.subscribe(good);
    svc.dispatch(cmd('home'));
    expect(good.send).toHaveBeenCalledTimes(1);
    expect(svc.subscriberCount).toBe(1); // bad one removed
  });
});
