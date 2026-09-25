import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { DEFAULT_MAX_ROW_BEATS } from "../../state/types";
import type { Board, Node } from "../../state/types";
import { setSetting, useSettings } from "../../state/settings";
import { ops, useFields, useTags } from "../../state/useBoard";
import { dropCatcher } from "../dropCatcher";
import { ensureTier, publishNearest } from "../overviewTiling";
import { dropTarget } from "../dropTarget";
import { leafDescendants } from "../../state/counts";
import { selection } from "../selection";
import { useKeyCursor } from "../keyNav";
import { collectItems } from "./overviewLayout";
import { useBoardUI } from "../context";
import { ProxyNode } from "./ProxyNode";
import { overviewTip, tipCardFor, useOverviewTip } from "./overviewTip";
import { MiniCard } from "./MiniCard";
import { ConvertMenu } from "./ConvertMenu";
import { useWheelZoom } from "../useWheelZoom";

const clampZoom = (z: number) => Math.max(0.15, Math.min(2.5, z));
// Safety cap on "Overview beat text": beat labels are now cheap fixed-size
// clipped text (no per-beat useFitText), so this is high -- it only guards a
// pathologically huge board (the Overview isn't virtualized, so every beat's
// span is in the DOM). Beat text is also zoom-gated, so at fit-zoom it's still
// just color cells.
const OV_BEAT_TEXT_MAX = 8000;

/* Spine sizing -- two dials. See spineHeight below for the reasoning. */
const SPINE_BASE_H = 300; // px, the bar nearest the columns
const SPINE_STEP = 1.1; // each tier up is this much taller

/* A node and its tier, for the keyboard cursor's preview. The Overview
 * ignores fold, so this is a plain walk -- no visibility rules. */
