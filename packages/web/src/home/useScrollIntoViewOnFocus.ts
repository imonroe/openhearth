/**
 * Keeps the focused tile visible inside its horizontally scrollable row
 * (issue #113). When a tile gains focus, it is smoothly scrolled into view;
 * focus stays the source of truth, the scroll position just follows it.
 *
 * `inline: 'nearest'` scrolls the minimum amount — moving right past the edge
 * reveals the next tile, moving left reveals the previous one — rather than
 * recentring on every step, which reads as the row gliding sideways under a
 * stationary focus ring.
 *
 * No-ops safely where `scrollIntoView` is absent or a stub (jsdom), and falls
 * back to an instant jump when the user prefers reduced motion.
 */
import { useEffect, useRef, type RefObject } from 'react';

export function useScrollIntoViewOnFocus<T extends HTMLElement>(focused: boolean): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!focused) return;
    const el = ref.current;
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    el.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [focused]);
  return ref;
}
