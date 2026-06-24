/**
 * App root: fetch the effective config, apply the theme, and render the home
 * shell under the focus engine.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Config } from '@openhearth/shared';
import { fetchConfig } from './api';
import { FocusProvider } from './focus/FocusProvider';
import { buildHomeModel, rowLengths } from './home/homeModel';
import { Home } from './home/Home';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; config: Config };

export function App(): ReactNode {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal)
      .then((res) => setState({ status: 'ready', config: res.config }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ status: 'error', message: String(err) });
      });
    return () => controller.abort();
  }, []);

  // Theme is configurable via ui.theme; default dark.
  useEffect(() => {
    const theme = state.status === 'ready' ? (state.config.ui?.theme ?? 'dark') : 'dark';
    document.documentElement.dataset.theme = theme;
  }, [state]);

  if (state.status === 'loading') {
    return (
      <div className="app-shell">
        <div className="home__empty">Loading…</div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="app-shell">
        <div className="home__empty">Couldn’t load configuration</div>
      </div>
    );
  }

  const model = buildHomeModel(state.config);
  const title = state.config.ui?.title ?? 'OpenHearth';
  // Focus enters on the first tile of the first content row (row 1; row 0 is the
  // header), matching the Home screen focus-entry spec.
  const initialPosition = model.rows.length > 1 ? { row: 1, col: 0 } : undefined;

  return (
    <FocusProvider rowLengths={rowLengths(model)} initialPosition={initialPosition}>
      <Home title={title} model={model} />
    </FocusProvider>
  );
}
