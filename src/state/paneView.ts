/* ------------------------------------------------------------------ *
 *  WHAT A PANE IS SHOWING OF ITS BOARD, for a board link to carry
 *  (state/boardLink.ts; owner, 2026-10-29: the view rides in the link,
 *  "yes view state", and is never the board's -- each person keeps
 *  folding and zooming freely).
 *
 *  BoardPane holds its view in component state on purpose (a zoom is per
 *  pane and per session), so nothing outside it could read it. It
 *  PUBLISHES here, and the shelf's Copy link reads what a pane is showing
 *  of the board being linked. The other half is PENDING: a link that
 *  opens leaves the view here and the pane that mounts the board takes
 *  it, once. Folds are not here -- they are already a store (fold.ts).
 * ------------------------------------------------------------------ */

export interface PaneViewState {
  view?: "detail" | "overview";
  /* the Overview's zoom, only when set by hand (fit is the reader's own
   * screen's answer, so a fitted board carries no number) */
  zoom?: number;
  /* a typed board's zoom factor over its fit, when not 1 */
  factor?: number;
  column?: number; // the Overview's column tier
  depth?: number; // how deep the Overview draws; absent = all the way
}

const live = new Map<string, { boardId: string; state: PaneViewState }>();

export function publishPaneView(slot: string, boardId: string | null, state: PaneViewState): void {
  if (boardId) live.set(slot, { boardId, state });
  else live.delete(slot);
}

/* What a pane shows of this board, the left pane first; null when no
 * pane has it open. */
export function paneViewOf(boardId: string): PaneViewState | null {
  for (const slot of ["a", "b"]) {
    const p = live.get(slot);
    if (p?.boardId === boardId) return p.state;
  }
  return null;
}

const pending = new Map<string, PaneViewState>();
export const setPendingView = (boardId: string, state: PaneViewState): void => {
  pending.set(boardId, state);
};
export function takePendingView(boardId: string): PaneViewState | null {
  const p = pending.get(boardId) ?? null;
  pending.delete(boardId);
  return p;
}
