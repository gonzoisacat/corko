/* ------------------------------------------------------------------ *
 *  Project View icons: each mode drawn as the SHAPE OF THE WINDOW it
 *  makes, so the dropdown reads without the labels.
 *
 *    Single -- one pane, its bar filled in.
 *    Split  -- lucide's Columns2: the divider down the middle.
 *    Notes  -- lucide's PanelRight: the same divider moved right, because
 *              that's exactly what the notes column is.
 *    Player -- PanelRight's frame with a play triangle in the right
 *              panel: the same column, holding a picture that moves.
 *
 *  Only Single is hand-drawn (nothing in the set fills the bar). It
 *  follows lucide's conventions -- 24x24, 2px round-joined strokes on
 *  currentColor -- so it sits beside the other two without looking
 *  imported from somewhere else.
 * ------------------------------------------------------------------ */

export function ViewSingleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      {/* the pane's own bar: the top ~17% of the frame, solid */}
      <path
        d="M5 3.6h14A1.4 1.4 0 0 1 20.4 5v1.7H3.6V5A1.4 1.4 0 0 1 5 3.6z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function ViewPlayerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M11 3v18" />
      {/* the play triangle, filled, in the right-hand panel */}
      <path d="M14.5 9.2v5.6l4.4-2.8z" fill="currentColor" stroke="none" />
    </svg>
  );
}
