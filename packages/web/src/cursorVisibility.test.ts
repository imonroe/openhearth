import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initCursorVisibility,
  type CursorVisibilityController,
} from './cursorVisibility';

describe('cursor visibility', () => {
  let controller: CursorVisibilityController;

  const move = (movementX = 5, movementY = 0): void => {
    document.dispatchEvent(
      new MouseEvent('mousemove', { movementX, movementY }),
    );
  };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.className = '';
    controller = initCursorVisibility();
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it('hides the cursor by default (keyboard mode)', () => {
    expect(document.body.classList.contains('cursor-visible')).toBe(false);
  });

  it('reveals the cursor when the mouse moves', () => {
    move();
    expect(document.body.classList.contains('cursor-visible')).toBe(true);
  });

  it('ignores zero-distance mouse events', () => {
    move(0, 0);
    expect(document.body.classList.contains('cursor-visible')).toBe(false);
  });

  it('hides the cursor again on keyboard input', () => {
    move();
    expect(document.body.classList.contains('cursor-visible')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(document.body.classList.contains('cursor-visible')).toBe(false);
  });

  it('hides the cursor after a period of mouse inactivity', () => {
    move();
    expect(document.body.classList.contains('cursor-visible')).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(document.body.classList.contains('cursor-visible')).toBe(false);
  });

  it('stops toggling once disposed', () => {
    controller.dispose();
    move();
    expect(document.body.classList.contains('cursor-visible')).toBe(false);
  });
});
