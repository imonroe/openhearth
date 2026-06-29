/**
 * Library detail screen (design-system §13 "Movie Detail" / "TV Show Detail").
 *
 * A movie/other entry shows a poster + title + meta + a Play CTA. A show entry
 * shows season tabs and an episode list. Selecting Play (movie) or an episode
 * (show) dispatches the client-agnostic `play_item` action through the control
 * path — the same vocabulary a phone remote uses; the native player itself
 * lands in #35. Each detail screen runs under its own FocusProvider; Back
 * returns to the home screen.
 *
 * The poster shows the metadata artwork (#42) when resolved, falling back to a
 * title-initial placeholder; both fill the same frame so there's no layout shift.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ActionName, LibraryItem, MediaItem } from '@openhearth/shared';
import { FocusProvider, useFocus } from '../focus/FocusProvider';
import type { FocusPosition } from '../focus/focusEngine';
import type { KeyMap } from '../keybindings';
import { fetchItemMetadata } from '../api';
import { formatRuntime, formatRating } from './detailMeta';
import {
  episodesInSeason,
  entryArtworkUrl,
  isShow,
  type LibraryEntry,
  type ShowGroup,
} from '../library/libraryModel';

type Dispatch = (action: ActionName, params?: Record<string, unknown>) => void;
type OnPlay = (item: LibraryItem) => void;

interface DetailProps {
  entry: LibraryEntry;
  keyMap: KeyMap;
  dispatch: Dispatch;
  onBack: () => void;
  onPlay: OnPlay;
}

export function LibraryDetail({ entry, keyMap, dispatch, onBack, onPlay }: DetailProps): ReactNode {
  return isShow(entry) ? (
    <ShowDetail show={entry} keyMap={keyMap} dispatch={dispatch} onBack={onBack} onPlay={onPlay} />
  ) : (
    <MovieDetail
      entry={entry}
      keyMap={keyMap}
      dispatch={dispatch}
      onBack={onBack}
      onPlay={onPlay}
    />
  );
}

/** Poster: metadata artwork when resolved, else the title's initial. */
function Poster({
  title,
  artworkUrl,
  className,
}: {
  title: string;
  artworkUrl: string | undefined;
  className: string;
}): ReactNode {
  const [failed, setFailed] = useState(false);
  const src = failed ? undefined : artworkUrl;
  return (
    <div className={className}>
      {src ? (
        <img
          className="detail__poster-art"
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="detail__poster-initial" aria-hidden="true">
          {title.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

function MovieDetail({
  entry,
  keyMap,
  dispatch,
  onBack,
  onPlay,
}: {
  entry: Exclude<LibraryEntry, ShowGroup>;
  keyMap: KeyMap;
  dispatch: Dispatch;
  onBack: () => void;
  onPlay: OnPlay;
}): ReactNode {
  const onSelect = useCallback(() => {
    dispatch('play_item', { id: entry.id });
    onPlay(entry);
  }, [dispatch, entry, onPlay]);

  // Fetch richer metadata (overview, runtime, genres, cast, …) when the screen
  // opens (#123). Best-effort: a failure or no provider just leaves the basic
  // view (title + year + Play). The server caches the result, so re-opening is
  // instant and costs no provider call.
  const meta = useItemMetadata(entry.id);

  // Compose the submeta line from whatever resolved: year · runtime · ★ rating.
  const runtime = formatRuntime(meta?.runtime_minutes);
  const rating = formatRating(meta?.rating);
  const submeta = [
    entry.year != null ? String(entry.year) : '',
    runtime,
    rating ? `★ ${rating}` : '',
  ].filter(Boolean);

  return (
    <FocusProvider
      rowLengths={[1]}
      initialPosition={{ row: 0, col: 0 }}
      keyMap={keyMap}
      onSelect={onSelect}
      onBack={onBack}
      onAction={dispatch}
    >
      <div className="detail" role="region" aria-label={`${entry.title} detail`}>
        <button type="button" className="detail__back" onClick={onBack}>
          ← Back
        </button>
        <div className="detail__body">
          <Poster
            title={entry.title}
            artworkUrl={entryArtworkUrl(entry) ?? meta?.artwork?.poster_url}
            className="detail__poster"
          />
          <div className="detail__meta">
            <h1 className="detail__title">{entry.title}</h1>
            {submeta.length > 0 ? (
              <div className="detail__submeta">{submeta.join(' · ')}</div>
            ) : null}
            {meta?.genres && meta.genres.length > 0 ? (
              <div className="detail__genres" aria-label="Genres">
                {meta.genres.map((g) => (
                  <span key={g} className="detail__genre">
                    {g}
                  </span>
                ))}
              </div>
            ) : null}
            {meta?.tagline ? <div className="detail__tagline">{meta.tagline}</div> : null}
            <div className="detail__cta-row">
              <PlayButton row={0} col={0} label="Play" />
            </div>
            {meta?.overview ? <p className="detail__overview">{meta.overview}</p> : null}
            {meta?.directors && meta.directors.length > 0 ? (
              <div className="detail__credit">
                <span className="detail__credit-label">
                  {meta.directors.length === 1 ? 'Director' : 'Directors'}
                </span>{' '}
                {meta.directors.join(', ')}
              </div>
            ) : null}
            {meta?.cast && meta.cast.length > 0 ? (
              <div className="detail__cast">
                <div className="detail__credit-label">Cast</div>
                <ul className="detail__cast-list">
                  {meta.cast.map((c) => (
                    <li key={`${c.name}:${c.character ?? ''}`} className="detail__cast-member">
                      <span className="detail__cast-name">{c.name}</span>
                      {c.character ? (
                        <span className="detail__cast-character"> as {c.character}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </FocusProvider>
  );
}

/** Fetch an item's rich metadata on open; null until/unless it resolves. */
function useItemMetadata(id: string): MediaItem | null {
  const [meta, setMeta] = useState<MediaItem | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setMeta(null);
    void fetchItemMetadata(id, controller.signal).then((m) => {
      if (!controller.signal.aborted) setMeta(m);
    });
    return () => controller.abort();
  }, [id]);
  return meta;
}

function ShowDetail({
  show,
  keyMap,
  dispatch,
  onBack,
  onPlay,
}: {
  show: ShowGroup;
  keyMap: KeyMap;
  dispatch: Dispatch;
  onBack: () => void;
  onPlay: OnPlay;
}): ReactNode {
  // The focused season tab drives which season's episodes are shown. Holding the
  // index above the FocusProvider lets us recompute the grid's row lengths; the
  // provider preserves focus when only the (unfocused) episode row changes.
  // Known minor wart: moving Up from an episode lands on the season tab at the
  // episode's column (the engine preserves column), which may differ from the
  // season being browsed; behaviour stays self-consistent (the list follows the
  // focused tab). A column-memory refinement is a follow-up.
  const [seasonIdx, setSeasonIdx] = useState(0);
  const season = show.seasons[seasonIdx] ?? show.seasons[0] ?? 1;
  const episodes = episodesInSeason(show, season);
  const rowLengths = [show.seasons.length, episodes.length];

  const onFocusChange = useCallback((pos: FocusPosition) => {
    if (pos.row === 0) setSeasonIdx(pos.col);
  }, []);

  const onSelect = useCallback(
    (pos: FocusPosition) => {
      if (pos.row === 1) {
        const ep = episodes[pos.col];
        if (ep) {
          dispatch('play_item', { id: ep.id });
          onPlay(ep);
        }
      }
    },
    [episodes, dispatch, onPlay],
  );

  return (
    <FocusProvider
      rowLengths={rowLengths}
      initialPosition={{ row: 0, col: 0 }}
      keyMap={keyMap}
      onSelect={onSelect}
      onBack={onBack}
      onAction={dispatch}
      onFocusChange={onFocusChange}
    >
      <div className="detail" role="region" aria-label={`${show.title} detail`}>
        <button type="button" className="detail__back" onClick={onBack}>
          ← Back
        </button>
        <div className="detail__show-head">
          <Poster
            title={show.title}
            artworkUrl={show.artwork_url}
            className="detail__poster detail__poster--show"
          />
          <div className="detail__meta">
            <h1 className="detail__title">{show.title}</h1>
            <div className="detail__submeta">
              {show.seasons.length} season{show.seasons.length === 1 ? '' : 's'}
              {show.year != null ? ` · ${show.year}` : ''}
            </div>
          </div>
        </div>

        <div className="detail__seasons" role="tablist" aria-label="Seasons">
          {show.seasons.map((s, col) => (
            <SeasonTab key={s} season={s} col={col} />
          ))}
        </div>

        <div className="detail__episodes" role="list" aria-label={`Season ${season} episodes`}>
          {episodes.length === 0 ? (
            <span className="row__empty">No episodes</span>
          ) : (
            episodes.map((ep, col) => (
              <EpisodeCard
                key={ep.id}
                col={col}
                number={ep.episode ?? col + 1}
                title={ep.episode_title ?? `Episode ${ep.episode ?? col + 1}`}
              />
            ))
          )}
        </div>
      </div>
    </FocusProvider>
  );
}

function PlayButton({ row, col, label }: { row: number; col: number; label: string }): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const className = ['detail__play', isFocused(row, col) ? 'is-focused' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={className}
      role="button"
      aria-label={label}
      onMouseEnter={() => focusAt({ row, col })}
      onClick={() => activate({ row, col })}
    >
      <span aria-hidden="true">▶</span> {label}
    </div>
  );
}

function SeasonTab({ season, col }: { season: number; col: number }): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const focused = isFocused(0, col);
  const className = ['detail__season-tab', focused ? 'is-focused' : ''].filter(Boolean).join(' ');
  return (
    <div
      className={className}
      role="tab"
      aria-selected={focused}
      onMouseEnter={() => focusAt({ row: 0, col })}
      onClick={() => activate({ row: 0, col })}
    >
      Season {season}
    </div>
  );
}

function EpisodeCard({
  col,
  number,
  title,
}: {
  col: number;
  number: number;
  title: string;
}): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const focused = isFocused(1, col);
  const className = ['detail__episode', focused ? 'is-focused' : ''].filter(Boolean).join(' ');
  return (
    <div
      className={className}
      role="listitem"
      onMouseEnter={() => focusAt({ row: 1, col })}
      onClick={() => activate({ row: 1, col })}
    >
      <div className="detail__episode-thumb">
        <span className="detail__episode-num" aria-hidden="true">
          {number}
        </span>
      </div>
      <div className="detail__episode-title">{title}</div>
    </div>
  );
}
