/**
 * Home screen — renders the configured rows with placeholder tiles, driven by
 * directional focus.
 */
import type { ReactNode } from 'react';
import type { HomeModel } from './homeModel';
import { Header } from './Header';
import { Tile } from './Tile';

export function Home({ title, model }: { title: string; model: HomeModel }): ReactNode {
  // Row 0 is the header; content rows follow.
  const contentRows = model.rows.slice(1);

  return (
    <div className="app-shell">
      <Header title={title} />
      <main className="home" role="grid" aria-label="Home">
        {contentRows.length === 0 ? (
          <div className="home__empty">No rows configured</div>
        ) : (
          contentRows.map((row, index) => {
            const rowIndex = index + 1; // account for the header row at 0
            return (
              <section className="row" key={`${row.kind}-${row.label}-${rowIndex}`} role="row">
                {row.label ? <h2 className="row__header">{row.label}</h2> : null}
                <div className="row__strip">
                  {Array.from({ length: row.itemCount }, (_, col) => (
                    <Tile
                      key={col}
                      kind={row.kind === 'library' ? 'library' : 'services'}
                      row={rowIndex}
                      col={col}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}
