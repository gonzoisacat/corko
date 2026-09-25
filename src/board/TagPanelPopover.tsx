import { useEffect } from "react";
import { useFitText } from "../ui/useFitText";
import { Trash2, X } from "lucide-react";
import { ops, useBoard, useProject, useTags, useSplitAxis } from "../state/useBoard";
import { DEFAULT_CARD_SPACING, TAG_OFFSET, TAG_REACH, TAG_SPAN } from "../state/types";
import { BEAT_CARD_H } from "./cardSizing";
import { DraftInput } from "../ui/DraftInput";
import { FloatPanel } from "../ui/FloatPanel";
import { tabRect } from "./tagPlacement";
import { tagPanel, useTagPanel } from "./tagPanel";
import { splitFill } from "./tagSplit";
import { newTags } from "./newTags";
import { confirmDialog } from "../ui/confirmDialog";
import { countTagUses } from "./boardVocab";
import { getSnapshot } from "../state/ydoc";

/* The stand-in card color the diorama shows a split against. The real
   card's fill depends on the card, and this panel belongs to the tag
   rather than to any one card -- so a neutral note tone, matching the
   plain preview cards either side of it. */
const PREVIEW_FILL = "#efeee9";

/* ------------------------------------------------------------------ *
 *  One tag's settings, floating and DRAGGABLE.
 *
 *  It used to be anchored inside the legend chip, which put it straight
 *  over the board -- exactly where you're looking while you drag the
 *  placement slider to see where the tab lands. So it's a free-floating
 *  panel you can shove aside by its header, rendered once above the
 *  panes (see board/tagPanel.ts for why the state is a module store, and
 *  ui/FloatPanel for the shell it shares with the card panels).
 *
 *  (Named ...Popover like InsertMenuPopover, so the file doesn't collide
 *  with tagPanel.ts on a case-insensitive filesystem.)
 *
 *  Opened from the legend gear, or by right-clicking a tab on a card --
 *  in which case it also offers to take the tag off that card, which is
 *  how a tag comes back off once applied.
 * ------------------------------------------------------------------ */

const W = 232;

const PREVIEW_COPY = "Lorem ipsum dolor sit amet";

