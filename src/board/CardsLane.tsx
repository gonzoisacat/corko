import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { ChevronRight, ChevronLeft, CornerDownLeft, Plus, Layers } from "lucide-react";
import type { LevelDef, Node } from "../state/types";
import { ops, useFields, useLegend, useMaxRowBeats, useTags } from "../state/useBoard";
import { resolveNodeColor, resolveNodeColorId, resolveNodeEntry, textColor } from "../colors";
import { isNested } from "../state/nesting";
import { useBoardUI } from "./context";
import { useIsDropAt } from "./dropTarget";
import { TagTabs, tagAttr } from "./TagTabs";
import { cardFill } from "./tagSplit";
import { NoteDot } from "./NoteDot";
import { CardSlots } from "./CardSlots";
import { hasPicture } from "./cardImage";
import { ImageFrame, SidePicture } from "./ImageFrame";
import { addCard, addCardAt, editCard, useAutoEdit } from "./autoEdit";
import { Editable } from "../ui/Editable";
import { Card } from "./Card";
import { dragStore, liftDragImage, useDropZone } from "./drag";
import { moveDropped } from "./dropMove";
import { select, selection, useIsSelected } from "./selection";
import { cardMenu } from "./cardMenu";
import { insertMenu, type InsertMenuState } from "./insertMenu";
import { RowSeam } from "./RowSeam";
import type { SeamSpec } from "./seam";
import { tilt, pinColor } from "./tilt";
import { fontClass } from "../fonts";
import { useRemoteFocus } from "../state/sync";
import { fold, useFolded } from "../state/fold";
import { useFitText } from "../ui/useFitText";
import { BEAT_CARD_H, LANE_CARD_H, tierStrip } from "./cardSizing";
import { targetFontSize } from "../state/tierDefaults";
import { cardText, plainText, shadowAttr } from "./cardText";

interface Props {
  node: Node;
  depth: number;
  level: LevelDef;
  leafLevel: LevelDef;
  parentId: string | null;
  index: number;
  cards: Node[]; // search-filtered leaf children
  stack?: string[]; // hidden same-tier scenes stacked behind this one
  levels: LevelDef[]; // the whole ladder -- the seam's discs need every tier
  /* Computed by RowView through seamFor, so the object is identity-stable
   * across unrelated re-renders and this memo keeps working. */
  seam: SeamSpec;
  headSpec: SeamSpec | null; // the board-head form (2-tier ladders only)
}

/* shared empty stack: a fresh [] per render would defeat Card's memo */
const EMPTY_STACK: Node[] = [];

/* REMOVE-A-ROW-BREAK, as the same glyph in a negated state.
 *
 * lucide ships no `corner-down-left-off`, but it has a house convention
 * for "not this" -- a diagonal slash `m2 2 20 20`, the identical stroke
 * BellOff / EyeOff / WifiOff carry -- so this is composed exactly the
 * way lucide composes its own: the glyph's two paths plus that slash.
 * Keeping the base glyph is the point: the button is ONE control in two
 * states, so it must not become a different symbol when it flips.
 *
 * The slash is drawn lighter than the glyph so it reads as a modifier ON
 * the symbol rather than part of it (the owner's instinct, in the icon
 * set's own vocabulary rather than as an X). */
function CornerDownLeftOff({ size = 12 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
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
      <polyline points="9 10 4 15 9 20" />
      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
      <path d="m2 2 20 20" opacity={0.5} />
    </svg>
  );
}

/* The leaf-parent tier (spec Sec 5.1, Sec 8): a sticky label pinned left
 * while its card strip scrolls horizontally. The label is a drag handle
 * + same-tier drop target (reorder / re-parent); the strip accepts cards
 * dropped from any lane (appends here). */
/* The gap between two cards. Doubles as the inter-card spacer (so the
 * strip needs no flex gap) and, when editable, a hover-reveal insert
 * point: hold a beat over it and a small "+" fades in (spec Sec 4). */
