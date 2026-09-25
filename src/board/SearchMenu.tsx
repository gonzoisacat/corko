import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Search,
  Tag,
  Tags,
  Type,
  X,
} from "lucide-react";
import type { Board } from "../state/types";
import { collectMatches, type Match } from "../state/search";
import { useBoardUI } from "./context";
import { useClampToViewport } from "../ui/useClampToViewport";

/* ------------------------------------------------------------------ *
 *  A column's search box, and the menu behind it (2026-08-03).
 *
 *  The box carries its own MATCH COUNT, which is the whole reason the
 *  menu can exist: every bulk action here rewrites tens or hundreds of
 *  cards in one transaction, and pressing that without knowing whether
 *  it is 4 cards or 400 is not a thing anyone should be asked to do.
 *
 *  A match is a card whose OWN title contains the query (state/search.ts)
 *  -- the Overview's rule, deliberately not the detail view's
 *  leaf-only one, because it is the only rule where the number shown is
 *  the number of cards that change. The two views disagree today; closing
 *  that is its own job.
 *
 *  BULK ACTIONS ARE OVERVIEW-ONLY (owner's call). You are meant to be
 *  looking at what you are about to change, and the Overview is the view
 *  that shows every matching card at once. They are not hidden in detail
 *  -- they are shown with the reason, because a control that silently
 *  vanishes reads as a bug.
 * ------------------------------------------------------------------ */

export interface SearchMenuProps {
  board: Board | null;
  query: string;
  onQuery: (v: string) => void;
  matchCase: boolean;
  onMatchCase: (v: boolean) => void;
  /* Bulk actions need the Overview -- the menu says so rather than
   * quietly dropping them. */
  inOverview: boolean;
  /* Step to a match: select it and bring it on screen. */
  onGoTo: (id: string) => void;
  onFindReplace: (matches: Match[]) => void;
  onApplyTag: (matches: Match[], x: number, y: number) => void;
  onRemoveTag: (matches: Match[], x: number, y: number) => void;
  onPasteValues: (matches: Match[], x: number, y: number) => void;
}

export function SearchMenu({
  board,
  query,
  onQuery,
  matchCase,
  onMatchCase,
  inOverview,
  onGoTo,
  onFindReplace,
  onApplyTag,
  onRemoveTag,
  onPasteValues,
}: SearchMenuProps) {
  const [open, setOpen] = useState(false);
  /* Where prev/next has walked to. Reset whenever the match set changes
   * under it -- "3 of 42" pointing into a set that no longer has a third
   * entry is worse than starting over. */
  /* A nesting card matches the name it DRAWS, so the count, the
   * prev/next walk and the bulk actions all need the pane's board index
   * (state/nesting.ts searchTitle). */
  const { nests } = useBoardUI();
  const [at, setAt] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = collectMatches(board, query, matchCase, nests);
  const n = matches.length;

  useEffect(() => setAt(0), [query, matchCase, board?.id]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const anchor = boxRef.current?.getBoundingClientRect();
  const { left, top } = useClampToViewport(ref, anchor?.left ?? 0, (anchor?.bottom ?? 0) + 4, {
    w: 250,
    h: 260,
  });

  const step = (by: number) => {
    if (!n) return;
    const next = (at + by + n) % n;
    setAt(next);
    onGoTo(matches[next].id);
  };

  /* Bulk actions anchor their own popovers to the menu, so they open
   * where you are looking rather than at the card that isn't there. */
  const spot = (): { x: number; y: number } => {
    const r = ref.current?.getBoundingClientRect();
    return { x: r?.left ?? 120, y: r?.top ?? 120 };
  };
  const act = (fn: (m: Match[], x: number, y: number) => void) => () => {
    const { x, y } = spot();
    setOpen(false);
    fn(matches, x, y);
  };

  return (
    <div className="pane-search-wrap" ref={boxRef}>
      <div className={"pane-search" + (open ? " open" : "")}>
        <Search size={13} />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Find a card..."
          aria-label="Find a card in this board"
        />
        {/* the count IS the blast radius; it sits on the box, not buried
            in the menu, so it is visible before you open anything */}
        {query && (
          <span className="pane-search-count mono" title={`${n} cards match`}>
            {n}
          </span>
        )}
        {/* tip-left on these two: in a split the search box sits at
            pane B's right edge, where a centered tip clips (right edges
            flush is safe at any position) */}
        {query && (
          <button className="clear tip-left" aria-label="Clear the filter" data-tip="Clear the filter" onClick={() => onQuery("")}>
            <X size={12} />
          </button>
        )}
        <button
          className="pane-search-more tip-left"
          data-tip="Search options"
          aria-label="Search options"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown size={13} />
        </button>
      </div>

      {open && (
        <div className="search-menu" ref={ref} style={{ left, top, width: 250 }}>
          <div className="search-menu-head">
            <span>{query ? `${n} ${n === 1 ? "card matches" : "cards match"}` : "Type to search"}</span>
            <button
              className={"search-case" + (matchCase ? " active" : "")}
              data-tip="Match case"
              aria-pressed={matchCase}
              onClick={() => onMatchCase(!matchCase)}
            >
              Aa
            </button>
          </div>

          <div className="search-menu-nav">
            <button disabled={!n} aria-label="Previous match" data-tip="Previous match" onClick={() => step(-1)}>
              <ChevronLeft size={14} />
            </button>
            <span className="mono">{n ? `${at + 1} of ${n} · in cut order` : "no matches"}</span>
            <button disabled={!n} aria-label="Next match" data-tip="Next match" onClick={() => step(1)}>
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="search-menu-sep" />
          <div className="search-menu-group mono">
            {n ? `All ${n} matches` : "All matches"}
          </div>

          {/* Find and replace leads (owner's call): it is the one people
              reach for, and it is the only item that changes the cards'
              own text rather than what is attached to them. */}
          <button className="ctx-item" disabled={!n || !inOverview} onClick={act((m) => onFindReplace(m))}>
            <Type size={14} /> Find and replace...
          </button>
          <button className="ctx-item" disabled={!n || !inOverview} onClick={act(onApplyTag)}>
            <Tag size={14} /> Apply tag...
          </button>
          <button className="ctx-item" disabled={!n || !inOverview} onClick={act(onRemoveTag)}>
            <Tags size={14} /> Remove tag...
          </button>
          <button className="ctx-item" disabled={!n || !inOverview} onClick={act(onPasteValues)}>
            <ClipboardPaste size={14} /> Paste metadata values...
          </button>

          {!inOverview && (
            <div className="search-menu-note">
              Bulk actions need Overview -- you should be looking at what you are about to change.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
