import { ChevronRight, ChevronDown, Layers } from "lucide-react";
import { isNested } from "../state/nesting";
import { memo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { LevelDef, Node } from "../state/types";
import { ops, useFields, useLegend, useTags } from "../state/useBoard";
import { resolveNodeColor, resolveNodeColorId, textColor } from "../colors";
import { useBoardUI } from "./context";
import { TagTabs, tagAttr, useBoxSize } from "./TagTabs";
import { cardFill } from "./tagSplit";
import { NoteDot } from "./NoteDot";
import { CardSlots } from "./CardSlots";
import { ImageFrame } from "./ImageFrame";
import { hasPicture } from "./cardImage";
import { Editable } from "../ui/Editable";
import { editCard, useAutoEdit } from "./autoEdit";
import { dragStore, liftDragImage, useDropZone } from "./drag";
import { moveDropped } from "./dropMove";
import { select, selection, useIsSelected } from "./selection";
import { cardMenu } from "./cardMenu";
import { fontClass } from "../fonts";
import { useRemoteFocus } from "../state/sync";
import { fold, useFolded } from "../state/fold";
import { useFitText } from "../ui/useFitText";
import { LANE_CARD_H } from "./cardSizing";
import { targetFontSize } from "../state/tierDefaults";
import { cardText, plainText, shadowAttr } from "./cardText";

interface Props {
  node: Node;
  depth: number;
  level: LevelDef;
  parentId: string | null;
  index: number;
  childName: string;
  childCount: number;
  stack?: string[]; // hidden same-tier lanes stacked behind this one
}

/* A swimlane tier header (Reel, Section, Episode, ...). The exact look
 * is driven by level.variant, which reuses the prototype's reel-head /
 * section-head styling; fields (subtitle, tag, ...) render per
 * level.fields. Drag handle + same-tier drop target for reorder /
 * re-parent (spec Sec 4; ADR 0001). Memoized: structural-sharing
 * snapshots keep node/level identities stable across unrelated edits. */
export const LaneHeader = memo(function LaneHeader({
  node,
  depth,
  level,
  parentId,
  index,
  childName,
  childCount,
  stack,
}: Props) {
  const { query, boardId, settings } = useBoardUI();
  const { noteDots, cardImages } = settings;
  const searching = query.length > 0;
  const collapsed = useFolded(node.id) && !searching;
  const dark = level.variant === "section"; // tier identity (drives sizes/layout)
  const legend = useLegend(boardId);
  // every header renders its tier color (explicit, else the tier default);
  // text/controls auto-contrast so any color -- incl. a dark section -- reads.
  const c = resolveNodeColor(legend, node.color, level.id);
  const colorId = resolveNodeColorId(legend, node.color, level.id); // legend hover
  const autoTxt = textColor(c.bg);
  const tierTxt = level.textColor ?? autoTxt; // manual title color override
  const onDark = autoTxt === "#ffffff"; // control tints key off the fill contrast
  const stackedIds = stack ?? [];
  const selected = useIsSelected(node.id);

  const drop = useDropZone(
    depth,
    (item, side) => moveDropped(item, parentId, side === "after" ? index + 1 : index, boardId),
    "y", // headers stack vertically -> drop above/below
    node.id, // ...and a tag target
  );

  const tags = useTags();
  const fields = useFields();
  const remote = useRemoteFocus().get(node.id);

  // Header tiers render as a fixed-aspect card by default; `fullWidth` opts
  // back into the classic full-width swimlane band.
  const asCard = !level.fullWidth;
  // a band fills its row, so its box has to be measured; a card's is known
  const bandRef = useRef<HTMLDivElement>(null);
  const band = useBoxSize(bandRef, asCard);
  // per-tier height (defaults to the shared level-2+ anchor); aspect sets width
  const headH = level.height ?? LANE_CARD_H;
  const cardW = Math.round(headH * (level.aspect ?? 1.45));
  const tierFont = targetFontSize(level, false);
  // plain words (board/cardText.ts plainText): the one rule, not a copy
  const plain = plainText(node, cardImages);
  const ink = cardText(node, tierTxt, tierFont, plain);
  const txt = ink.color;
  const headFont = ink.size;
  // Card mode: the fit box carries the font size (title omits its own), always
  // shrinking; "expand" raises the cap to the card height so it fills. Bands
  // aren't height-constrained, so the ref stays detached and this no-ops.
  /* While the title is open, the band stops being draggable (or selecting
   * a few words would grab the whole band -- a drag starts from the
   * nearest draggable ANCESTOR) and the field is allowed to take the rest
   * of the row, which is what a full-width band has plenty of.
   * Declared above the fit because the fit depends on it: an empty title
   * renders a blank FIELD while editing and a placeholder SPAN at rest. */
  const [editing, setEditing] = useState(false);
  // fontKey: a typeface change re-wraps the title, so it must re-fit
  const fit = useFitText(node.title, headFont, 8, {
    layoutKey: `${node.titleAlign ?? ""}|${node.imageFit ?? ""}`,
    fontKey: node.font ?? level.defaultFont,
    editing,
  });
  const kbEdit = useAutoEdit(node.id); // keyboard nav's Enter opens the title
  // being dragged: hidden but keeping its space (see Card.tsx's note)
  const [lifted, setLifted] = useState(false);
  const baseHeadClass = level.variant === "reel" ? "reel-head" : "section-head";
  /* A PICTURE, in EITHER form (board/cardImage.ts). The band used to be
   * excluded because a photo turned the title into a bottom caption and
   * a pane-spanning bar has no known aspect to design one for -- but the
   * caption was cut the same day and a centered title in white with a
   * shadow does not care about aspect. `canShowImage` admits every shape
   * now, and this is the renderer half of that. */
  // no picture while the board's images switch is off: the frame stays
  // unrendered and the has-image class off, so the band reads as plain
  const photo = cardImages !== "off" && hasPicture(node);
  const headClass = baseHeadClass + (asCard ? " lane-card" : "") + (photo ? " has-image" : "");
  const titleStyle: CSSProperties = {
    fontWeight: 700,
    // card mode inherits the fit box's size; band mode sets it explicitly
    ...(asCard ? {} : { fontSize: headFont }),
    letterSpacing: dark ? 0.2 : 0.4,
    color: txt,
  };
  const headStyle: CSSProperties = {
    ...cardFill(c.bg, node.tags, tags),
    border: `1px solid ${c.border}`,
    ...(asCard ? { width: cardW, height: headH, minHeight: headH } : {}),
    // band mode: adjustable height (LevelDef.bandHeight); unset stays
    // content-sized, which is what bands always were
    ...(!asCard && level.bandHeight
      ? { height: level.bandHeight, minHeight: level.bandHeight }
      : {}),
    ...(remote ? { outline: `2px solid ${remote.color}`, outlineOffset: 1 } : {}),
  };
  const pluralize = (n: number, name: string) => `${n} ${name.toLowerCase()}${n === 1 ? "" : "s"}`;

  const titleBlock = (
    <span
      className={
        "lane-title" + (editing ? " editing" : "") + fontClass(node.font ?? level.defaultFont)
      }
    >
      <Editable
        value={node.title}
        placeholder={level.name}
        multiline /* Shift+Enter breaks the line; plain Enter still commits */
        autoEdit={kbEdit}
        focusId={node.id}
        focusField="title"
        onEditing={setEditing}
        onCommit={(v) => ops.setNodeField(node.id, "title", v)}
        style={titleStyle}
      />
    </span>
  );

  return (
    <div
      className={
        headClass +
        " hoverable" +
        (drop.over && drop.copy ? " drop-copy" : "") +
        (drop.tagOver ? " tag-drop" : "") +
        (selected ? " selected" : "") +
        (lifted ? " drag-lifted" : "")
      }
      ref={bandRef}
      title={remote ? `${remote.name} is editing` : undefined}
      data-tags={tagAttr(node.tags)}
      data-title-align={node.titleAlign}
      data-text-shadow={shadowAttr(node, plain)}
      data-color={colorId}
      data-node={node.id}
      style={headStyle}
      draggable={!searching && !editing}
      onDragStart={(e) => {
        if (!selected) selection.clear(); // drag an unselected header = just it
        dragStore.start({ id: node.id, depth, boardId, nested: isNested(node) }, e.currentTarget as HTMLElement);
        e.dataTransfer.effectAllowed = "copyMove";
        liftDragImage(e, e.currentTarget as HTMLElement); // half-size ghost
        window.setTimeout(() => setLifted(true), 0); // hide AFTER capture
      }}
      onDragEnd={() => {
        dragStore.end();
        setLifted(false);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.shiftKey) {
          e.preventDefault();
          select(node.id, "range");
        } else if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          select(node.id, "toggle");
        } else {
          select(node.id, "single");
        }
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.getSelection?.()?.removeAllRanges(); // drop the dblclick word-select
        editCard(node.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        /* Right-clicking a card OUTSIDE the current selection takes
         * the selection (owner's call): the menu acts on what you
         * clicked, so leaving another card lit says the wrong thing.
         * Inside a multi-selection it changes nothing -- that's how
         * "recolor these six" survives the right-click that starts
         * it. */
        if (!selected) select(node.id, "single");
        cardMenu.open(node, e.clientX, e.clientY, {
          boardId,
          parentId,
          index,
          depth,
          colorable: true,
          stackedIds,
        });
      }}
      {...drop.props}
    >
      {photo && <ImageFrame node={node} />}
      {/* bands take tabs too -- they're a rectangle with edges like any card,
          just one whose size we have to measure rather than derive */}
      <TagTabs
        ids={node.tags}
        tags={tags}
        nodeId={node.id}
        boardId={boardId}
        w={asCard ? cardW : band.w}
        h={asCard ? headH : band.h}
      />
      <NoteDot notes={node.notes} on={noteDots} nodeId={node.id} />
      <CardSlots node={node} fields={fields} color={txt} />
      <button
        className={"chev" + (onDark ? " light" : "")}
        onClick={() => fold.toggle(node.id)}
        aria-label={collapsed ? "Expand " + level.name.toLowerCase() : "Collapse " + level.name.toLowerCase()} data-tip={collapsed ? "Expand " + level.name.toLowerCase() : "Collapse " + level.name.toLowerCase()}
      >
        {collapsed ? <ChevronRight size={dark ? 16 : 18} /> : <ChevronDown size={dark ? 16 : 18} />}
      </button>

      {asCard ? (
        <div className="lane-fit" ref={fit.ref} onInput={fit.remeasure}>
          {titleBlock}
        </div>
      ) : (
        titleBlock
      )}

      {/* The child-tier roll-up ("N days"). Section-variant heads carry no
          count of their own. */}
      {!dark && <span className="mono reel-meta">{pluralize(childCount, childName)}</span>}

      {/* No hover tools (owner's call, 2026-08-02): the cluster sat where
          the mouse already was and the trash can got hit by accident.
          Delete/move live in the right-click menu; the whole band drags. */}

      {/* Stacked-behind lanes: offset slivers under the header + a chip to
          un-stack the whole run (spec Sec 4). */}
      {stackedIds.length > 0 && (
        <>
          {stackedIds.slice(0, 4).map((id, k) => (
            <span
              key={id}
              className={"lane-stack-sliver" + (dark ? " dark" : "")}
              style={{ bottom: -(3 + k * 3), left: 14 + k * 5, zIndex: -(k + 1) }}
              aria-hidden
            />
          ))}
          <button
            className={"lane-stack-expand" + (dark ? " light" : "")}
            aria-label={`Show ${stackedIds.length} stacked ${level.name.toLowerCase()}${stackedIds.length === 1 ? "" : "s"}`} data-tip={`Show ${stackedIds.length} stacked ${level.name.toLowerCase()}${stackedIds.length === 1 ? "" : "s"}`}
            onClick={(e) => {
              e.stopPropagation();
              ops.setHidden(stackedIds, false);
            }}
          >
            <Layers size={11} />
            {stackedIds.length}
          </button>
        </>
      )}
    </div>
  );
});