function InsertSlot({
  onAdd,
  menu,
  at,
  lead,
  alone,
  fill,
  breakCardId,
  broken,
  addLabel,
}: {
  onAdd?: () => void;
  menu?: Omit<InsertMenuState, "x" | "y">;
  /* "Add beat" -- the leaf tier's own name, so the tooltip says what the
   * board calls the thing. Plain, with no "(right-click for options)"
   * tail: the gap's two buttons now cover what that menu was advertising
   * (owner, 2026-08-07: "just a single 'Add beat'"). */
  addLabel?: string;
  /* The card this gap would break AFTER -- set on every gap BETWEEN two
   * cards, which is the only place a break means anything (a break
   * belongs to the card on its left; the strip's leading gap has none,
   * and its trailing gap would only make an empty row). When set, the
   * gap carries a second button beside the "+". */
  breakCardId?: string;
  /* ...and whether that break already exists, which is the difference
   * between "break the row here" and "remove this break". One glyph,
   * one op (ops.toggleBreak): the state decides. */
  broken?: boolean;
  /* The gap BEFORE the very first card of a strip. It takes no resting
   * width -- there is no card to its left to be separated from, and any
   * resting width would indent row 0 past every row below it -- but it
   * still opens when the drop lands there, because `.drop-into` sets a
   * flex-basis and out-specifies the zero (and on hover, because the
   * hover rule out-specifies it too; a hit pad makes the zero-width
   * element hoverable at all). */
  lead?: boolean;
  /* THE ONLY SLOT IN AN EMPTY STRIP, and the one place in a strip where
   * a "+" STANDS AT REST (owner-reported 2026-08-15: no easy way to add
   * a beat to a scene that has none).
   *
   * It is the same exception the empty BOARD already carries, one tier
   * down. "Nothing stands at rest" (2026-08-07) works because there is
   * always a card to hover BESIDE -- and the note that an empty
   * container needs nothing special is true of an empty BAND, whose
   * seam carries a child disc, and false of an empty SCENE: a
   * cards-lane's seam offers its own tier and its ancestors, never the
   * leaf, because the point below a scene means "after this scene". So
   * an empty scene was the one container with no hoverable route to its
   * own children.
   *
   * It also needs a HEIGHT of its own. A slot is `align-self: stretch`,
   * so beside a card it is the card's height; with no card in the row
   * there is nothing to stretch against and it collapsed to the
   * button's own 20px (measured: 15x20 here against 15x80 one row up).
   * The strip publishes the leaf card height as `--beat-h` and the CSS
   * takes its min-height from that, so the empty row matches the row it
   * becomes the moment you press the button. */
  alone?: boolean;
  /* Accept a same-tier card DROP at this gap. Without it, a drop landing
   * between two cards fell through to the strip's append zone and the
   * card teleported to the end of the scene -- the gaps are exactly where
   * a careful cursor aims, so they must mean "insert here". */
  at?: { depth: number; parentId: string; index: number };
  /* T1's tier-default fill -- the disc wears its tier's color like the
   * vertical seam discs do (owner, 2026-08-07: "bring the T1 markers
   * into line"). The TIER default, not the neighbouring card's own
   * color: you aim by tier identity. */
  fill?: { bg: string; border: string };
}) {
  const { boardId } = useBoardUI();
  const drop = useDropZone(at?.depth ?? -1, (item) =>
    at ? moveDropped(item, at.parentId, at.index, boardId) : undefined,
  );
  /* The gap opens when the SHARED insertion point names it -- whether the
   * cursor is in this gap or over the card beside it. One preview, and it
   * is the thing that moves the cards apart. */
  const gap = useIsDropAt(boardId, at?.parentId ?? "", at?.index ?? -1);
  /* A SLOT THAT OPENS PAST THE STRIP'S EDGE SCROLLS INTO VIEW
   * (owner-reported 2026-09-04: "the landing zones at the end of beat
   * rows are still cropped... cut halfway"). The strip scrolls
   * horizontally and its extent grows with the open slot, but nothing
   * moved the scroll, so a card-sized landing at the end of a long
   * strip opened 150px past the edge. After the flex-basis transition
   * (0.13s), scroll by exactly the overhang -- against the PANE's edge,
   * since the strip bleeds 8px past it on purpose -- and the same on
   * the left for a slot opening under a scrolled-off start. */
  const self = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (gap === "no") return;
    const el = self.current;
    if (!el) return;
    const reveal = () => {
      const sc = el.closest(".beats") as HTMLElement | null;
      if (!sc) return;
      const pane = (sc.closest(".pane") as HTMLElement | null)?.getBoundingClientRect();
      const s = sc.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const right = Math.min(s.right, pane?.right ?? Infinity) - 8;
      const left = Math.max(s.left, pane?.left ?? -Infinity) + 8;
      if (r.right > right) sc.scrollLeft += r.right - right;
      else if (r.left < left) sc.scrollLeft -= left - r.left;
    };
    /* On the transition's END, not a timer: the slot's width is what
     * the overhang is measured from, and a timer can fire before the
     * transition has moved (a background tab, a throttled frame). The
     * timer is the fallback for a transition that never runs. */
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "flex-basis") reveal();
    };
    el.addEventListener("transitionend", onEnd);
    const t = window.setTimeout(reveal, 400);
    return () => {
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(t);
    };
  }, [gap]);
  return (
    <div
      ref={self}
      className={
        "beat-insert" +
        (lead ? " beat-insert-lead" : "") +
        (alone ? " beat-insert-alone" : "") +
        (breakCardId ? " beat-insert-pair" : "") +
        (gap !== "no" || drop.over ? " drop-into" : "") +
        (gap === "copy" ? " drop-copy" : "")
      }
      onContextMenu={
        menu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              insertMenu.open({ ...menu, x: e.clientX, y: e.clientY });
            }
          : undefined
      }
      {...(at ? drop.props : {})}
    >
      {onAdd && (
        <button
          className="beat-insert-btn"
          /* data-tip, not title: a native tooltip's ~1s delay is the
           * browser's and cannot be set from CSS or HTML (owner: "takes
           * a long time to appear. halve the time"). See .beat-insert-btn
           * ::after -- same words, a delay we own. aria-label carries the
           * name for anyone not reading pixels. */
          data-tip={addLabel ?? "Add card"}
          aria-label={addLabel ?? "Add card"}
          style={
            fill
              ? { background: fill.bg, borderColor: fill.border, color: textColor(fill.bg) }
              : undefined
          }
          onClick={onAdd}
        >
          <Plus size={12} />
        </button>
      )}
      {breakCardId && (
        <button
          className="beat-break-btn"
          data-tip={broken ? "Remove row break" : "Add row break"}
          aria-label={broken ? "Remove row break" : "Add row break"}
          style={
            fill
              ? { background: fill.bg, borderColor: fill.border, color: textColor(fill.bg) }
              : undefined
          }
          onClick={() => ops.toggleBreak(breakCardId)}
        >
          {broken ? <CornerDownLeftOff size={12} /> : <CornerDownLeft size={12} />}
        </button>
      )}
    </div>
  );
}

