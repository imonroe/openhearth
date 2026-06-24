/**
 * Live header clock. Renders the current local time and re-renders once per
 * minute, aligned to the minute boundary so the displayed minute is never
 * stale by more than ~a second.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { formatClockTime, msUntilNextMinute } from './clock';

export function Clock(): ReactNode {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const scheduleNext = (): void => {
      // +50ms guard so we land just after the boundary, never just before.
      timer = setTimeout(
        () => {
          setNow(new Date());
          scheduleNext();
        },
        msUntilNextMinute(Date.now()) + 50,
      );
    };
    scheduleNext();
    return () => clearTimeout(timer);
  }, []);

  return (
    <time className="header__clock" dateTime={now.toISOString()}>
      {formatClockTime(now)}
    </time>
  );
}
