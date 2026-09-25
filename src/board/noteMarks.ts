import { useEffect, useMemo } from "react";
import type { Board, Node } from "../state/types";
import { notesRead, useNotesReadVersion } from "../state/notesRead";
import { noteEditing } from "./cardPanels";

/* ------------------------------------------------------------------ *
 *  The unread ring on a card's note dot, painted in CSS rather than by
 *  React -- the same mechanism and the same reason as legendHighlight and
 *  dropTarget: the Overview isn't virtualized, so a board has thousands of
 *  cards mounted at once and threading one more changing prop through
 *  every proxy would re-render all of them every time a note is read.
 *
 *  Read state changes on a CLICK (opening a thread, stepping onto a note),
 *  so a re-render pass over 3200 proxies would be a visible stutter for a
 *  mark that decorates a 7px dot.
 *
 *  Every dot carries `data-note-host="<nodeId>"`; this injects one rule
 *  naming the hosts that have something unread. The dot's own attribute
 *  rather than the card's `[data-node]` because a card's data-node element
 *  can CONTAIN other cards -- an Overview `.ov-block` for a Day holds all
 *  its scenes -- so a descendant selector would ring every dot beneath it.
 *  The same trap as rule 2 of the drag work.
 * ------------------------------------------------------------------ */

let styleEl: HTMLStyleElement | null = null;
let painted = "";

function sheet(): HTMLStyleElement {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.dataset.corko = "note-marks";
    document.head.appendChild(styleEl);
  }
  return styleEl;
}

/* `.note-dot.note-dot[...]` -- 0-3-0 on purpose. `.note-dot.resolved`
 * (0-2-0) sets `box-shadow: none`, and an injected sheet's position in the
 * document is not something to rely on for a same-specificity tie: a
 * source-order tie is how the drop marker went invisible under the Tactile
 * look, and how `background-attachment` silently stopped applying. Out-rank
 * it instead of racing it. */
/* THE PULSE (2026-09-08): the card whose note is being written. The dot
 * scales slowly; a card with no notes yet renders a hidden `pending` dot
 * (NoteDot) that this rule shows, so a first note's card is findable
 * too. `scale` rather than a transform so the Overview miniatures' own
 * inline counter-scale still holds. One subscription, module-level --
 * never one per card (the Overview renders thousands). */
let pulseEl: HTMLStyleElement | null = null;
let pulsePainted = "";
export function paintEditing(nodeId: string | null): void {
  const css = nodeId
    ? `.note-dot.note-dot[data-note-host="${CSS.escape(nodeId)}"] { display: block; animation: note-pulse 1.8s ease-in-out infinite; }`
    : "";
  if (css === pulsePainted) return;
  pulsePainted = css;
  if (!pulseEl) {
    pulseEl = document.createElement("style");
    pulseEl.dataset.corko = "note-pulse";
    document.head.appendChild(pulseEl);
  }
  pulseEl.textContent = css;
}
if (typeof document !== "undefined") {
  noteEditing.subscribe(() => paintEditing(noteEditing.get()));
}

export function paintUnread(nodeIds: string[]): void {
  const css = nodeIds.length
    ? `${nodeIds
        .map((id) => `.note-dot.note-dot[data-note-host="${CSS.escape(id)}"]`)
        .join(",\n")} { box-shadow: var(--note-unread-ring); }`
    : "";
  if (css === painted) return;
  painted = css;
  sheet().textContent = css;
}

/* The cards in these boards that carry at least one unread note. One walk
 * per board, memoized on the board's identity -- structural sharing keeps
 * that stable, so this re-runs when a board actually changes rather than on
 * every unrelated render. */
function unreadHosts(boards: (Board | null)[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.notes?.length && !seen.has(n.id) && n.notes.some((x) => notesRead.isUnread(x))) {
        seen.add(n.id);
        ids.push(n.id);
      }
      if (n.children.length) walk(n.children);
    }
  };
  for (const b of boards) if (b) walk(b.roots);
  return ids;
}

/* Called ONCE, from App, with whatever boards are on screen. */
export function useUnreadMarks(boards: (Board | null)[]): void {
  const v = useNotesReadVersion();
  const key = boards.map((b) => b?.id ?? "-").join("|");
  const hosts = useMemo(
    () => unreadHosts(boards),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, boards[0], boards[1], v],
  );
  useEffect(() => paintUnread(hosts), [hosts]);
}
