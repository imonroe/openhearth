/**
 * "Aurora" — the first procedural screensaver (#126).
 *
 * A full-bleed field of slowly drifting colour gradients under a continuous
 * hue rotation, plus a clock that slowly wanders the frame. It is deliberately
 * unhurried (sleek, not flashy), but every layer is in constant motion so no
 * pixel holds a fixed colour for long — the whole frame cycles to avoid panel
 * burn-in on a TV that may sit on this screen for hours.
 *
 * Pure CSS animation (no canvas): GPU-cheap, and the component is just a few
 * divs so it renders identically under jsdom for tests.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { formatClockTime, msUntilNextMinute } from '../home/clock';

/** A large, slowly-drifting clock so the time never burns into one spot. */
function DriftingClock(): ReactNode {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      timer = setTimeout(
        () => {
          setNow(new Date());
          tick();
        },
        msUntilNextMinute(Date.now()) + 50,
      );
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="aurora__clock-drift">
      <time className="aurora__clock" dateTime={now.toISOString()}>
        {formatClockTime(now)}
      </time>
    </div>
  );
}

export function AuroraScreensaver(): ReactNode {
  return (
    <div className="aurora" data-testid="aurora">
      <div className="aurora__base" />
      <div className="aurora__blob aurora__blob--a" />
      <div className="aurora__blob aurora__blob--b" />
      <div className="aurora__blob aurora__blob--c" />
      <div className="aurora__vignette" />
      <DriftingClock />
    </div>
  );
}
