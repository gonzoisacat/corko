import { useEffect, useRef } from "react";
import { Scissors } from "lucide-react";
import { useClampToViewport } from "../../ui/useClampToViewport";
import { ops, useBoard } from "../../state/useBoard";
import { DEFAULT_YARN, YARN_COLORS, YARN_WIDTHS, yarnWidth } from "../../state/gridBoard";
import { yarnMenu, useYarnMenu } from "./yarnMenu";

/* What you can do to a piece of yarn: change its color, or cut it.
 * Deliberately tiny -- a string has no title, no notes and no metadata,
 * so a card-sized menu would be mostly empty. */
export function YarnMenuPopover() {
  const menu = useYarnMenu();
  const board = useBoard(menu?.boardId ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) yarnMenu.close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") yarnMenu.close();
      if (e.key === "Delete" || e.key === "Backspace") {
        ops.removeEdge(menu.boardId, menu.edgeId);
        yarnMenu.close();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const w = 156;
  const { left, top } = useClampToViewport(ref, menu?.x ?? 0, menu?.y ?? 0, { w, h: 118 });
  if (!menu) return null;
  const edge = board?.edges?.find((e) => e.id === menu.edgeId);

  return (
    <div ref={ref} className="ctx-menu yarn-menu" style={{ left, top, width: w }}>
      <div className="ctx-swatches">
        {YARN_COLORS.map((c) => (
          <button
            key={c}
            className={"swatch" + (edge?.color === c ? " active" : "")}
            style={{ background: c, borderColor: c }}
            aria-label={`Yarn color ${c}`}
            onClick={() => ops.setEdgeColor(menu.boardId, menu.edgeId, c)}
          />
        ))}
      </div>
      {/* THICKNESS, per string like the color above it (owner,
          2026-08-26). Each button DRAWS its own width in the string's own
          color, so the row shows what it does rather than naming it --
          "3.25px" would mean nothing, and the swatches beside it already
          set the precedent that you pick these by looking. */}
      <div className="yarn-widths">
        {YARN_WIDTHS.map((px) => (
          <button
            key={px}
            className={"yarn-width" + (yarnWidth(edge ?? {}) === px ? " active" : "")}
            aria-label={`Yarn thickness ${px}px`}
            onClick={() => ops.setEdgeWidth(menu.boardId, menu.edgeId, px)}
          >
            <span style={{ height: px, background: edge?.color ?? DEFAULT_YARN }} />
          </button>
        ))}
      </div>
      <button
        className="ctx-item danger"
        onClick={() => {
          ops.removeEdge(menu.boardId, menu.edgeId);
          yarnMenu.close();
        }}
      >
        <Scissors size={14} /> Cut this string
      </button>
    </div>
  );
}
