import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { SlideshowManifest, SlideshowTransition } from '@openhearth/shared';
import { SlideshowView } from './Slideshow';
import { buildKeyMap } from '../keybindings';

const keyMap = buildKeyMap();

function manifest(
  count: number,
  transition: SlideshowTransition = 'cut',
  intervalSeconds = 5,
): SlideshowManifest {
  return {
    images: Array.from({ length: count }, (_, i) => ({ id: `img${i}`, uploaded: false })),
    settings: { intervalSeconds, transition, order: 'sequential' },
  };
}

function currentSrc(container: HTMLElement): string {
  const imgs = container.querySelectorAll('img.slideshow__image');
  return (imgs[imgs.length - 1] as HTMLImageElement).getAttribute('src') ?? '';
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('SlideshowView (#164)', () => {
  it('shows the first image and advances on the interval', () => {
    const { container } = render(
      <SlideshowView manifest={manifest(3, 'cut', 5)} mode="ondemand" />,
    );
    expect(currentSrc(container)).toContain('img0');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(currentSrc(container)).toContain('img1');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(currentSrc(container)).toContain('img2');
  });

  it('applies the selected transition class to the incoming layer', () => {
    const { container } = render(
      <SlideshowView manifest={manifest(2, 'crossfade', 5)} mode="ondemand" />,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const imgs = container.querySelectorAll('img.slideshow__image');
    const incoming = imgs[imgs.length - 1] as HTMLElement;
    expect(incoming.className).toContain('slideshow__image--crossfade');
  });

  it('screensaver mode wakes on the first keypress and consumes the event', () => {
    const onWake = vi.fn();
    render(<SlideshowView manifest={manifest(2)} mode="screensaver" onWake={onWake} />);
    const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('on-demand mode exits on the reserved Back key', () => {
    const onExit = vi.fn();
    render(
      <SlideshowView manifest={manifest(2)} mode="ondemand" keyMap={keyMap} onExit={onExit} />,
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('on-demand mode steps to the next image on the Right arrow', () => {
    const { container } = render(
      <SlideshowView manifest={manifest(3, 'cut')} mode="ondemand" keyMap={keyMap} />,
    );
    expect(currentSrc(container)).toContain('img0');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
    });
    expect(currentSrc(container)).toContain('img1');
  });

  it('shows an empty-state message on demand when there are no photos', () => {
    render(<SlideshowView manifest={manifest(0)} mode="ondemand" />);
    expect(screen.getByText(/No photos yet/i)).toBeTruthy();
  });

  it('screensaver mode renders the fallback saver when there are no photos', () => {
    render(
      <SlideshowView
        manifest={manifest(0)}
        mode="screensaver"
        onWake={vi.fn()}
        fallback={<div data-testid="fallback-saver" />}
      />,
    );
    expect(screen.getByTestId('fallback-saver')).toBeTruthy();
  });
});
