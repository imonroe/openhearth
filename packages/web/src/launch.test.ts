import { describe, it, expect, vi } from 'vitest';
import type { ServiceTile } from '@openhearth/shared';
import { launchService } from './launch';

const tile = (over: Partial<ServiceTile> = {}): ServiceTile => ({
  id: 'netflix',
  name: 'Netflix',
  launch_url: 'https://www.netflix.com/',
  ...over,
});

describe('launchService', () => {
  it('navigates to the service launch_url (FR-A2)', () => {
    const navigate = vi.fn();
    launchService(tile(), navigate);
    expect(navigate).toHaveBeenCalledWith('https://www.netflix.com/');
  });

  it('works for a YouTube-style TV URL', () => {
    const navigate = vi.fn();
    launchService(
      tile({ id: 'youtube', name: 'YouTube', launch_url: 'https://www.youtube.com/tv' }),
      navigate,
    );
    expect(navigate).toHaveBeenCalledWith('https://www.youtube.com/tv');
  });

  it('logs the user_agent hint when present (applied by the kiosk launcher)', () => {
    const navigate = vi.fn();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    launchService(tile({ user_agent: 'CustomUA/1.0' }), navigate);
    expect(info).toHaveBeenCalled();
    expect(info.mock.calls[0]![0]).toContain('CustomUA/1.0');
    expect(navigate).toHaveBeenCalledWith('https://www.netflix.com/');
    info.mockRestore();
  });
});
