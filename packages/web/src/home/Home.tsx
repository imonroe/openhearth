/**
 * Home screen — renders the configured rows (real service tiles + library
 * browse tiles) driven by directional focus.
 */
import type { ReactNode } from 'react';
import type { HomeModel } from './homeModel';
import { Header } from './Header';
import { ServiceTileView } from './ServiceTileView';
import { LibraryTileView } from './LibraryTileView';
import { SeeAllTileView } from './SeeAllTileView';
import { RowStrip } from './RowStrip';
import { entryId } from '../library/libraryModel';

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
                <RowStrip>
                  {row.kind === 'services' ? (
                    row.tiles.length === 0 ? (
                      <span className="row__empty">No services in this group</span>
                    ) : (
                      row.tiles.map((tile, col) => (
                        <ServiceTileView key={tile.id} tile={tile} row={rowIndex} col={col} />
                      ))
                    )
                  ) : row.kind === 'library' ? (
                    row.entries.length === 0 ? (
                      <span className="row__empty">No media indexed yet</span>
                    ) : (
                      <>
                        {/* "See all" leads the row (col 0); entries follow at col 1+. */}
                        {row.seeAll ? (
                          <SeeAllTileView count={row.entries.length} row={rowIndex} col={0} />
                        ) : null}
                        {row.entries.map((entry, index) => (
                          <LibraryTileView
                            key={entryId(entry)}
                            entry={entry}
                            row={rowIndex}
                            col={row.seeAll ? index + 1 : index}
                          />
                        ))}
                      </>
                    )
                  ) : null}
                </RowStrip>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}