function findNode(nodes: Node[], id: string, depth: number): { node: Node; depth: number } | null {
  for (const n of nodes) {
    if (n.id === id) return { node: n, depth };
    const hit = findNode(n.children, id, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/* The zoomed-out Overview: the whole board as color proxies, one column per
 * node at `columnDepth`. Content renders at natural size then scales to fit
 * (offsetWidth ignores the transform, so measuring stays clean); a sizer div
 * carries the scaled box so scrollbars stay correct. ctrl/cmd-wheel zooms;
 * plain wheel + drag-background pan. */
export function OverviewView({
  board,
  query,
  columnDepth,
  onColumnDepth,
  onJump,
  onSelect,
  hasKeyboard,
  detailDepth,
  onDetailDepth,
  zoom,
  manual,
  onZoom,
  onManual,
  onOpenBoard,
}: {
  board: Board;
  query: string;
  columnDepth: number;
  onColumnDepth: (d: number) => void;
  onJump: (id: string) => void;
  onSelect: (id: string) => void;
  /* Whether this column holds the keyboard (board/paneFocus.ts). Only the
   * focused one's preview may follow the cursor -- two Overviews side by
   * side would otherwise both pop a card on one keypress. */
  hasKeyboard: boolean;
  /* "Detail level": the deepest tier drawn. Lives in the pane like the
   * column tier and zoom. Null = all the way to the leaf. */
  detailDepth: number | null;
  onDetailDepth: (d: number | null) => void;
  /* Zoom lives in the pane (BoardPane), so it survives a trip through the
   * detail view and stays this column's own in the split view. `manual`
   * marks the user having overridden fit-to-screen. */
  /* Open the board Convert board type just made BESIDE this one -- the
   * other pane, or a new split with the copy on the right (owner,
   * 2026-09-11) -- so you land on the copy with its source still in
   * view. App's rule (nestActions.beside), handed down through
   * BoardPane's onOpenBeside. */
  onOpenBoard: (id: string) => void;
  zoom: number;
  manual: boolean;
  onZoom: (z: number) => void;
  onManual: (m: boolean) => void;
}) {
  const legend = board.legend;
  const tags = useTags();
  const fields = useFields();
  const { overviewBeatText, overviewPreviewScale, noteDots, cardImages } = useSettings(board.id);

  const maxRowBeats = board.maxRowBeats ?? DEFAULT_MAX_ROW_BEATS; // shared per-board
  const leaf = board.levels.length - 1;
  /* The leaf tier's OWN name, so this board's word appears on the toggle
   * rather than a hardcoded "Beat". The ladder is user-defined (ADR
   * 0001) -- a footage board's leaf is a Camera Filename, a shot list's
   * is a Shot -- and a control labelled for somebody else's ladder reads
   * as a bug. The `+ "s"` plural is the same naive one the Boards menu
   * already uses for this name. */
  const leafName = board.levels[leaf]?.name || "Card";
  // total beats -- gates the (unvirtualized, per-beat-fit) beat-text path
  const beatCount = useMemo(
    () => board.roots.reduce((sum, r) => sum + leafDescendants(r, 0, leaf), 0),
    [board, leaf],
  );
  const beatText = overviewBeatText && beatCount <= OV_BEAT_TEXT_MAX;
  const cd = Math.max(0, Math.min(columnDepth, Math.max(0, leaf - 1)));
  /* How deep to draw. Never shallower than the column tier (a column has
   * to draw at least its own card) and never past the leaf. */
  const dd = Math.max(cd, Math.min(detailDepth ?? leaf, leaf));
  /* Columns, plus a SPINE for every tier above the column tier -- see
   * collectItems. With cd 0 there's nothing above, so it's just columns. */
  const items = useMemo(() => collectItems(board.roots, cd), [board.roots, cd]);

  /* How tall a spine stands (owner's call, 2026-08-02). FIXED, and the
   * SAME everywhere: a spine that stretched to the row was a rule down
   * the page rather than a label, and it made every row as tall as its
   * tallest neighbour. A flat height also keeps a long name readable no
   * matter which tier you column by -- sized off the column's own unit
   * it shrank to a beat's worth whenever you columned by Scene, and
   * started clipping again.
   *
   * 300px is about seven scene cards at the default tier sizes -- long
   * enough to read as a bracket over a run of ordinary columns without
   * chasing the one 40-scene column further down the board.
   *
   * Each tier UP is 10% taller than the one below it, so a Reel bar
   * standing next to a Day bar reads as the outer one at a glance. The
   * step is deliberately small: a hierarchy cue, not a scale. */
  const spineHeight = useCallback(
    (depth: number) => {
      // generations above the columns: 0 is the immediate parent
      const gen = Math.max(0, cd - 1 - depth);
      return Math.round(SPINE_BASE_H * Math.pow(SPINE_STEP, gen));
    },
    [cd],
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  // latest zoom for the native (non-passive) wheel listener, so ctrl-wheel
  // doesn't have to re-register the listener on every zoom step
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Fit-to-screen: scale so the WHOLE board fits (whichever of width/height
  // is the tighter constraint), keeping every proxy's aspect ratio -- it's
  // one uniformly-scaled board with nothing cut off. offsetWidth/Height
  // ignore the transform, so measuring is clean.
  const computeFit = useCallback(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) return 1;
    const w = content.offsetWidth;
    const h = content.offsetHeight;
    if (w <= 0 || h <= 0) return 1;
    const fw = (viewport.clientWidth - 4) / w;
    const fh = (viewport.clientHeight - 4) / h;
    return clampZoom(Math.min(fw, fh));
  }, []);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) return;
    const measure = () => {
      setNatural({ w: content.offsetWidth, h: content.offsetHeight });
      if (!manual) onZoom(computeFit());
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [board, cd, manual, computeFit, onZoom]);

  /* ctrl/cmd + wheel zooms, ANCHORED on the pointer (board/useWheelZoom.ts
     -- read it for why ctrl and not option, and for why the scroll
     correction has to wait for layout). It used to multiply the zoom and
     leave the scroll alone, so the board grew away from its top-left
     corner and whatever you were looking at slid off. */
  useWheelZoom(viewportRef, zoom, onZoom, clampZoom, onManual);

  // drag empty background to pan
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // every card is a .ov-mini now (beat cells, scene + header cards)
    if ((e.target as HTMLElement).closest(".ov-cell, .ov-mini, .ov-band, .ov-spine")) return;
    selection.clear(); // pressing empty space deselects
    const vp = viewportRef.current;
    if (!vp) return;
    pan.current = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
    vp.classList.add("panning");
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const p = pan.current;
    const vp = viewportRef.current;
    if (!p || !vp) return;
    vp.scrollLeft = p.sl - (e.clientX - p.x);
    vp.scrollTop = p.st - (e.clientY - p.y);
  };
  const endPan = () => {
    pan.current = null;
    viewportRef.current?.classList.remove("panning");
  };

  const fit = () => {
    onManual(false);
    onZoom(computeFit());
  };

  /* The preview follows the KEYBOARD too (2026-08-02). A hover pops a
   * readable card because a proxy is unreadable by design; arrowing onto
   * a proxy has exactly the same problem, so it gets exactly the same
   * card -- built by the same tipCardFor -- anchored to the cell instead
   * of the pointer. Only the focused column does it, and only while this
   * pane is showing the Overview (this component is the Overview). */
  const keyAt = useKeyCursor();
  // board + legend through a ref: this must fire on a KEYPRESS, not on
  // every doc change. Both change identity on any edit to this board, and
  // in the deps they'd pop the preview back up after an unrelated edit.
  const boardRef = useRef(board);
  boardRef.current = board;
  /* Read through a ref for the same reason `board` is: the keyboard-tip
   * effect fires on a KEYPRESS, not on a doc change, so a changing value
   * in its deps would pop the preview back up on any unrelated edit. */
  const { nests } = useBoardUI();
  const nestsRef = useRef(nests);
  nestsRef.current = nests;
  const imagesRef = useRef(cardImages);
  imagesRef.current = cardImages;
  useEffect(() => {
    if (!hasKeyboard) return;
    if (!keyAt) {
      overviewTip.hide(); // Escape dropped the cursor
      return;
    }
    const board = boardRef.current;
    const found = findNode(board.roots, keyAt.id, 0);
    // scope the lookup to THIS viewport: two columns can show one board,
    // and both would carry the same data-node
    const el = viewportRef.current?.querySelector(`[data-node="${CSS.escape(keyAt.id)}"]`);
    const r = el?.getBoundingClientRect();
    if (!found || !r) {
      overviewTip.hide(); // the cursor is in the other column's board
      return;
    }
    // the cell's bottom-right corner, so the same offset the pointer gets
    // drops the card just clear of the cell rather than over it
    overviewTip.show(
      tipCardFor(found.node, found.depth, board.levels, board.legend, nestsRef.current, imagesRef.current),
      r.right,
      r.bottom,
    );
  }, [keyAt, hasKeyboard]);
  // a column that loses the keyboard (or stops being an Overview) takes
  // its preview with it
  useEffect(() => {
    if (!hasKeyboard) return;
    return () => overviewTip.hide();
  }, [hasKeyboard]);

  const tip = useOverviewTip();
  // Preview card: a real detail-sized card of the hovered tier (its true height
  // x height*aspect, fit at the tier's cap) that is CSS-scaled UP to a legible
  // size -- so the title wraps 1:1 with the detail card and the Overview cell.
  // "Hover card size" (Overview toolbar): 1 = current/max, down to 0.33.
  const previewScale = Math.max(0.33, Math.min(1, overviewPreviewScale));
  let previewH = 120;
  let previewW = 168;
  if (tip) {
    // the WHOLE card, so a tier that appends picture room previews at the
    // shape it really has rather than at its text card's
    const boxAspect = tip.boxW / tip.boxH;
    let ph = Math.min(200, Math.max(100, Math.round(tip.boxH * 1.5)));
    let pw = Math.round(ph * boxAspect);
    if (pw > 340) {
      pw = 340;
      ph = Math.round(pw / boxAspect);
    }
    previewH = Math.max(1, Math.round(ph * previewScale));
    previewW = Math.max(1, Math.round(pw * previewScale));
  }

  return (
    <div className="ov-wrap">
      <div className="ov-toolbar">
        <label className="ov-tool">
          <span className="ov-tool-label">1 Column per:</span>
          <select
            className="options-select"
            value={cd}
            onChange={(e) => onColumnDepth(Number(e.target.value))}
          >
            {board.levels.slice(0, Math.max(1, leaf)).map((l, i) => (
              <option key={l.id} value={i}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {/* How deep to draw. A column can stop at any tier from its own
            down to the leaf -- "scenes only" is a different read of the
            same board than "every beat", and at a big board it is the
            difference between a shape you can scan and a wall of cells. */}
        <label className="ov-tool">
          <span className="ov-tool-label">Detail level:</span>
          <select
            className="options-select"
            value={dd}
            onChange={(e) => onDetailDepth(Number(e.target.value))}
          >
            {board.levels.slice(cd).map((l, i) => (
              <option key={l.id} value={cd + i}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <span className="ov-tool">
          <input
            type="range"
            min={15}
            max={200}
            value={Math.round(zoom * 100)}
            aria-label="Zoom"
            onChange={(e) => {
              onManual(true);
              onZoom(clampZoom(Number(e.target.value) / 100));
            }}
          />
          <span className="mono ov-zoom-val">{Math.round(zoom * 100)}%</span>
        </span>
        <button className="ov-fit-btn" onClick={fit}>
          Fit
        </button>
        <label className="ov-tool">
          <span className="ov-tool-label">Hover preview size</span>
          <input
            type="range"
            min={33}
            max={100}
            value={Math.round(previewScale * 100)}
            aria-label="Hover card size"
            onChange={(e) => setSetting(board.id, "overviewPreviewScale", Number(e.target.value) / 100)}
          />
          <span className="mono ov-zoom-val">{Math.round(previewScale * 100)}%</span>
        </label>
        <label className="ov-tool ov-tool-check">
          <input
            type="checkbox"
            checked={overviewBeatText}
            onChange={(e) => setSetting(board.id, "overviewBeatText", e.target.checked)}
            aria-label={
              beatCount > OV_BEAT_TEXT_MAX
                ? `Too many ${leafName.toLowerCase()}s (${beatCount}) to label -- color only`
                : `Show ${leafName.toLowerCase()} titles (zoom in to read them)`
            } data-tip={
              beatCount > OV_BEAT_TEXT_MAX
                ? `Too many ${leafName.toLowerCase()}s (${beatCount}) to label -- color only`
                : `Show ${leafName.toLowerCase()} titles (zoom in to read them)`
            }
            disabled={beatCount > OV_BEAT_TEXT_MAX}
          />
          <span className="ov-tool-label">{leafName} text</span>
        </label>
        {/* CONVERT BOARD TYPE, at the toolbar's right end (owner,
            2026-09-11). Here rather than in the Boards menu because the
            two numbers a conversion needs -- which tier makes the
            columns and how deep the detail goes -- are this toolbar's
            own, so what you see is what the new board gets
            (state/gridFrom.ts). A new board beside this one, opened in
            the OTHER pane (a split if there is none); this one is
            untouched, so nothing to confirm and one Cmd+Z takes the copy
            back. */}
        <ConvertMenu onFreeGrid={() => onOpenBoard(ops.convertToGrid(board.id, cd, dd))} />
      </div>
      <div
        className="ov-viewport"
        /* the keyboard's spatial nav measures the cards inside THIS
           viewport; with two Overviews open it has to know whose */
        data-kbd={hasKeyboard ? "on" : undefined}
        ref={viewportRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endPan}
        onMouseLeave={endPan}
        /* The whole surface is a drop zone: the nearest insertion point at
           the dragged tier wins from anywhere (board/overviewTiling.ts),
           and releasing anywhere honours it (board/dropCatcher.ts). */
        {...dropCatcher(board.id)}
        onDragOver={(e) => {
          dropCatcher(board.id).onDragOver(e);
          ensureTier(board, viewportRef.current, columnDepth);
          publishNearest(board.id, e.clientX, e.clientY);
          if (dropTarget.get()) e.preventDefault();
        }}
      >
        <div className="ov-sizer" style={{ width: natural.w * zoom, height: natural.h * zoom }}>
          <div
            className="ov-content"
            ref={contentRef}
            style={
              {
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                // so a selection outline can cancel the scale (see .ov-sel)
                "--ov-zoom": zoom,
              } as CSSProperties
            }
          >
            {items.map((it) => {
              const proxy = (
                <ProxyNode
                  node={it.node}
                  depth={it.kind === "spine" ? it.depth : cd}
                  parentId={it.parentId}
                  index={it.index}
                  levels={board.levels}
                  legend={legend}
                  leaf={leaf}
                  q={query}
                  onJump={onJump}
                  onSelect={onSelect}
                  beatText={beatText}
                  noteDots={noteDots}
                  images={cardImages}
                  zoom={zoom}
                  maxRowBeats={maxRowBeats}
                  tags={tags}
                  maxDepth={dd}
                  spine={it.kind === "spine"}
                  spineHeight={it.kind === "spine" ? spineHeight(it.depth) : undefined}
                />
              );
              // a spine is its own flex child (it stretches beside the
              // columns); a column gets the .ov-column box
              return it.kind === "spine" ? (
                <Fragment key={it.node.id}>{proxy}</Fragment>
              ) : (
                <div className="ov-column" key={it.node.id}>
                  {proxy}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {tip && (
        /* the hovered tier's own card, scaled UP -- same component as the
           Overview proxies (MiniCard), so the preview, the proxy and the
           detail card all break the title in the same places */
        <MiniCard
          className="ov-tip"
          style={{
            left: Math.min(tip.x + 16, window.innerWidth - previewW - 16),
            top: Math.min(tip.y + 18, window.innerHeight - previewH - 16),
          }}
          text={tip.text}
          fontClassName={tip.fontClass}
          geo={{
            detailH: tip.height,
            aspect: tip.aspect,
            strip: tip.strip,
            boxW: tip.boxW,
            boxH: tip.boxH,
            padY: tip.padY,
            padX: tip.padX,
            gap: tip.gap,
            fitMax: tip.fitMax,
            fitMin: tip.fitMin,
            weight: tip.weight,
            letterSpacing: tip.letterSpacing,
            lineHeight: tip.lineHeight,
          }}
          targetH={previewH}
          align={tip.fullWidth ? "start" : "center"}
          bg={tip.bg}
          border={tip.border}
          color={tip.color}
          tagIds={tip.tags}
          tags={tags}
          slotNode={tip.slotNode}
          imageNode={tip.imageNode}
          plain={tip.plain}
          images={cardImages}
          fields={fields}
        />
      )}
    </div>
  );
}
