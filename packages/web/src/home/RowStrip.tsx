/**
 * A horizontally scrollable tile row (issue #113). Focus drives the scroll
 * position (see useScrollIntoViewOnFocus); this component only tracks whether
 * there is more content off either edge and reflects it as `data-overflow-start`
 * / `data-overflow-end` so the CSS edge-fade appears on a side *only when it has
 * somewhere to scroll* — never dimming a focused tile that's already at the end
 * of the row.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function RowStrip({ children }: { children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = (): void => {
      // 1px slack absorbs sub-pixel rounding at the scroll extremes.
      const maxScroll = el.scrollWidth - el.clientWidth;
      el.dataset.overflowStart = el.scrollLeft > 1 ? 'true' : 'false';
      el.dataset.overflowEnd = el.scrollLeft < maxScroll - 1 ? 'true' : 'false';
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    // Re-evaluate when the row's size or tile count changes (config reload, resize).
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);

    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="row__strip" ref={ref}>
      {children}
    </div>
  );
}
