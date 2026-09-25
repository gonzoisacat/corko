import type { CSSProperties, MouseEvent as RMouseEvent, ReactNode } from "react";
import { useSettings } from "../state/settings";
import { frameMenu } from "./frameMenu";
import { useWallImage } from "./wallImage";

/* ------------------------------------------------------------------ *
 *  THE FRAME AND THE WALL, DRAWN (board/frame.ts says what they are).
 *
 *  Two pieces, because they sit at two depths. The WALL is the zoom
 *  viewport's own background -- `useWall` hands the viewport its
 *  attributes -- so it fills the pane and stays put while the board
 *  scrolls over it. The FRAME wraps the board inside the scaled box:
 *  a transparent pad (room for the frame's shadow, so the fit does not
 *  clip it), the band in its material, and the cork margin with the
 *  board itself in it. The fit measures the scaled box, so 1.0x shows
 *  the whole framed board with the wall around it.
 *
 *  A right-click on any of the three -- wall, band, cork margin -- opens
 *  the frame's popup; the board's own bare cork keeps its own menu, and
 *  the `target === currentTarget` guards are what keep them apart.
 * ------------------------------------------------------------------ */

const openMenu = (boardId: string) => (e: RMouseEvent) => {
  if (e.target !== e.currentTarget) return;
  e.preventDefault();
  frameMenu.open({ boardId, x: e.clientX, y: e.clientY });
};

export function useWall(boardId: string): {
  "data-wall"?: "on";
  style?: CSSProperties;
  onContextMenu: (e: RMouseEvent) => void;
} {
  const s = useSettings(boardId);
  const url = useWallImage(s.frame ? s.wallImage : "");
  const onContextMenu = openMenu(boardId);
  if (!s.frame) return { onContextMenu };
  return {
    "data-wall": "on",
    style: {
      "--wall-color": s.wallColor,
      ...(url ? { "--wall-image": `url("${url}")` } : {}),
    } as CSSProperties,
    onContextMenu,
  };
}

export function BoardFrame({
  boardId,
  margin,
  lattice,
  children,
}: {
  boardId: string;
  /* the cork between the band and the nearest card at 1.0x, in px (half
   * the smallest card, board/frame.ts); the Padding slider scales it */
  margin: number;
  /* the grid's cell size, so the cork box can continue the sheet's
   * lattice across the padding in step with it (index.css reads --cell
   * and --pad); Columns passes nothing and draws plain cork */
  lattice?: number;
  children: ReactNode;
}) {
  const s = useSettings(boardId);
  if (!s.frame) return <>{children}</>;
  const open = openMenu(boardId);
  const pad = Math.round(margin * s.framePad);
  return (
    <div className="board-frame-pad" onContextMenu={open}>
      <div
        className="board-frame"
        data-frame={s.frameStyle}
        style={{ "--frame-scale": s.frameScale } as CSSProperties}
        onContextMenu={open}
      >
        <div
          className={"board-cork" + (lattice ? " board-cork-lattice" : "")}
          style={
            {
              padding: pad,
              ...(lattice ? { "--cell": `${lattice}px`, "--pad": `${pad}px` } : {}),
            } as CSSProperties
          }
          onContextMenu={open}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
