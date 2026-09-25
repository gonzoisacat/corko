import { memo } from "react";
import { CELL, YARN_PICKED_RATIO, YARN_SHADOW_RATIO, yarnWidth } from "../../state/gridBoard";

/* ------------------------------------------------------------------ *
 *  THE STRING BETWEEN TWO PINS.
 *
 *  Drawn as one SVG across the whole sheet, OVER the cards (owner,
 *  2026-08-25). It went under first, for legibility -- a string across a
 *  card's face cuts its title in half -- but that is not what string
 *  does, and on this board the physical truth is the point. Above the
 *  cards, below a card being DRAGGED, so the one you are holding stays
 *  on top of its own strings.
 *
 *  The cost is that `.yarn-hit`'s invisible band now lies over the card
 *  faces, and every pixel of it takes a click away from the card
 *  underneath -- which is why it is 10px rather than the 16 it could
 *  afford when it floated over bare cork.
 *
 *  IT SAGS, and that is most of what makes it read as yarn rather than
 *  as a connector in a diagramming tool. A quadratic curve whose control
 *  point hangs below the midpoint by a fraction of the span -- so a
 *  short string is nearly taut and a long one droops, which is how
 *  string behaves. Capped, or a very long run would loop off the board.
 * ------------------------------------------------------------------ */

export interface YarnLine {
  id: string;
  color: string;
  width?: number; // absent = the default (state/gridBoard.ts yarnWidth)
  /* Connections mode: this string joins nothing selected, so it fades
   * while the followed ones stay at full strength. */
  dim?: boolean;
  x1: number; // in CELLS, fractional -- the pin positions
  y1: number;
  x2: number;
  y2: number;
}

/* The sag, in cells. A fraction of the run so it scales with distance,
 * with a floor (a string between neighbours still hangs a little) and a
 * ceiling (a board-wide run should not swing down past the cards). */
export function sagPath(l: YarnLine): string {
  const x1 = l.x1 * CELL;
  const y1 = l.y1 * CELL;
  const x2 = l.x2 * CELL;
  const y2 = l.y2 * CELL;
  const run = Math.hypot(x2 - x1, y2 - y1);
  const sag = Math.min(64, Math.max(6, run * 0.14));
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2 + sag * 2; // quadratic peaks at half the control offset
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

/* A line's stroke width -- one call, so the three paths of a string
 * cannot disagree about how thick it is. */
const w = (l: YarnLine) => yarnWidth(l);

interface Props {
  lines: YarnLine[];
  /* The string being pulled right now, if any -- drawn dashed, because
   * it is not tied to anything yet. */
  pulling: YarnLine | null;
  selected: string | null;
  width: number; // sheet size in px, so the SVG covers the whole board
  height: number;
  onPick: (id: string, x: number, y: number) => void;
}

export const Yarn = memo(function Yarn({
  lines,
  pulling,
  selected,
  width,
  height,
  onPick,
}: Props) {
  return (
    <svg className="grid-yarn" width={width} height={height} aria-hidden={lines.length === 0}>
      {lines.map((l) => {
        const d = sagPath(l);
        return (
          <g
            key={l.id}
            className={"yarn" + (selected === l.id ? " picked" : "") + (l.dim ? " dim" : "")}
          >
            {/* A FAT INVISIBLE STROKE under each string: a 3px line is
                nearly impossible to hit with a mouse, and the alternative
                (a wider visible line) would look like rope. */}
            {/* ON CLICK, NOT POINTERDOWN, and the difference is a real
                trap rather than a preference. React flushes a discrete
                event's updates synchronously, so a menu opened from
                pointerdown has already mounted -- and attached its own
                close-on-outside-mousedown listener -- by the time the
                SAME physical click's mousedown arrives. The menu opened
                and shut itself in one press, which looked exactly like
                the click never landing. */}
            <path
              className="yarn-hit"
              d={d}
              onClick={(e) => {
                e.stopPropagation();
                onPick(l.id, e.clientX, e.clientY);
              }}
            />
            {/* WIDTHS ARE INLINE, not CSS, since they are per string
                now (state/gridBoard.ts YARN_WIDTHS). The shadow and the
                picked lift keep their old ratios to the line, so a thick
                string has the same proportions a thin one does. */}
            <path className="yarn-shadow" d={d} strokeWidth={w(l) * YARN_SHADOW_RATIO} />
            <path
              className="yarn-line"
              d={d}
              stroke={l.color}
              strokeWidth={selected === l.id ? w(l) * YARN_PICKED_RATIO : w(l)}
            />
          </g>
        );
      })}
      {pulling && (
        <path
          className="yarn-pulling"
          d={sagPath(pulling)}
          stroke={pulling.color}
          strokeWidth={w(pulling)}
        />
      )}
    </svg>
  );
});