export function TagPanelPopover() {
  const open = useTagPanel();
  const tags = useTags();
  const project = useProject();
  // hooks run unconditionally, above the early return below
  const openedBoard = useBoard(open?.boardId ?? "");
  /* Up here, NOT beside `isSplit` where it is used: everything below the
   * `if (!open || !tag) return null` runs a different number of times per
   * render, so a hook there changes the hook COUNT between renders and
   * React throws "Rendered more hooks than during the previous render"
   * the moment the panel opens. */
  const splitAxis = useSplitAxis();
  const tag = tags.find((t) => t.id === open?.tagId);

  // the tag can be deleted from under an open panel (or by a collaborator)
  useEffect(() => {
    if (open && !tag) tagPanel.close();
  }, [open, tag]);

  /* The preview is a little diorama, not a lone card: the card you're
   * editing with a neighbour either side, at the leaf tier's real aspect and
   * the board's real card spacing, so you can see a tab overlap its
   * neighbours -- which is the thing you can't judge from one card. The
   * container reserves the largest overhang any tag could have, so the tab
   * never collides with the controls (which is why this sits at the bottom).
   * Derived up here, above the early return, because the fit hook below
   * needs it -- the hook-count rule again. */
  const board = openedBoard ?? project.boards[0] ?? null;
  const leaf = board?.levels[board.levels.length - 1];
  // sized so the neighbours run past the frame: they're context, and a tab
  // reaching "into the next card" only reads if that card is cropped by the
  // edge rather than floating in the middle of the panel
  const PH = 56;
  const k = PH / (leaf?.height ?? BEAT_CARD_H); // detail px -> preview px
  /* The stand-in copy FITS its little card, as a real title fits a real
   * card (owner-reported 2026-09-04: "its text borked"). It used to wear
   * the tier's text size scaled down flat, which on a tier set to big
   * type was a 28px headline in a 56px card. The tier's size is the
   * CEILING here, as it is on the board; useFitText shrinks from it. */
  const previewFit = useFitText(PREVIEW_COPY, Math.max(5, Math.round((leaf?.textSize ?? 15) * k)), 5, {
    fontKey: "tag-preview",
  });

  if (!open || !tag) return null;

  const PW = Math.round(PH * (leaf?.aspect ?? 1.45));
  const gap = Math.max(2, Math.round((board?.cardSpacing ?? DEFAULT_CARD_SPACING) * k));
  const pad = Math.ceil((TAG_REACH.max / 2 + TAG_OFFSET.max) * k) + 2;
  const r = tabRect(tag.pos, PW, PH, tag.span * k, tag.reach * k, tag.offset * k);
  const isSplit = tag.kind === "split";

  return (
    <FloatPanel
      title="Tag"
      className="tag-panel"
      x={open.x}
      y={open.y}
      width={W}
      onMove={tagPanel.moveTo}
      onClose={tagPanel.close}
    >
      <div className="options-row">
        <span>Name</span>
        <DraftInput
          className="options-name"
          value={tag.name}
          ariaLabel="Tag name"
          onCommit={(v) => ops.setTag(tag.id, { name: v })}
        />
      </div>
      <div className="options-row">
        <span>Color</span>
        <label className="gear-swatch" style={{ background: tag.color }}>
          <input
            type="color"
            value={tag.color}
            aria-label="Tag color"
            onChange={(e) => ops.setTag(tag.id, { color: e.target.value })}
          />
        </label>
      </div>
      {/* WHICH KIND OF TAG. A tab sits ON the card and is found by where
          it is; a split takes a share of the card's color and is found by
          its hue. Everything below this row is tab geometry, so a split
          hides all of it -- there is nothing to place. */}
      <div className="options-row">
        <span>Shows as</span>
        <span className="tag-kind">
          <button
            className={"tag-kind-btn" + (isSplit ? "" : " active")}
            onClick={() => ops.setTag(tag.id, { kind: "tab" })}
            data-tip="A mark placed on the card's edge"
          >
            Tab
          </button>
          <button
            className={"tag-kind-btn" + (isSplit ? " active" : "")}
            onClick={() => ops.setTag(tag.id, { kind: "split" })}
            data-tip="A vertical share of the card's own color"
          >
            Split
          </button>
        </span>
      </div>
      <div className="options-row">
        <span>Visible</span>
        <button
          className={"switch" + (tag.visible ? " on" : "")}
          role="switch"
          aria-checked={tag.visible}
          aria-label="Tag visible"
          onClick={() => ops.setTag(tag.id, { visible: !tag.visible })}
        >
          <span className="switch-knob" />
        </button>
      </div>
      {/* PROJECT-WIDE, and it says so. One axis for every split tag: a
          card carrying two splits cut different ways would be unreadable,
          and it is the vocabulary that decides the look (ADR 0002's rule,
          which ADR 0005 inherits). Shown only on a split, because it is
          meaningless for a tab. */}
      {isSplit && (
        <div className="options-row">
          <span>
            Split direction
            <span className="legend-note"> all splits</span>
          </span>
          <span className="tag-kind">
            {(["vertical", "horizontal", "diagonal"] as const).map((a) => (
              <button
                key={a}
                className={"tag-kind-btn" + (splitAxis === a ? " active" : "")}
                onClick={() => ops.setSplitAxis(a)}
                aria-label={
                  a === "vertical"
                    ? "Cut down the card, left to right"
                    : a === "horizontal"
                      ? "Cut across the card, top to bottom"
                      : "Cut from the lower left to the top right"
                } data-tip={
                  a === "vertical"
                    ? "Cut down the card, left to right"
                    : a === "horizontal"
                      ? "Cut across the card, top to bottom"
                      : "Cut from the lower left to the top right"
                }
              >
                {a === "vertical" ? "Vert" : a === "horizontal" ? "Horiz" : "Diag"}
              </button>
            ))}
          </span>
        </div>
      )}
      {!isSplit && (
      <>
      <div className="options-row">
        <span>Ribbon tail</span>
        <button
          className={"switch" + (tag.shape === "ribbon" ? " on" : "")}
          role="switch"
          aria-checked={tag.shape === "ribbon"}
          aria-label="Notch the tab's outer end like a ribbon"
          onClick={() => ops.setTag(tag.id, { shape: tag.shape === "ribbon" ? "flat" : "ribbon" })}
        >
          <span className="switch-knob" />
        </button>
      </div>
      <div className="options-row options-slider">
        <span>Position</span>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(tag.pos * 1000)}
          aria-label="Tag position around the card"
          onChange={(e) => ops.setTag(tag.id, { pos: Number(e.target.value) / 1000 })}
        />
      </div>
      <div className="options-row options-slider">
        <span>Length</span>
        <input
          type="range"
          min={TAG_REACH.min}
          max={TAG_REACH.max}
          value={tag.reach}
          aria-label="Tag length (out from the edge)"
          onChange={(e) => ops.setTag(tag.id, { reach: Number(e.target.value) })}
        />
      </div>
      <div className="options-row options-slider">
        <span>Thickness</span>
        <input
          type="range"
          min={TAG_SPAN.min}
          max={TAG_SPAN.max}
          value={tag.span}
          aria-label="Tag thickness (along the edge)"
          onChange={(e) => ops.setTag(tag.id, { span: Number(e.target.value) })}
        />
      </div>
      <div className="options-row options-slider">
        <span>In / out</span>
        <input
          type="range"
          min={TAG_OFFSET.min}
          max={TAG_OFFSET.max}
          value={tag.offset}
          aria-label="Tag inset (inward or outward from the edge)"
          onChange={(e) => ops.setTag(tag.id, { offset: Number(e.target.value) })}
        />
      </div>
      </>
      )}

      {/* the diorama: neighbours are clipped by the frame, which is the point --
          you're looking at how far the tab reaches into them */}
      <div className="tag-preview" style={{ height: PH + pad * 2, padding: `${pad}px 0` }}>
        <div className="tag-preview-row" style={{ gap }}>
          <span className="tag-preview-card" style={{ width: PW, height: PH }} />
          <span
            className="tag-preview-card is-target"
            /* A split tag has no tab to judge, so the diorama shows the
               thing it actually does: the middle card wears the split at
               the leaf tier's real proportions, between two that don't. */
            style={{ width: PW, height: PH, ...(isSplit ? splitFill(PREVIEW_FILL, [tag.color]) : {}) }}
          >
            {/* stand-in copy, so the tab is judged against a card that looks
                like a card rather than an empty rectangle */}
            <span className="tag-preview-text" ref={previewFit.ref}>
              {PREVIEW_COPY}
            </span>
            {!isSplit && (
              <span
                className={"tag-tab tag-tab-" + r.edge + (tag.shape === "ribbon" ? " tag-tab-ribbon" : "")}
                style={{ left: r.left, top: r.top, width: r.width, height: r.height, background: tag.color }}
              />
            )}
          </span>
          <span className="tag-preview-card" style={{ width: PW, height: PH }} />
        </div>
      </div>

      {/* opened from a card: take it off that one card */}
      {open.nodeId && (
        <button
          className="options-structure-btn"
          onClick={() => {
            ops.setNodeTag([open.nodeId!], tag.id, false);
            tagPanel.close();
          }}
        >
          <X size={13} /> Remove from this card
        </button>
      )}
      <button
        className="options-structure-btn danger"
        onClick={async () => {
          /* ONLY ASK WHEN THERE IS SOMETHING TO LOSE -- the color
           * override's own rule (countColorUses), arriving here at the
           * owner's ask (2026-08-29): a dialog for deleting a tag
           * nothing wears is a tax on tidying up. Counted across EVERY
           * board, because tags are project-level and "unused" on the
           * board you are looking at proves nothing. When cards DO wear
           * it, the dialog finally says how many -- which the old
           * always-on confirm never could. */
          const used = countTagUses(getSnapshot().boards, tag.id);
          if (used > 0) {
            const ok = await confirmDialog.ask({
              title: `Delete the tag "${tag.name || "Untitled"}"?`,
              body:
                `It comes off ${used} ${used === 1 ? "card" : "cards"} across the project.`,
              confirmLabel: "Delete",
            });
            if (!ok) return;
          }
          ops.removeTag(tag.id);
          newTags.forget(tag.id); // don't pin a chip for a tag that's gone
          tagPanel.close();
        }}
      >
        <Trash2 size={13} /> Delete tag
      </button>
    </FloatPanel>
  );
}
