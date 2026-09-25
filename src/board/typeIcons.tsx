import type { BoardStyleId } from "../state/boardStyles";

/* ------------------------------------------------------------------ *
 *  A SYMBOL PER BOARD STYLE (owner, 2026-08-16) -- each drawn as the
 *  SHAPE the board makes, the same way viewIcons.tsx draws the project
 *  views as the window each one produces.
 *
 *  These are meant to travel: the creation picker today, and wherever a
 *  board has to identify itself later -- the Boards menu, and a
 *  nested-board card, which has to say what type it points at without
 *  drawing the board itself.
 * ------------------------------------------------------------------ */

/* ONE PALETTE ACROSS ALL THREE SYMBOLS, named so it cannot drift as the
 * shapes get tuned: DARK is the anchor (a band, a column head, the one
 * card a Free Grid is built around), LIGHT is every ordinary card, and
 * LEAD is the Beat Map's first card in a row -- the only place a third
 * tone earns itself, because a strip reads left to right. */
const DARK = 0.9;
const LEAD = 0.55;
const LIGHT = 0.35;

export function TypeIcon({ id, size = 30 }: { id: BoardStyleId; size?: number }) {
  const p = { fill: "currentColor" };
  if (id === "beatmap")
    return (
      <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden>
        {/* Two bands, each with a lane of cards running across under it.
            Both card rows are the SAME height (owner, 2026-08-16) -- a
            shorter bottom row read as a different kind of thing rather
            than as the same structure repeating, which is the whole
            point of a nested ladder. */}
        <rect x="2" y="2" width="26" height="4" rx="1" {...p} opacity={DARK} />
        <rect x="2" y="8" width="7" height="6" rx="1" {...p} opacity={LEAD} />
        <rect x="11" y="8" width="5" height="6" rx="1" {...p} opacity={LIGHT} />
        <rect x="18" y="8" width="5" height="6" rx="1" {...p} opacity={LIGHT} />
        <rect x="2" y="16" width="26" height="4" rx="1" {...p} opacity={DARK} />
        <rect x="2" y="22" width="7" height="6" rx="1" {...p} opacity={LEAD} />
        <rect x="11" y="22" width="5" height="6" rx="1" {...p} opacity={LIGHT} />
      </svg>
    );
  if (id === "columns")
    return (
      <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden>
        {/* Heads across the top, cards stacking under each. The HEAD is
            taller than a card (owner) so the row reads as a header rather
            than as one more card, and the columns run 3 / 3 / 2 -- an
            uneven last column is what says these are stacks you add to. */}
        {[2, 11, 20].map((x, i) => {
          /* Cards sit at 90% of a head's width and of their own height,
             CENTERED on the same spot -- shrinking from the top-left would
             read as a nudge rather than as a size difference, and the
             point is only that the head is the larger thing. */
          const w = 8 * 0.9;
          const h = 5 * 0.9;
          const cx = x + (8 - w) / 2;
          const cy = (top: number) => top + (5 - h) / 2;
          return (
            <g key={x}>
              <rect x={x} y="2" width="8" height="6" rx="1" {...p} opacity={DARK} />
              <rect x={cx} y={cy(10)} width={w} height={h} rx="1" {...p} opacity={LIGHT} />
              <rect x={cx} y={cy(17)} width={w} height={h} rx="1" {...p} opacity={LIGHT} />
              {i !== 2 && (
                <rect x={cx} y={cy(24)} width={w} height={h} rx="1" {...p} opacity={LIGHT} />
              )}
            </g>
          );
        })}
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden>
      {/* One big card holding the top-left quadrant, smaller ones to its
          right and underneath (owner, 2026-08-16) -- cards at sizes and
          positions you chose, rather than a tidy lattice. Everything
          still lines up on a grid; what varies is the ASPECT of each
          card, which is the distinction this type is actually selling. */}
      <rect x="2" y="3" width="14" height="13" rx="1" {...p} opacity={DARK} />
      <rect x="19" y="3" width="9" height="6" rx="1" {...p} opacity={LIGHT} />
      <rect x="19" y="11" width="9" height="5" rx="1" {...p} opacity={LIGHT} />
      <rect x="2" y="19" width="6" height="7" rx="1" {...p} opacity={LIGHT} />
      <rect x="10" y="19" width="18" height="7" rx="1" {...p} opacity={LIGHT} />
    </svg>
  );
}
