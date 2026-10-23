import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { Config } from '@openhearth/shared';
import { Home } from './Home';
import { buildHomeModel, rowLengths } from './homeModel';
import { FocusProvider } from '../focus/FocusProvider';
import { buildKeyMap } from '../keybindings';

const keyMap = buildKeyMap();

function renderHome(wallpaper: { url: string; opacity: number } | null) {
  const model = buildHomeModel({ ui: { rows: [] } } as Config);
  return render(
    <FocusProvider rowLengths={rowLengths(model)} keyMap={keyMap}>
      <Home title="OpenHearth" model={model} wallpaper={wallpaper} />
    </FocusProvider>,
  );
}

describe('Home wallpaper layer (#118)', () => {
  it('renders a full-bleed wallpaper layer with the configured image + opacity', () => {
    const { container } = renderHome({ url: '/api/v1/ui/wallpaper?v=abc', opacity: 0.6 });
    const layer = container.querySelector('.app-shell__wallpaper') as HTMLElement;
    expect(layer).toBeTruthy();
    expect(layer.style.backgroundImage).toContain('/api/v1/ui/wallpaper?v=abc');
    expect(layer.style.opacity).toBe('0.6');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders no wallpaper layer when none is configured', () => {
    const { container } = renderHome(null);
    expect(container.querySelector('.app-shell__wallpaper')).toBeNull();
  });
});
