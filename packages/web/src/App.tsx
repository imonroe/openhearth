/**
 * App root: fetch the effective config, apply the theme, and render the home
 * shell under the focus engine.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ActionName, Config, ServiceCatalog } from '@openhearth/shared';
import { fetchConfig, fetchServices, sendCommand } from './api';
import { FocusProvider } from './focus/FocusProvider';
import type { FocusPosition } from './focus/focusEngine';
import { buildKeyMap } from './keybindings';
import { buildHomeModel, rowLengths, firstContentRow, type HomeModel } from './home/homeModel';
import { Home } from './home/Home';
import { launchService, defaultNavigate, type Navigate } from './launch';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; config: Config; catalog: ServiceCatalog };

const EMPTY_CATALOG: ServiceCatalog = { groups: [], errors: [] };

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
        setState({ status: 'ready', config: config.config, catalog });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('OpenHearth: failed to load config', err);
        // Only surface a fatal error on the first load; a failed background
        // refresh keeps the last-good UI.
        if (initial) setState({ status: 'error', message: String(err) });
      }
    };
    void load(true);

    // Re-fetch config when the kiosk page becomes visible again, so a hot-edited
    // keybinding (server hot-reload) takes effect without a restart (FR-R4).
    // (Returning from a launched service is a full page reload, which also
    // re-fetches; this covers edits made while staying on the home screen.)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
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
  const model = useMemo(
    () => (config ? buildHomeModel(config, catalog ?? undefined) : null),
    [config, catalog],
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

  // select on a focused service tile launches that service (FR-A2).
  const onSelect = useCallback(
    (pos: FocusPosition) => {
      const row = model.rows[pos.row];
      if (row?.kind === 'services') {
        const tile = row.tiles[pos.col];
        if (tile) launchService(tile, navigate);
      }
      // Header / library selections are wired in later phases.
    },
    [model, navigate],
  );

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
