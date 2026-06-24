/**
 * Native media player (design-system §12 Player; FR-C5). An HTML5 `<video>` wired
 * to the stream endpoint, driven by the client-agnostic action vocabulary:
 * play_pause toggles, seek (±10s) scrubs, back/stop exits, home returns home.
 * Reserved Home/Back are intercepted at the capture phase so they never reach a
 * stray handler. Playback position is persisted every few seconds and on exit,
 * and offered as a resume point on re-entry; finishing clears it.
 *
 * The player runs its own keydown handler (not a FocusProvider) because playback
 * keys act on the media element, not a tile grid — but it speaks the same action
 * vocabulary and still mirrors commands to the control path (parity with a
 * phone remote).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActionName, LibraryItem, SubtitleTrack } from '@openhearth/shared';
import {
  libraryStreamUrl,
  fetchResume,
  saveResume,
  clearResume,
  fetchSubtitles,
  subtitleTrackUrl,
} from '../api';
import type { KeyMap } from '../keybindings';

type Dispatch = (action: ActionName, params?: Record<string, unknown>) => void;
type Phase = 'loading' | 'prompt' | 'playing';

const SEEK_STEP_SEC = 10;
const SAVE_INTERVAL_MS = 5000;
/** Hide the player chrome after this long with no input while playing. */
export const CHROME_IDLE_MS = 3000;

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function Player({
  item,
  keyMap,
  dispatch,
  onExit,
  onHome,
}: {
  item: LibraryItem;
  keyMap: KeyMap;
  dispatch: Dispatch;
  onExit: () => void;
  onHome: () => void;
}): ReactNode {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [resumeSec, setResumeSec] = useState(0);
  const [promptIdx, setPromptIdx] = useState(0); // 0 = Resume, 1 = Start over
  const [paused, setPaused] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [subs, setSubs] = useState<SubtitleTrack[]>([]);
  const [activeSub, setActiveSub] = useState(-1); // -1 = off
  const [chromeVisible, setChromeVisible] = useState(true);
  const startSecRef = useRef(0);

  // Load the item's subtitle tracks (sidecar + embedded).
  useEffect(() => {
    const controller = new AbortController();
    fetchSubtitles(item.id, controller.signal)
      .then(setSubs)
      .catch(() => {});
    return () => controller.abort();
  }, [item.id]);

  // Apply the active subtitle selection to the media element's text tracks.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !v.textTracks) return;
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i]!.mode = i === activeSub ? 'showing' : 'disabled';
    }
  }, [activeSub, phase, subs]);

  // Cycle Off → track 0 → … → last → Off.
  const cycleSubs = useCallback(() => {
    setActiveSub((prev) => (prev + 1 >= subs.length ? -1 : prev + 1));
  }, [subs.length]);

  // Load any saved resume position, then either prompt or start from the top.
  useEffect(() => {
    const controller = new AbortController();
    fetchResume(item.id, controller.signal)
      .then((r) => {
        const at = r?.position_sec ?? 0;
        setResumeSec(at);
        if (at > 0) {
          setPromptIdx(0);
          setPhase('prompt');
        } else {
          startSecRef.current = 0;
          setPhase('playing');
        }
      })
      .catch(() => {
        startSecRef.current = 0;
        setPhase('playing');
      });
    return () => controller.abort();
  }, [item.id]);

  // Persist position periodically while actually playing.
  useEffect(() => {
    if (phase !== 'playing') return;
    const iv = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused && v.currentTime > 1) saveResume(item.id, v.currentTime);
    }, SAVE_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [phase, item.id]);

  // Auto-hide the chrome (OSD) during playback so it doesn't sit over the film.
  // Any mouse movement or key press reveals it and restarts the idle timer; while
  // paused the chrome stays up so the user can always see where they stopped.
  useEffect(() => {
    if (phase !== 'playing') return;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const clear = (): void => {
      if (hideTimer !== undefined) {
        clearTimeout(hideTimer);
        hideTimer = undefined;
      }
    };
    const reveal = (): void => {
      setChromeVisible(true);
      clear();
      if (!paused) hideTimer = setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS);
    };
    // Establish the right state for the current pause status, then listen for input.
    reveal();
    const onMouseMove = (event: MouseEvent): void => {
      if (event.movementX === 0 && event.movementY === 0) return;
      reveal();
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('keydown', reveal, true);
    return () => {
      clear();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', reveal, true);
    };
  }, [phase, paused]);

  const saveNow = useCallback(() => {
    const v = videoRef.current;
    if (v && v.currentTime > 1 && !v.ended) saveResume(item.id, v.currentTime);
  }, [item.id]);

  const exit = useCallback(() => {
    saveNow();
    onExit();
  }, [saveNow, onExit]);

  const goHome = useCallback(() => {
    saveNow();
    onHome();
  }, [saveNow, onHome]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const max = Number.isFinite(v.duration) ? v.duration : v.currentTime + delta;
    v.currentTime = Math.min(Math.max(0, v.currentTime + delta), max);
  }, []);

  // Mouse: click the progress bar to scrub to that fraction. Mirrors the keyboard
  // `seek` to the control path so a click behaves like the remote.
  const seekToFraction = useCallback(
    (fraction: number) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
      const target = Math.min(Math.max(0, fraction), 1) * v.duration;
      dispatch('seek', { delta: target - v.currentTime });
      v.currentTime = target;
    },
    [dispatch],
  );

  // Capture-phase key handling for the whole player. Reserved keys stop
  // propagation so nothing downstream can shadow them.
  const choosePromptRef = useRef<(idx: number) => void>(() => {});
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const bound = keyMap.get(event.key);
      if (!bound) return;
      event.preventDefault();
      switch (bound.action) {
        case 'home':
          event.stopImmediatePropagation();
          goHome();
          return;
        case 'back':
          event.stopImmediatePropagation();
          exit();
          return;
        case 'stop':
          // `stop` is not reserved (unlike home/back), so it only preventDefaults
          // — no stopImmediatePropagation; exit() tears the player down anyway.
          dispatch('stop');
          exit();
          return;
        case 'select':
          // "Start over" forgets the saved position so a quick exit doesn't
          // leave the stale resume row behind (handled in choosePrompt).
          if (phase === 'prompt') choosePromptRef.current(promptIdx);
          else togglePlay();
          return;
        case 'play_pause':
          dispatch('play_pause');
          togglePlay();
          return;
        case 'navigate': {
          const dir = bound.params?.direction;
          if (phase === 'prompt') {
            if (dir === 'left') setPromptIdx(0);
            else if (dir === 'right') setPromptIdx(1);
            return;
          }
          if (dir === 'left') {
            dispatch('seek', { delta: -SEEK_STEP_SEC });
            seekBy(-SEEK_STEP_SEC);
          } else if (dir === 'right') {
            dispatch('seek', { delta: SEEK_STEP_SEC });
            seekBy(SEEK_STEP_SEC);
          } else if (dir === 'up' || dir === 'down') {
            // No vertical navigation in the player — repurpose Up to cycle
            // subtitle tracks (Off → each track → Off).
            cycleSubs();
          }
          return;
        }
        default:
          dispatch(bound.action, bound.params);
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [keyMap, phase, promptIdx, goHome, exit, togglePlay, seekBy, cycleSubs, dispatch]);

  const start = useCallback((from: number) => {
    startSecRef.current = from;
    setPhase('playing');
  }, []);

  // Choose a resume option (keyboard select or mouse click on a prompt button).
  // "Start over" (idx 1) forgets the saved position; idx 0 resumes.
  const choosePrompt = useCallback(
    (idx: number) => {
      if (idx === 1) clearResume(item.id);
      setPromptIdx(idx);
      start(idx === 0 ? resumeSec : 0);
    },
    [item.id, resumeSec, start],
  );
  choosePromptRef.current = choosePrompt;

  // Mouse: clicking the video toggles play/pause, mirroring the control path.
  const clickTogglePlay = useCallback(() => {
    dispatch('play_pause');
    togglePlay();
  }, [dispatch, togglePlay]);

  if (phase === 'loading') {
    return <div className="player player--loading">Loading…</div>;
  }

  if (phase === 'prompt') {
    return (
      <div className="player player--prompt" role="dialog" aria-label="Resume playback">
        <h1 className="player__title">{item.title}</h1>
        <div className="player__resume-row">
          <div
            className={`player__resume-btn ${promptIdx === 0 ? 'is-focused' : ''}`}
            role="button"
            aria-selected={promptIdx === 0}
            onMouseEnter={() => setPromptIdx(0)}
            onClick={() => choosePrompt(0)}
          >
            ↩ Resume from {fmt(resumeSec)}
          </div>
          <div
            className={`player__resume-btn ${promptIdx === 1 ? 'is-focused' : ''}`}
            role="button"
            aria-selected={promptIdx === 1}
            onMouseEnter={() => setPromptIdx(1)}
            onClick={() => choosePrompt(1)}
          >
            ▶ Start over
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="player" role="region" aria-label={`Playing ${item.title}`}>
      <video
        ref={videoRef}
        className="player__video"
        src={libraryStreamUrl(item.id, startSecRef.current)}
        autoPlay
        onClick={clickTogglePlay}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(v.duration);
          // Direct-play files are fully seekable → jump to the resume point.
          // Transcodes start at the offset via `?t=`, so don't double-seek.
          const from = startSecRef.current;
          if (from > 0 && v.seekable.length > 0 && from <= v.seekable.end(v.seekable.length - 1)) {
            v.currentTime = from;
          }
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => {
          clearResume(item.id);
          onExit();
        }}
      >
        {subs.map((t) => (
          <track
            key={t.id}
            kind="subtitles"
            src={subtitleTrackUrl(item.id, t.id)}
            label={t.label}
            {...(t.lang ? { srcLang: t.lang } : {})}
          />
        ))}
      </video>
      <div
        className={`player__osd ${chromeVisible ? '' : 'player__osd--hidden'}`}
        aria-hidden="true"
      >
        <div className="player__osd-title">{item.title}</div>
        <div
          className="player__progress"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            if (rect.width > 0) seekToFraction((e.clientX - rect.left) / rect.width);
          }}
        >
          <div
            className="player__progress-fill"
            style={{ width: duration > 0 ? `${(current / duration) * 100}%` : '0%' }}
          />
        </div>
        <div className="player__osd-meta">
          <span className="player__osd-state">{paused ? '⏸' : '▶'}</span>
          <span className="player__osd-time">
            {fmt(current)} / {fmt(duration)}
          </span>
          {subs.length > 0 ? (
            <span className="player__osd-subs">
              CC: {activeSub >= 0 ? (subs[activeSub]?.label ?? 'On') : 'Off'}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
