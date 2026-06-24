/**
 * Home screen — renders the configured rows (real service tiles, placeholder
 * library tiles) driven by directional focus.
 */
import type { ReactNode } from 'react';
import type { HomeModel } from './homeModel';
import { Header } from './Header';
import { Tile } from './Tile';
import { ServiceTileView } from './ServiceTileView';

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
            const label = 'label' in row ? row.label : undefined;
            return (
              <section className="row" key={`${row.kind}-${label ?? index}-${rowIndex}`} role="row">
                {label ? <h2 className="row__header">{label}</h2> : null}
                <div className="row__strip">
                  {row.kind === 'services' ? (
                    row.tiles.length === 0 ? (
                      <span className="row__empty">No services in this group</span>
                    ) : (
                      row.tiles.map((tile, col) => (
                        <ServiceTileView key={tile.id} tile={tile} row={rowIndex} col={col} />
                      ))
                    )
                  ) : (
                    Array.from({ length: row.itemCount }, (_, col) => (
                      <Tile key={col} kind="library" row={rowIndex} col={col} />
                    ))
                  )}
                </div>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}
