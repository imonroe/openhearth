/**
 * App root: fetch the effective config, apply the theme, and render the home
 * shell under the focus engine.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ActionName, Config, LibraryItem, ServiceCatalog } from '@openhearth/shared';
import { fetchConfig, fetchServices, fetchLibrary, sendCommand } from './api';
import { FocusProvider } from './focus/FocusProvider';
import type { FocusPosition } from './focus/focusEngine';
import { buildKeyMap } from './keybindings';
import { buildHomeModel, rowLengths, firstContentRow, type HomeModel } from './home/homeModel';
import { Home } from './home/Home';
import { LibraryDetail } from './detail/LibraryDetail';
import { Player } from './player/Player';
import type { LibraryEntry } from './library/libraryModel';
import { launchService, defaultNavigate, type Navigate } from './launch';

type LibraryBySource = Map<string, LibraryItem[]>;

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; config: Config; catalog: ServiceCatalog; library: LibraryBySource };

const EMPTY_CATALOG: ServiceCatalog = { groups: [], errors: [] };

/** Library source ids referenced by the configured library rows (deduped). */
function librarySources(config: Config): string[] {
  const ids = (config.ui?.rows ?? [])
    .filter((r) => r.type === 'library' && typeof r.source === 'string')
    .map((r) => r.source as string);
  return [...new Set(ids)];
}

/** How often the kiosk re-fetches config to pick up a server hot-reload (FR-R4). */
const CONFIG_POLL_MS = 30_000;

/** `navigate` and `dispatch` are injectable so tests can assert behavior. */
export function App({
  navigate = defaultNavigate,
  dispatch = sendCommand,
}: {
  navigate?: Navigate;
  dispatch?: (action: ActionName, params?: Record<string, unknown>) => void;
} = {}): ReactNode {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const load = async (initial: boolean): Promise<void> => {
      try {
        const config = await fetchConfig(controller.signal);
        // The catalog is non-essential to boot — fall back to empty on failure so
        // the shell still renders (NFR-4 spirit).
        const catalog = await fetchServices(controller.signal).catch((err: unknown) => {
          console.error('OpenHearth: failed to load services', err);
          return EMPTY_CATALOG;
        });
        // Library is non-essential to boot and per-source independent — a failed
        // source degrades to empty rather than failing the load.
        const library: LibraryBySource = new Map();
        await Promise.all(
          librarySources(config.config).map(async (source) => {
            try {
              const page = await fetchLibrary(source, controller.signal);
              library.set(source, page.items);
              if (page.total > page.items.length) {
                console.warn(
                  `OpenHearth: library "${source}" has ${page.total} items; showing the first ${page.items.length}`,
                );
              }
            } catch (err) {
              if (err instanceof DOMException && err.name === 'AbortError') return;
              console.error(`OpenHearth: failed to load library "${source}"`, err);
            }
          }),
        );
        setState({ status: 'ready', config: config.config, catalog, library });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('OpenHearth: failed to load config', err);
        // Only surface a fatal error on the first load; a failed background
        // refresh keeps the last-good UI.
        if (initial) setState({ status: 'error', message: String(err) });
      }
    };
    void load(true);

    // Pick up a server hot-reload (e.g. a re-mapped keybinding) without a restart
    // (FR-R4) via two triggers: a low-frequency poll (a dedicated kiosk is always
    // foregrounded, so we can't rely on visibility alone), plus a re-fetch when
    // the page regains visibility. Returning from a launched service is a full
    // page reload, which also re-fetches.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    const poll = setInterval(() => void load(false), CONFIG_POLL_MS);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(poll);
    };
  }, []);

  // Theme is configurable via ui.theme; default dark.
  useEffect(() => {
    const theme = state.status === 'ready' ? (state.config.ui?.theme ?? 'dark') : 'dark';
    document.documentElement.dataset.theme = theme;
  }, [state]);

  // Memoize the derived layout so its identity is stable across re-renders that
  // don't change the config — otherwise FocusProvider's reseat effect (keyed on
  // the rowLengths array) would re-fire on every render.
  const config = state.status === 'ready' ? state.config : null;
  const catalog = state.status === 'ready' ? state.catalog : null;
  const library = state.status === 'ready' ? state.library : null;
  const model = useMemo(
    () => (config ? buildHomeModel(config, catalog ?? undefined, library ?? undefined) : null),
    [config, catalog, library],
  );
  // Focus enters on the first tile of the first non-empty content row (the
  // header is row 0), matching the Home screen focus-entry spec.
  const initialPosition = useMemo(() => {
    if (!model) return undefined;
    const row = firstContentRow(model);
    return row !== null ? { row, col: 0 } : undefined;
  }, [model]);

  if (state.status === 'loading') {
    return (
      <div className="app-shell">
        <div className="home__empty">Loading…</div>
      </div>
    );
  }

  if (state.status === 'error' || !model || !config) {
    return (
      <div className="app-shell">
        <div className="home__empty">Couldn’t load configuration</div>
      </div>
    );
  }

  const title = config.ui?.title ?? 'OpenHearth';

  return (
    <ReadyApp
      title={title}
      model={model}
      initialPosition={initialPosition}
      navigate={navigate}
      keybindings={config.keybindings}
      dispatch={dispatch}
    />
  );
}

/** The ready home, split out so `onSelect` can close over a stable `model`. */
function ReadyApp({
  title,
  model,
  initialPosition,
  navigate,
  keybindings,
  dispatch,
}: {
  title: string;
  model: HomeModel;
  initialPosition: FocusPosition | undefined;
  navigate: Navigate;
  keybindings: Config['keybindings'];
  dispatch: (action: ActionName, params?: Record<string, unknown>) => void;
}): ReactNode {
  const lengths = useMemo(() => rowLengths(model), [model]);
  // Rebuild the key→action map whenever the configured bindings change (FR-R4).
  const keyMap = useMemo(() => buildKeyMap(keybindings), [keybindings]);

  // Which screen is showing: the home grid, a library item's detail, or the
  // player (which sits on top of the detail it was launched from).
  const [detail, setDetail] = useState<LibraryEntry | null>(null);
  const [player, setPlayer] = useState<LibraryItem | null>(null);

  // select on home: launch a service tile (FR-A2) or open a library item's
  // detail screen.
  const onSelect = useCallback(
    (pos: FocusPosition) => {
      const row = model.rows[pos.row];
      if (row?.kind === 'services') {
        const tile = row.tiles[pos.col];
        if (tile) launchService(tile, navigate);
      } else if (row?.kind === 'library') {
        const entry = row.entries[pos.col];
        if (entry) setDetail(entry);
      }
    },
    [model, navigate],
  );

  // The player sits on top of the detail it launched from: Back returns to the
  // detail, Home returns all the way to the home grid.
  if (player) {
    return (
      <Player
        item={player}
        keyMap={keyMap}
        dispatch={dispatch}
        onExit={() => setPlayer(null)}
        onHome={() => {
          setPlayer(null);
          setDetail(null);
        }}
      />
    );
  }

  // A library detail screen owns its own focus grid; Back returns to home.
  if (detail) {
    return (
      <LibraryDetail
        entry={detail}
        keyMap={keyMap}
        dispatch={dispatch}
        onBack={() => setDetail(null)}
        onPlay={(item) => setPlayer(item)}
      />
    );
  }

  return (
    <FocusProvider
      rowLengths={lengths}
      initialPosition={initialPosition}
      keyMap={keyMap}
      onSelect={onSelect}
      onAction={dispatch}
    >
      <Home title={title} model={model} />
    </FocusProvider>
  );
}
