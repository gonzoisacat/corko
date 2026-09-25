import { useEffect, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import { usePanelFlip } from "../ui/usePanelFlip";
import { tierCounts } from "../state/counts";
import { liveEdges } from "../state/gridBoard";
import { hasPicture } from "./cardImage";
import type { Board } from "../state/types";

/* Board counts, tucked into a small popover (a per-tier tally) rather than
 * a cramped, wrapping string in the bar. Per board, so it lives with the
 * pane's chrome. */
export function StatsMenu({ board }: { board: Board | null }) {
  const [open, setOpen] = useState(false);
  // O(total nodes) -- only walk the tree while the popover is open
  const counts = open && board ? tierCounts(board) : [];
  const ref = useRef<HTMLDivElement>(null);
  const panel = usePanelFlip(open);

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

  return (
    <div className="options" ref={ref}>
      <button
        className={"pane-btn icon-only" + (open ? " active" : "")}
        aria-label="Board stats" data-tip="Board stats"
        onClick={() => setOpen((o) => !o)}
      >
        <BarChart3 size={15} />
      </button>
      {open && board && (
        <div className={"options-panel stats-panel" + (panel.flip ? " flip" : "")} ref={panel.ref}>
          <div className="options-title mono">Board stats</div>
          {board.type === "grid" ? (
            /* A GRID'S OWN VOCABULARY (2026-08-29). Its one-rung ladder
               honestly has one row, but that row says almost nothing
               about a conspiracy wall -- what this board counts is its
               strings, its pictures, and the cards nothing is tied to
               yet, which is the worklist reading of a clue wall. */
            (() => {
              const cards = board.roots;
              const edges = liveEdges(board);
              const tied = new Set(edges.flatMap((e) => [e.from, e.to]));
              const rows: [string, number][] = [
                [`Card${cards.length === 1 ? "" : "s"}`, cards.length],
                [`String${edges.length === 1 ? "" : "s"}`, edges.length],
                ["With images", cards.filter((c) => hasPicture(c)).length],
                ["Unconnected", cards.filter((c) => !tied.has(c.id)).length],
              ];
              return rows.map(([label, n]) => (
                <div className="options-row" key={label}>
                  <span>{label}</span>
                  <span className="mono stats-count">{n}</span>
                </div>
              ));
            })()
          ) : (
            board.levels.map((l, i) => (
              <div className="options-row" key={l.id}>
                <span>
                  {l.name}
                  {(counts[i] ?? 0) === 1 ? "" : "s"}
                </span>
                <span className="mono stats-count">{counts[i] ?? 0}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