/* A run of hidden cards, collapsed to a thin card-edge sliver (spec Sec 4).
 * Colored like the first hidden card; the ">" re-expands the whole run. */
function HiddenRun({
  count,
  bg,
  border,
  onExpand,
}: {
  count: number;
  bg: string;
  border: string;
  onExpand: () => void;
}) {
  return (
    <button
      className="hidden-run"
      aria-label={`Show ${count} hidden card${count === 1 ? "" : "s"}`} data-tip={`Show ${count} hidden card${count === 1 ? "" : "s"}`}
      onClick={onExpand}
      style={{ background: bg, borderColor: border }}
    >
      <ChevronRight size={14} />
    </button>
  );
}

/* Memoized: snapshots share structure (ydoc.ts), so an edit elsewhere on
 * the board hands this lane the exact same node/cards references and the
 * whole row skips re-rendering. */
export const CardsLane = memo(function CardsLane({ node, depth, level, leafLevel, parentId, index, cards, stack, levels, seam, headSpec }: Props) {
  const { query, boardId, settings } = useBoardUI();
  const { cardTilt, pushpinColor, noteDots, cardImages } = settings;
  const maxRowBeats = useMaxRowBeats(boardId); // shared per-board (row structure)
  const searching = query.length > 0;
  const collapsed = useFolded(node.id) && !searching;
  const leafDepth = depth + 1;
  const stackedIds = stack ?? [];

  const laneDrop = useDropZone(
    depth,
    (item, side) => moveDropped(item, parentId, side === "after" ? index + 1 : index, boardId),
    "y", // scenes stack vertically -> drop above/below
    node.id, // ...and a tag target
  );
  const cardDrop = useDropZone(leafDepth, (item) => {
    moveDropped(item, node.id, node.children.length, boardId);
  });

  const tags = useTags();
  const fields = useFields();
  const sceneSelected = useIsSelected(node.id);
  const remote = useRemoteFocus().get(node.id);
  const legend = useLegend(boardId);
  /* T1's tier-default fill for the strip's insert discs (never a
   * neighbouring card's own color -- tier identity is what you aim by,
   * and beats are individually colored). */
  const leafEntry = resolveNodeEntry(legend, undefined, leafLevel.id);
  const leafFill = leafEntry ? { bg: leafEntry.bg, border: leafEntry.border } : undefined;
  /* Published to the strip as `--beat-h` for the empty-strip slot, which
   * has no card to take its height from (InsertSlot's `alone`). Same
   * expression Card uses, so the empty row is exactly the height of the
   * row it becomes when the button is pressed. */
  const beatH = leafLevel.height ?? BEAT_CARD_H;
  /* And the WIDTH, for the drag landing (owner, 2026-09-04: the open
   * slot should "resemble the shape and spacing of a full card"). The
   * same expression Card uses for its inline width. */
  const beatW = Math.round(beatH * (leafLevel.aspect ?? 1.45));
  const firstBeat = node.children[0];
  const peek = resolveNodeColor(legend, firstBeat?.color, leafLevel.id, !!firstBeat && isNested(firstBeat));
  const showPeek = collapsed && node.children.length > 0;
  // scene label color: explicit color, else this tier's default (Defaults row)
  const labelColor = resolveNodeColor(legend, node.color, level.id);
  const labelColorId = resolveNodeColorId(legend, node.color, level.id); // legend hover
  const tierLabelTxt = level.textColor ?? textColor(labelColor.bg);
  // Fixed-aspect notecard: per-tier height (defaults to the shared level-2+
  // anchor); the tier aspect widens/narrows it (width = height * aspect).
  const labelH = level.height ?? LANE_CARD_H;
  const labelW = Math.round(labelH * (level.aspect ?? 1.45));
  /* THE STRIP this tier holds beside its cards for a picture
   * (cardSizing.ts). The CARD is untouched by it -- the picture is a
   * sibling standing next to it, not something inside it -- and the
   * strip is held whether or not this card has a picture, so every
   * scene card starts at the same place and so does every beat strip. */
  const strip = tierStrip(level, labelW, labelH, cardImages);
  const tierLabelFont = targetFontSize(level, false);
  /* The card's own text: the tier's answer plus any per-card override. */
  /* PLAIN whenever the picture is not UNDER the words: the switch has
   * hidden it, or it is standing beside the card rather than behind
   * them. A side card wearing the photo caption's white-and-shadow on
   * its own paper was the bug he caught (2026-09-09). */
  const plainWords = plainText(node, cardImages);
  const ink = cardText(node, tierLabelTxt, tierLabelFont, plainWords);
  const labelTxt = ink.color;
  const labelFont = ink.size;
  // an open title field stops the card being draggable -- see LaneHeader.
  // Declared above the fit because the fit depends on it: an empty title
  // renders a blank FIELD while editing and a placeholder SPAN at rest.
  const [editing, setEditing] = useState(false);
  // always shrinks to fit; "expand" raises the cap to the card height
  const fit = useFitText(node.title, labelFont, 8, {
    fontKey: node.font ?? level.defaultFont, // re-fit when the typeface changes
    editing,
    layoutKey: `${node.titleAlign ?? ""}|${node.imageFit ?? ""}`,
  });
  const kbEdit = useAutoEdit(node.id); // keyboard nav's Enter opens the title
  // being dragged: hidden but keeping its space (see Card.tsx's note)
  const [lifted, setLifted] = useState(false);

  // Adding a beat appends at the end, so snap the strip to the far right
  // to reveal it. Flag the add and scroll once the new card is in the DOM.
  const beatsRef = useRef<HTMLDivElement>(null);
  const snapToEnd = useRef(false);
  const addBeat = () => {
    snapToEnd.current = true;
    addCard(node.id);
  };
  useLayoutEffect(() => {
    if (snapToEnd.current && beatsRef.current) {
      beatsRef.current.scrollLeft = beatsRef.current.scrollWidth;
      snapToEnd.current = false;
    }
  }, [node.children.length]);

  // A hidden card tucks behind the visible card before it (its stack top).
  // Hidden cards with no preceding visible card ("orphan") fall back to a
  // standalone peek. Hide is ignored while searching so matches stay visible.
  type BeatItem =
    | { type: "card"; card: Node; stack: Node[] }
    | { type: "orphan"; cards: Node[]; key: string };
  const beatItems: BeatItem[] = [];
  for (const card of cards) {
    if (card.hidden && !searching) {
      const last = beatItems[beatItems.length - 1];
      if (last && last.type === "card") last.stack.push(card);
      else if (last && last.type === "orphan") last.cards.push(card);
      else beatItems.push({ type: "orphan", cards: [card], key: "orphan-" + card.id });
    } else {
      beatItems.push({ type: "card", card, stack: [] });
    }
  }

  /* Split the strip into rows: after any manually-broken beat, and
   * automatically once a row reaches `maxRowBeats` (Options -> Max beats
   * per row). Rows no longer need to remember WHICH of the two broke
   * them: every interior row-end gap carries the return glyph either
   * way, and whether it removes or creates reads off the left-hand
   * card's own `breakAfter`. (It used to flag `manualBreak` so only
   * user-broken rows showed a "-" chip.) */
  type Row = { items: BeatItem[] };
  const cap = Math.max(1, maxRowBeats);
  const rows: Row[] = [];
  let cur: Row = { items: [] };
  for (const it of beatItems) {
    if (cur.items.length >= cap) {
      rows.push(cur);
      cur = { items: [] };
    }
    cur.items.push(it);
    if (it.type === "card" && it.card.breakAfter) {
      rows.push(cur);
      cur = { items: [] };
    }
  }
  if (cur.items.length > 0 || rows.length === 0) rows.push(cur);

  /* THE CARD'S MENU, and the picture's too (his ask, 2026-09-09: "lets
   * make the image area also right clickable as if it's the card"). One
   * handler given to both, since the space beside a card belongs to that
   * card -- a second copy on the strip is the drift this file keeps
   * being warned about.
   *
   * Right-clicking a card OUTSIDE the current selection takes the
   * selection (owner's call): the menu acts on what you clicked, so
   * leaving another card lit says the wrong thing. Inside a
   * multi-selection it changes nothing -- that is how "recolor these
   * six" survives the right-click that starts it. */
  const openCardMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!sceneSelected) select(node.id, "single");
    cardMenu.open(node, e.clientX, e.clientY, {
      boardId,
      parentId,
      index,
      depth,
      colorable: true,
      stackedIds,
    });
  };

  /* HOW FAR THE PICTURE HANGS PAST THE CARD, top and bottom (0 without
   * a strip, or when the strip's width has capped the picture short of
   * the card). The row's height is deliberately the CARD's, so this much
   * of the picture sits OUTSIDE the row at each end -- which means the
   * gap to the next row has to make room for two of them, this row's
   * bottom and the next row's top. index.css does that arithmetic. */
  const overhang = strip.edge ? Math.max(0, Math.round((strip.h - labelH) / 2)) : 0;

  return (
    <div className="scene-row" style={{ "--strip-overhang": `${overhang}px` } as CSSProperties}>
      {/* THE PINNED HOST holds the card AND the picture standing beside
          it (cardSizing.ts). It carries the sticky, not the card, so the
          picture pins to the left edge with it rather than sliding under
          the board; the card keeps `position: relative` so it is still
          the containing block its corner controls are placed against.
          With no strip this is one element around one card and lays out
          exactly as the bare card did. */}
      {/* `--seam-gap-top` is the CARD's height inside the host, which is
          where the gap below it starts. Handed over rather than measured
          -- the tier already told us, and measuring is the machinery
          RowSeam's design deleted.

          AND `--seam-strip-*` IS WHERE THE CARD BEGINS ACROSS
          (owner-reported 2026-09-10, with a screenshot: the insert discs
          "appear to have moved on us"). The host is the card AND the
          picture beside it, so a seam pinned to the host's own left edge
          starts at the PICTURE's, and the discs walked out into the
          margin -- `--seam-indent` then pulled them further left still.
          The seam belongs to the card, so it is inset past whichever
          side the strip holds. Handed over for `--seam-gap-top`'s reason:
          tierStrip already knows the width, so nothing measures. */}
      <div
        className="scene-host"
        data-strip={strip.edge ?? undefined}
        style={
          {
            "--seam-gap-top": `${labelH}px`,
            "--seam-strip-left": strip.edge === "left" ? `${strip.w}px` : "0px",
            "--seam-strip-right": strip.edge === "right" ? `${strip.w}px` : "0px",
            /* `--seam-gap-top` is also THE STRIP'S HEIGHT (index.css):
               the picture's room is the card's room, and anything taller
               overhangs it rather than growing the row. */
          } as CSSProperties
        }
      >
      {strip.edge === "left" && (
        <span
          className="scene-strip"
          data-edge="left"
          data-center={strip.center ? "on" : undefined}
          style={{ width: strip.w, paddingRight: strip.gap }}
          onContextMenu={openCardMenu}
        >
          <SidePicture node={node} strip={strip} />
        </span>
      )}
      {/* Collapsed + has beats: a sliver of the first card peeks out behind
          the label's right edge -- the cue that hidden content exists (a
          solo scene with no beats shows nothing to peek at). */}
      {showPeek && (
        <span
          className="scene-peek"
          style={{
            background: peek.bg,
            borderColor: peek.border,
            /* AGAINST THE HOST'S RIGHT EDGE, not the card's
               (owner-reported 2026-09-09: "the little stack element isn't
               moving with these image cards"). This is absolutely
               positioned, and its containing block is `.scene-host` now
               that the host carries the sticky -- so a picture standing
               on the LEFT pushed the card out from under it and left the
               sliver stranded in the middle. Reading the host also gets
               the RIGHT-hand case right for free: the sliver stands for
               the hidden beats, the beats are past everything, so it
               belongs after the picture rather than under it. With no
               strip the host IS the card and this is the number it
               always was. */
            left: labelW + strip.w - 8,
            height: Math.max(labelH - 24, 16),
          }}
          aria-hidden
        />
      )}
      <div
        className={
          "scene-label hoverable" +
          /* `has-image` is what the "images only" rule hides a title by.
             A Side card is EXEMPT while the switch is on -- its title
             sits on paper beside the picture rather than over it, and
             hiding it left an empty rectangle -- but takes the class in
             "only", where the picture becomes the card and the words
             genuinely have no place (owner, 2026-09-09, both halves). */
          (cardImages !== "off" && hasPicture(node) && (cardImages === "only" || node.imageFit !== "side")
            ? " has-image"
            : "") +
          (laneDrop.over && laneDrop.copy ? " drop-copy" : "") +
          (laneDrop.tagOver ? " tag-drop" : "") +
          (sceneSelected ? " selected" : "") +
          (lifted ? " drag-lifted" : "")
        }
        title={remote ? `${remote.name} is editing` : undefined}
        data-tags={tagAttr(node.tags)}
        data-title-align={node.titleAlign}
        data-text-shadow={shadowAttr(node, plainWords)}
        data-color={labelColorId}
        data-node={node.id}
        draggable={!searching && !editing}
        onDragStart={(e) => {
          if (!sceneSelected) selection.clear(); // drag an unselected card = just it
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
        onContextMenu={openCardMenu}
        style={
          {
            ...cardFill(labelColor.bg, node.tags, tags),
            borderColor: labelColor.border,
            width: labelW,
            height: labelH,
            minHeight: labelH,
            outline: remote ? `2px solid ${remote.color}` : undefined,
            outlineOffset: remote ? 1 : undefined,
            transform: cardTilt ? `rotate(${tilt(node.id)}deg)` : undefined,
            ...(pushpinColor === "random" ? { "--pin-color": pinColor(node.id) } : {}),
          } as CSSProperties
        }
        {...laneDrop.props}
      >
        {/* A PICTURE ON A SCENE CARD (board/cardImage.ts). Same treatment
            as a beat card's: it fills the card and the title becomes a
            caption over the bottom of it. Not draggable -- the browser's
            own image drag would fight the card's. */}
        <ImageFrame node={node} asCard={cardImages === "only" && node.imageFit === "side"} />
        <TagTabs ids={node.tags} tags={tags} nodeId={node.id} boardId={boardId} w={labelW} h={labelH} />
        <NoteDot notes={node.notes} on={noteDots} nodeId={node.id} />
        <CardSlots node={node} fields={fields} color={labelTxt} />
        {/* scene-title-wrap is the fit box: useFitText sizes it (max = the
            tier text size) and the title inherits, shrinking to fit the card */}
        <div className="scene-title-wrap" ref={fit.ref} onInput={fit.remeasure}>
          {/* tier default font applies to the title only */}
          <div className={fontClass(node.font ?? level.defaultFont).trim()}>
            <Editable
              value={node.title}
              placeholder={level.name + " name"}
              multiline /* Shift+Enter breaks the line, as on a beat card */
              autoEdit={kbEdit}
              focusId={node.id}
              focusField="title"
              onEditing={setEditing}
              onCommit={(v) => ops.setNodeField(node.id, "title", v)}
              style={{ fontWeight: 600, color: labelTxt, textAlign: "center" }}
            />
          </div>
        </div>
        {/* No hover tools (owner's call, 2026-08-02): the cluster sat where
            the mouse already was and the trash can got hit by accident.
            Delete/move live in the right-click menu; the whole card drags. */}
        {/* Collapse toggle rides the card's right edge: "<" open, ">" closed
            (sitting over the peeking card when there are hidden beats). */}
        <button
          className="scene-collapse"
          onClick={(e) => {
            e.stopPropagation();
            fold.toggle(node.id);
          }}
          aria-label={collapsed ? "Show " + leafLevel.name.toLowerCase() + "s" : "Hide " + leafLevel.name.toLowerCase() + "s"} data-tip={collapsed ? "Show " + leafLevel.name.toLowerCase() + "s" : "Hide " + leafLevel.name.toLowerCase() + "s"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* Stacked-behind scenes: thin offset slivers peeking below the
            label + a chip to un-stack the whole run (spec Sec 4). */}
        {stackedIds.length > 0 && (
          <>
            {stackedIds.slice(0, 4).map((id, k) => (
              <span
                key={id}
                className="scene-stack-sliver"
                style={{ bottom: -(3 + k * 3), left: 8 + k * 4, zIndex: -(k + 1) }}
                aria-hidden
              />
            ))}
            <button
              className="scene-stack-expand"
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
      {/* THE SEAM below this card -- "insert after me", any tier up the
          ladder (board/seam.ts). It hangs off the HOST, not the card
          (owner, 2026-09-10: the controls "should park above the card
          below it, rather than below the card that has multiple rows of
          beats"). The host is `align-self: stretch`, so its bottom edge
          is the ROW's bottom -- which on a tall row is where the next
          card begins, and on an ordinary one is the card's own bottom,
          exactly where this always sat. Still no measuring, which is the
          machinery this design deleted.

          Counter-tilted so the discs stay level under the Tactile
          look. */}
      <RowSeam
        spec={seam}
        levels={levels}
        legend={legend}
        rowDepth={depth}
        variant="card"
        tilt={cardTilt ? tilt(node.id) : 0}
      />
      {/* The board's head (a 2-tier ladder puts a cards-lane first):
          the one gap below-ownership leaves unowned, hung above. */}
      {headSpec && (
        <RowSeam
          spec={headSpec}
          levels={levels}
          legend={legend}
          rowDepth={depth}
          variant="card"
          above
          tilt={cardTilt ? tilt(node.id) : 0}
        />
      )}
      {strip.edge === "right" && (
        <span
          className="scene-strip"
          data-edge="right"
          data-center={strip.center ? "on" : undefined}
          style={{ width: strip.w, paddingLeft: strip.gap }}
          onContextMenu={openCardMenu}
        >
          <SidePicture node={node} strip={strip} />
        </span>
      )}
      </div>

      {!collapsed && (
        <div ref={beatsRef} className="beats row-scroll">
          {/* the drop zone is the INNER box: the scroller's padding exists to
              let tag tabs overhang, and a zone there would swallow drops aimed
              at a card (it wraps every one of them) */}
          <div
            className={
              "beats-inner" +
              // per-card edge markers guide precise insertion; the container
              // only shows a highlight when empty (nothing to insert between)
              (cardDrop.over && cards.length === 0 ? " drop-into" : "")
              // `no-cards` went with the lifted-shadow padding it existed for:
              // that padding was bottom-heavy and floated a lone add-beat "+"
              // off the chevron, so an empty strip had to opt out. The shadow
              // reserve is a bleed on .beats now and takes no space, so there
              // is nothing left to opt out of.
            }
            style={{ "--beat-h": `${beatH}px`, "--beat-w": `${beatW}px` } as CSSProperties}
            {...cardDrop.props}
          >
          {rows.map((row, r) => {
            const rowItems = row.items;
            return (
            <div className="beat-row" key={r}>
              {rowItems.map((item, i) => {
                const prev = rowItems[i - 1];
                /* THE GAP BEFORE THE FIRST CARD (owner-reported
                   2026-08-05: "dragging a beat backwards is not
                   generating a drop zone before the first card, though i
                   can drop something there"). Slots hang between items
                   and at the end of each row, and a row's trailing slot
                   covers the boundary into the next row -- so every
                   insertion point had an element EXCEPT the one at the
                   very start, which has no previous row to hang off.
                   The drop resolved fine; there was simply nothing to
                   draw it. Row 0 only: any later row's leading gap is
                   already the previous row's trailing slot, and minting
                   both would light two elements for one insertion
                   point. */
                const leadSlot = r === 0 && i === 0 && !searching && item.type === "card" && (
                  <InsertSlot
                    lead
                    fill={leafFill}
                    addLabel={"Add " + leafLevel.name.toLowerCase()}
                    /* the + this gap never had -- the strip's own board
                       head, brought into line with the vertical one */
                    onAdd={() => addCardAt(node.id, node.children.indexOf(item.card))}
                    at={{ depth: leafDepth, parentId: node.id, index: node.children.indexOf(item.card) }}
                    menu={{
                      parentId: node.id,
                      index: node.children.indexOf(item.card),
                      childName: leafLevel.name,
                      breakId: null,
                      broken: false,
                    }}
                  />
                );
                const insert = i > 0 && (
                  <InsertSlot
                    fill={leafFill}
                    addLabel={"Add " + leafLevel.name.toLowerCase()}
                    /* between two cards: this gap can break the row after
                       the card on its left (or remove that break) */
                    breakCardId={
                      searching || !prev || prev.type !== "card" ? undefined : prev.card.id
                    }
                    broken={prev?.type === "card" ? !!prev.card.breakAfter : false}
                    onAdd={
                      searching || item.type !== "card"
                        ? undefined
                        : () => addCardAt(node.id, node.children.indexOf(item.card))
                    }
                    at={
                      searching || item.type !== "card"
                        ? undefined
                        : { depth: leafDepth, parentId: node.id, index: node.children.indexOf(item.card) }
                    }
                    menu={
                      searching || item.type !== "card"
                        ? undefined
                        : {
                            parentId: node.id,
                            index: node.children.indexOf(item.card),
                            childName: leafLevel.name,
                            breakId: prev && prev.type === "card" ? prev.card.id : null,
                            broken: prev?.type === "card" ? !!prev.card.breakAfter : false,
                          }
                    }
                  />
                );
                if (item.type === "orphan") {
                  const c = resolveNodeColor(legend, item.cards[0]?.color, leafLevel.id, !!item.cards[0] && isNested(item.cards[0]));
                  return (
                    <Fragment key={item.key}>
                      {leadSlot}
                      {insert}
                      <HiddenRun
                        count={item.cards.length}
                        bg={c.bg}
                        border={c.border}
                        onExpand={() => ops.setHidden(item.cards.map((x) => x.id), false)}
                      />
                    </Fragment>
                  );
                }
                const card = item.card;
                const idx = node.children.indexOf(card);
                const expand = () => ops.setHidden(item.stack.map((x) => x.id), false);
                return (
                  <Fragment key={card.id}>
                    {leadSlot}
                    {insert}
                    <div className={"beat-stack" + (item.stack.length ? " has-stack" : "")}>
                      {item.stack.map((sc, k) => {
                        const c = resolveNodeColor(legend, sc.color, leafLevel.id, isNested(sc));
                        return (
                          <span
                            key={sc.id}
                            className="stack-sliver"
                            style={{ right: -(2 + k * 2), zIndex: -(k + 1), background: c.bg, borderColor: c.border }}
                          />
                        );
                      })}
                      {item.stack.length > 0 && (
                        <button
                          className="stack-expand"
                          aria-label={`Show ${item.stack.length} stacked card${item.stack.length === 1 ? "" : "s"}`} data-tip={`Show ${item.stack.length} stacked card${item.stack.length === 1 ? "" : "s"}`}
                          onClick={expand}
                        >
                          <ChevronRight size={13} />
                        </button>
                      )}
                      <Card
                        card={card}
                        depth={leafDepth}
                        leafLevel={leafLevel}
                        parentId={node.id}
                        index={idx}
                        draggable={!searching}
                        stack={item.stack.length ? item.stack : EMPTY_STACK}
                      />
                    </div>
                  </Fragment>
                );
              })}
              {/* manually-broken row: a "-" to remove the break (right-click for
                  options). Auto-wrapped rows have no break to remove. */}
              {/* THE SLOT AT THE END OF A ROW (owner-reported 2026-08-05:
                  "there's not a box appearing at the end of a row of
                  beats -- i can potentially drop things there, but the
                  visual breaks"). Slots were rendered only BETWEEN items
                  (`i > 0`), so both ends of every row had none: the drop
                  resolved fine and there was no element to draw it.

                  It hangs at the END of the row rather than the start of
                  the next one, which is where the eye expects it -- and
                  the two are the SAME insertion point, so only one of
                  them may exist or the invariant breaks (one reorder =
                  one slot). Its index is the next row's first card
                  precisely so they cannot both be minted: reading the
                  index off the NEXT row states the canonical home ("the
                  gap before the next sibling") in the terms a wrapped
                  strip has, and the last row falls through to the end of
                  the run, which is the after-form. */}
              {!searching &&
                (() => {
                  const nx = rows[r + 1];
                  const firstOf = (items: typeof rowItems) => {
                    const it = items[0];
                    if (!it) return null;
                    return it.type === "card" ? it.card : (it.cards[0] ?? null);
                  };
                  const k = nx
                    ? (() => {
                        const c = firstOf(nx.items);
                        const i = c ? node.children.indexOf(c) : -1;
                        return i < 0 ? null : i;
                      })()
                    : node.children.length;
                  if (k === null) return null;
                  /* An INTERIOR row end sits between two real cards, so
                     it takes the pair like any other gap -- and it is
                     exactly where a wrap gets removed. The strip's own
                     trailing gap (no next row) stays a lone +: a break
                     after the last card would only make an empty row. */
                  const lastCard = [...rowItems].reverse().find((it) => it.type === "card");
                  const breakCard = nx && lastCard?.type === "card" ? lastCard.card : null;
                  return (
                    <InsertSlot
                      fill={leafFill}
                      addLabel={"Add " + leafLevel.name.toLowerCase()}
                      /* the strip is empty, so this is its ONLY slot and
                         there is nothing to hover beside -- it stands at
                         rest and takes a card's height (see `alone`) */
                      alone={cards.length === 0}
                      breakCardId={breakCard?.id}
                      broken={!!breakCard?.breakAfter}
                      /* the last row's trailing + IS the old add-beat
                         chip's job: append (with its snap-to-end scroll) */
                      onAdd={() => (k === node.children.length ? addBeat() : addCardAt(node.id, k))}
                      at={{ depth: leafDepth, parentId: node.id, index: k }}
                      menu={{
                        parentId: node.id,
                        index: k,
                        childName: leafLevel.name,
                        breakId: breakCard?.id ?? null,
                        broken: !!breakCard?.breakAfter,
                      }}
                    />
                  );
                })()}
            </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
});
