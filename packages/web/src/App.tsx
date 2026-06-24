/**
 * App root: fetch the effective config, apply the theme, and render the home
 * shell under the focus engine.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Config, ServiceCatalog } from '@openhearth/shared';
import { fetchConfig, fetchServices } from './api';
import { FocusProvider } from './focus/FocusProvider';
import type { FocusPosition } from './focus/focusEngine';
import { buildHomeModel, rowLengths, firstContentRow, type HomeModel } from './home/homeModel';
import { Home } from './home/Home';
import { launchService, defaultNavigate, type Navigate } from './launch';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; config: Config; catalog: ServiceCatalog };

const EMPTY_CATALOG: ServiceCatalog = { groups: [], errors: [] };

/** Navigation is injectable so tests can assert the launch target. */
export function App({ navigate = defaultNavigate }: { navigate?: Navigate } = {}): ReactNode {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      const config = await fetchConfig(controller.signal);
      // The catalog is non-essential to boot — fall back to empty on failure so
      // the shell still renders (NFR-4 spirit).
      const catalog = await fetchServices(controller.signal).catch((err: unknown) => {
        console.error('OpenHearth: failed to load services', err);
        return EMPTY_CATALOG;
      });
      setState({ status: 'ready', config: config.config, catalog });
    };
    load().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('OpenHearth: failed to load config', err);
      setState({ status: 'error', message: String(err) });
    });
    return () => controller.abort();
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
    <ReadyApp title={title} model={model} initialPosition={initialPosition} navigate={navigate} />
  );
}

/** The ready home, split out so `onSelect` can close over a stable `model`. */
function ReadyApp({
  title,
  model,
  initialPosition,
  navigate,
}: {
  title: string;
  model: HomeModel;
  initialPosition: FocusPosition | undefined;
  navigate: Navigate;
}): ReactNode {
  const lengths = useMemo(() => rowLengths(model), [model]);

  // select (Enter) on a focused service tile launches that service (FR-A2).
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
    <FocusProvider rowLengths={lengths} initialPosition={initialPosition} onSelect={onSelect}>
      <Home title={title} model={model} />
    </FocusProvider>
  );
}
