import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Plus } from "lucide-react";
import type { LegendEntry, LevelDef } from "../state/types";
import { ops } from "../state/useBoard";
import { useBoardUI } from "./context";
import { openNew } from "./autoEdit";
import { dragStore } from "./drag";
import { useIsDropAtSeam } from "./dropTarget";
import { type SeamSpec } from "./seam";
import { resolveNodeEntry, textColor } from "../colors";

/* The seam's on-screen half (board/seam.ts is the arithmetic): a
 * zero-height element anchored to its card, a thin hit strip in the gap,
 * and the staircase of tier discs -- ALL hover-revealed: nothing stands
 * at rest (owner, 2026-08-07: "no plusses visible until you hover").
 *
 * Two mounts, one component:
 *  - "flow": an in-flow sibling directly after a lane's head inside the
 *    row. Its static position IS the head's bottom edge, so the row's
 *    padding-bottom can open room below without moving it -- and it is
 *    not inside the draggable head, so it needs no drag guard. (It
 *    cannot live inside the head: `.lane-card` is overflow: hidden.)
 *  - "card": absolutely positioned inside `.scene-label`, the one
 *    element whose bottom edge is the scene card's bottom (the card is
 *    align-self: center in a row sized by its beat strip, so the row's
 *    edge is somewhere else entirely -- measuring that distance is what
 *    this design deleted). Lives inside a DRAGGABLE card, hence the
 *    dead-drag handling below.
 *
 * `above` flips the seam to hang over the card instead: the board-head
 * form (see seam.ts). The room then opens as padding-TOP, which slides
 * seam and card down together -- the anchor holds through the open.
 *
 * The open itself is real layout: `.row:has(.seam.open)` grows padding
 * and virtua re-measures, exactly the mechanism the drag preview uses --
 * and since 2026-08-07 the drag preview IS this seam too: when the
 * published drop target matches one of the seam's addresses it sets
 * `drop-open`, the row pads open, and the row's ::before draws the
 * dashed shelf in the room. One gap element, both openers. */
export function RowSeam({
  spec,
  levels,
  legend,
  rowDepth,
  variant,
  above = false,
  tilt = 0,
}: {
  spec: SeamSpec;
  levels: LevelDef[];
  legend: LegendEntry[];
  /* The row's own depth: the indent origin. Disc for tier t lands at
   * screen x = t * 20 regardless of which row renders it. */
  rowDepth: number;
  variant: "flow" | "card";
  above?: boolean;
  /* Tactile card tilt, counter-rotated so the discs stay level. */
  tilt?: number;
}) {
  const { boardId } = useBoardUI();
  const [open, setOpen] = useState(false);
  const [showing, setShowing] = useState<number | null>(null);

  /* Is the live drop target one of this seam's addresses? If so the row
   * opens and draws the shelf (CSS keys on these classes). */
  const gap = useIsDropAtSeam(boardId, spec.drops);

  /* A drag hides the hit strip and discs (display: none), which can
   * swallow the mouseleave -- close explicitly or the row is left
   * padded open under the drag's own preview. */
  useEffect(
    () =>
      dragStore.subscribe(() => {
        if (dragStore.get()) {
          setOpen(false);
          setShowing(null);
        }
      }),
    [],
  );

  return (
    <div
      className={
        "seam seam-" +
        variant +
        (above ? " seam-above" : "") +
        (open ? " open" : "") +
        (gap !== "no" ? " drop-open" : "") +
        (gap === "copy" ? " drop-copy" : "")
      }
      style={
        {
          "--seam-indent": rowDepth * 20 + "px",
          ...(tilt ? { transform: `rotate(${-tilt}deg)` } : {}),
        } as CSSProperties
      }
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        setOpen(false);
        setShowing(null);
      }}
      /* Dead-drag zone: the card variant lives inside a draggable card,
       * and an HTML5 drag starts from the nearest draggable ancestor --
       * so a drag gesture beginning in the gap would lift the card.
       * Making the seam itself draggable and refusing its dragstart
       * kills the gesture instead (the Editable fix's cousin). */
      draggable
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      /* The gap is not the card: clicks in it must not select, open or
       * menu the card above (the card variant would bubble into it). */
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="seam-hit" />
      {/* THE DISCS EXIST ONLY WHILE THE GAP IS OPEN. They used to be
          rendered always and merely transparent, which measured at 14
          DOM nodes per seam -- a button and an icon SVG apiece -- and
          17% of the whole detail list's DOM, for controls nothing could
          see: 34 disc buttons mounted, 0 visible, every one rebuilt by
          every row that scrolled past. At rest a seam is now its hit
          strip and nothing else.

          The drag preview does not need them either: that draws through
          the row's own shelf, and the seam ROOT stays mounted to carry
          `drop-open`. */}
      {open && (
      <div className="seam-discs">
        {spec.discs.map((d, i) => {
          const fill = resolveNodeEntry(legend, undefined, levels[d.tier].id);
          const bg = fill?.bg ?? "#fff";
          return (
            <button
              key={d.tier}
              className="seam-disc"
              /* Each + sits at ITS OWN tier's indent, so the row is a
                 staircase of the ladder and a given tier's insert is
                 always at the same x on screen. `i === 0` carries the
                 whole offset; the rest follow at the 20px pitch. */
              style={{
                background: bg,
                borderColor: fill?.border,
                color: textColor(bg),
                marginLeft: i === 0 ? d.tier * 20 : 0,
              }}
              aria-label={`Add ${levels[d.tier].name.toLowerCase()}`}
              onMouseEnter={() => setShowing(i)}
              onClick={(e) => {
                e.stopPropagation();
                openNew(ops.insertTierAt(boardId, d.parentId, d.index, d.tier));
              }}
            >
              <Plus size={12} />
            </button>
          );
        })}
        {showing !== null && spec.discs[showing] && (
          <SeamPreview tier={spec.discs[showing].tier} levels={levels} />
        )}
      </div>
      )}
    </div>
  );
}

/* Which tier this disc pins, in words.
 *
 * It used to draw the SHAPES too -- one per node the pin would mint,
 * stacked the way they would sit -- so you could see that +Reel here
 * also makes a Day. The owner cut them 2026-08-07 ("we've built
 * something intuitive enough now that we don't need those"): the discs'
 * own indent and tier color say which tier you are aiming at before the
 * words do. `mintedAt` went with them; ops.insertTierAt is where that
 * rule actually lives, with its own tests. */
function SeamPreview({ tier, levels }: { tier: number; levels: LevelDef[] }) {
  return (
    <div className="gap-preview">
      <span className="gap-preview-label">Add {levels[tier].name.toLowerCase()}</span>
    </div>
  );
}
