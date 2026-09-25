import { memo, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { LegendEntry, LevelDef, Node, TagDef } from "../../state/types";
import { resolveNodeColor, resolveNodeColorId, textColor } from "../../colors";
import { hit } from "../../state/counts";
import { cardMenu } from "../cardMenu";
import { useBoardUI } from "../context";
import { nestFace } from "../NestedFace";
import { searchTitle } from "../../state/nesting";
import { isNested } from "../../state/nesting";
import { openNested } from "../openNested";
import { dragStore, useDropZone } from "../drag";
import { moveDropped } from "../dropMove";
import { select, selection, useIsSelected } from "../selection";
import { fontClass } from "../../fonts";
import { BEAT_MINI, HEAD_PAD_X, HEAD_PAD_Y, LANE_MINI } from "../cardSizing";
import { MiniCard, tierGeometry } from "./MiniCard";
import { TagTabs, tagAttr, useBoxSize } from "../TagTabs";
import { cardFill } from "../tagSplit";
import { NoteDot } from "../NoteDot";
import { overviewTip, tipCardFor } from "./overviewTip";
import { ImageFrame } from "../ImageFrame";
import { cardText, plainText } from "../cardText";
import type { CardImages } from "../../state/settings";
import { hasPicture } from "../cardImage";

// Every tier is drawn as its REAL detail card, CSS-scaled down (MiniCard):
// beats by BEAT_MINI, scene + header cards by LANE_MINI. With default tier
// heights that reproduces the old flat 18px / 36px proxies; a tier with a
// custom height now scales with it instead of being pinned to a fixed size.
// A "fit to width" (fullWidth) tier has no card in the detail view either, so
// it keeps the full-width band.
// Beat titles only render once a beat is at least this tall on screen (unscaled
// height * zoom); below it the text would be illegible, so we skip the
// per-beat fit work and draw a plain color cell instead.
const OV_BEAT_TEXT_MIN = 15;

/* A PICTURE ON A PROXY, above this many on-screen pixels of height
 * (the proxy's unscaled height * zoom) -- the same shape of gate as the
 * beat-text one above, and for a related but not identical reason.
 *
 * The Overview's premise is the whole board as CHEAP COLOR PROXIES:
 * color is the scanning dimension, and it is what the legend filters
 * on. A full-bleed photo takes a card's color out of that read. So the
 * board stays a color map while you are using it as one, and becomes
 * photographs once you are close enough to look at them. Zoom out and
 * the color comes back.
 *
 * WHERE 24 LANDS, with default tier geometry: a scene or header proxy is
 * 36px tall, so it shows its picture from zoom 0.67 up; a beat cell is
 * 18px, so it needs 1.33. At a big board's fit zoom (0.15-0.4) nothing
 * draws at all, which is also the only real cost control here -- the
 * Overview is not virtualized, so above the gate every image on screen
 * is a live element. (`loading="lazy"` would do nothing for that: these
 * are data: URIs, already in memory, and the cost is decode rather than
 * fetch.)
 *
 * IT DOES NOT APPLY TO A SIDE-BY-SIDE PICTURE (owner, 2026-09-10: "this
 * is specifically about the side-by-sides"). The premise above is about
 * a photo REPLACING a card's color; a side picture stands BESIDE the
 * card and takes none of it, and the room for it is reserved at every
 * zoom whether or not the picture draws -- so gating it left a hole in
 * the layout that the gate itself had made. Lowering the number instead
 * was tried and does not work: a scene proxy at a real board's fit zoom
 * measures under 4px, below any floor worth keeping. Only boards using
 * the mode pay anything, and a card thumbnail is ~9KB decoding in
 * ~0.75ms (measured 2026-09-10), so even 300 is ~225ms once.
 *
 * It is ONE number, and moving it moves both thresholds together. */
const OV_IMAGE_MIN = 24;

/* The tier one ABOVE the deepest one drawn is at least this many of its
 * children wide. When "Detail level" cuts the beats off, a column loses
 * the wide beat rows that used to set its width, so it collapses onto a
 * single card and the header band wraps its title over three or four
 * lines. (A spine's HEIGHT is OverviewView's job -- it's the one that
 * knows the column tier. See spineHeight there.) */
const HEAD_MIN_CHILDREN = 3;

interface Props {
  node: Node;
  depth: number;
  parentId: string | null;
  index: number;
  levels: LevelDef[];
  legend: LegendEntry[];
  leaf: number;
  q: string;
  onJump: (id: string) => void;
  onSelect: (id: string) => void; // single click -- may drive a sibling pane
  beatText: boolean; // Overview beat text toggle (from settings)
  zoom: number; // current Overview zoom, to gate beat text by on-screen size
  maxRowBeats: number; // auto-wrap a beat row after this many cells (from settings)
  tags: TagDef[]; // project tag vocabulary, threaded down (not a hook per cell)
  noteDots: boolean; // the note indicator, threaded for the same reason
  images: CardImages; // the board's images switch, in full: "on" | "only" | "off"
  /* "Detail level": the deepest tier this Overview draws. A node AT this
   * depth renders its own card and stops -- no children, no beat cells.
   * Defaults to the leaf, which is what the Overview always did. */
  maxDepth?: number;
  /* Draw this node as a SPINE instead: the vertical bar that stands
   * between columns for a tier ABOVE the column tier (overviewLayout's
   * collectItems). Everything else about it -- color, selection, drag,
   * menu, hover preview -- is the same proxy, which is why this is a
   * mode here rather than a second component. */
  spine?: boolean;
  spineHeight?: number; // its fixed height in px (OverviewView computes it)
}

/* One node drawn as a color proxy in the Overview. Recurses to leaves.
 *   leaf         -> a small color cell (no text; title in tooltip)
 *   leaf-parent  -> a thin color tag + a wrap of its leaf cells
 *   deeper       -> a labeled color band + a stack of child proxies
 * Interactive by reuse: right-click -> shared CardContextMenu; drag ->
 * dragStore + moveDropped (same-tier reorder / reparent, multi-select
 * aware, cross-board = copy); single click -> select (and steer a linked
 * Detail pane); double click -> jump to the detail view.
 * Memoized: the Overview is NOT virtualized, so on any doc change every
 * proxy used to re-render; structural-sharing snapshots keep node/levels/
 * legend identities stable, so only the changed subtree re-renders. */
export const ProxyNode = memo(function ProxyNode({
  node,
  depth,
  parentId,
  index,
  levels,
  legend,
  leaf,
  q,
  onJump,
  onSelect,
  beatText,
  zoom,
  maxRowBeats,
  tags,
  noteDots,
  images,
  maxDepth,
  spine,
  spineHeight,
}: Props) {
  const { boardId, nests } = useBoardUI(); // the pane's board (drag source / drop target)
  /* A NESTING CARD stands in for another board, so it shows that board's
   * title -- here as well as in detail, or the Overview would draw the
   * node's own (deliberately unread) one and the card would come out
   * blank. board/NestedFace.tsx is the one definition. */
  const face = nestFace(node, nests);
  // a band's (or spine's) box is content-driven here too, so measure it
  const bandRef = useRef<HTMLDivElement>(null);
  const band = useBoxSize(bandRef, !spine && !levels[depth]?.fullWidth);
  const c = resolveNodeColor(legend, node.color, levels[depth]?.id ?? "", isNested(node));
  // the legend entry that painted it -- the hover-highlight matches on this
  const colorId = resolveNodeColorId(legend, node.color, levels[depth]?.id ?? "", isNested(node));
  const searching = q.length > 0;
  /* The search dims every card whose OWN TITLE doesn't match, at every
   * tier (owner's ask, 2026-08-03: "we're just searching strings"). It
   * used to dim beats only, so a filtered Overview left every scene, day
   * and reel at full strength and the hits didn't stand out. Same 0.22
   * the legend's tag/color hover uses -- in the Overview a search IS
   * that gesture, so it should look like it, and that means a lane
   * holding a match dims like everything else rather than bracketing it.
   *
   * NOTE this deliberately differs from the DETAIL view, which filters
   * on `hasLeafMatch` -- leaf titles only, lanes kept for the matches
   * they contain. Dimming is non-destructive, so the Overview can light
   * a scene whose own name matches; detail would have to decide what to
   * DO with it (show the lane? its beats too?), which is a different
   * question and wasn't asked. */
  const dim = searching && !hit(searchTitle(node, nests), q);
  // Drop before/after the hovered proxy, marked on that edge. Beats sit in a
  // horizontal row (split "x"); scenes + bands stack vertically (split "y").
  const drop = useDropZone(
    depth,
    (item, side) => moveDropped(item, parentId, side === "after" ? index + 1 : index, boardId),
    // spines stand in a ROW, so they take a drop on their left/right edge
    // like beats do, not top/bottom like the things they sit above
    spine || depth === leaf ? "x" : "y",
    node.id, // tags drop onto Overview proxies too
  );
  const isSel = useIsSelected(node.id);
  // Scene cards keep a fixed notecard aspect; the title shrinks to fit
  // (down to 1px -- the hover tooltip covers legibility).
  //
  // EVERY card here fits through the shared queue (`visibleOnly`), not
  // just the beat cells. Scenes used to fit immediately on the grounds
  // that there are "few" of them -- true of ten, false of six hundred,
  // and each immediate fit forces a reflow of the whole unvirtualized
  // Overview. Measured on a 3220-node board: 108s of blocked thread.
  //
  // A card is drawn as a true miniature of its detail card: it renders at
  // the DETAIL card's size (so the fit runs at a legible font where
  // rounding is negligible and lands on the exact same line wrapping),
  // then a CSS transform scales it down into the cell.
  const lvl = levels[depth];
  const isLeafTier = depth === leaf;
  // the detail card's real geometry, shared with the hover preview and the
  // metadata panel's card preview (tierGeometry -- one notion of "real")
  const geo = tierGeometry(levels, depth, images);
  // the WHOLE card, room included, so a roomed tier proxies at its real shape
  const targetH = geo.boxH * (isLeafTier ? BEAT_MINI : LANE_MINI);
  const titleFont = fontClass(node.font ?? lvl?.defaultFont);
  /* Big enough on screen to be worth a picture? Asked PER HOST with that
   * host's own height, which is the whole reason this is a function and
   * not one value: the four things a proxy can be are wildly different
   * sizes, and `targetH` describes only the card-shaped ones. A spine is
   * 300px+ of vertical bar and a band is ~19px, so pricing either off a
   * 36px card would gate it at the wrong zoom in opposite directions.
   *
   * Handed down as the NODE rather than a flag, so a card with no image
   * costs nothing either way. Deliberately independent of the "Beat text"
   * toggle (owner's call): that control is about TEXT, and someone with
   * it off may well still want to see their stills. */
  /* `hasPicture`, NOT `node.image`: a grabbed STILL is a picture too, and
   * testing the data URI alone meant an EDL or player frame never drew
   * here at ANY zoom (owner-reported 2026-09-10). The same drift
   * `cardImage.ts`'s helper exists to stop, and MiniCard's own comment
   * records catching it as the seventh host; this was the eighth.
   *
   * A SIDE picture skips the size gate entirely -- see the constant. */
  const imgAt = (onScreenH: number): Node | undefined =>
    !hasPicture(node)
      ? undefined
      : node.imageFit === "side" || onScreenH * zoom >= OV_IMAGE_MIN
        ? node
        : undefined;
  const imageNode = imgAt(targetH); // the card-shaped hosts: proxies + cells
  /* THE CARD'S OWN TEXT for the card-shaped proxies (owner-reported
   * 2026-09-08, the hover preview first): color and size through the
   * one resolver the detail card uses (board/cardText.ts). `plain` --
   * the tier's ink, no shadow -- whenever the picture is NOT DRAWN
   * here: the one rule (`plainText`: hidden by the board's switch, or
   * standing beside the card) PLUS this surface's own term, a picture
   * below this proxy's size gate (`imageNode` unset), since a white
   * caption on a bare cell is the exact drift that resolver exists to
   * stop. */
  const plain = plainText(node, images) || (hasPicture(node) && !imageNode);
  const ink = cardText(node, lvl?.textColor ?? textColor(c.bg), geo.fitMax, plain);
  const inkGeo = ink.size === geo.fitMax ? geo : { ...geo, fitMax: ink.size };
  // the same answer for a BAND or a SPINE, whose picture gate is its own height
  const inkAt = (onScreenH: number): string =>
    cardText(node, lvl?.textColor ?? textColor(c.bg), geo.fitMax, plainText(node, images) || (hasPicture(node) && !imgAt(onScreenH))).color;

  /* One card of the tier BELOW this one, at Overview scale -- the unit
   * both minimums below are counted in, so they track the tier sizes
   * rather than being pixel guesses. */
  const kid = (() => {
    if (isLeafTier) return null;
    const g = tierGeometry(levels, depth + 1, images);
    const h = g.detailH * (depth + 1 === leaf ? BEAT_MINI : LANE_MINI);
    return { h, w: h * g.aspect };
  })();

  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // right-click outside the selection takes it -- see Card.tsx
    if (!isSel) select(node.id, "single");
    cardMenu.open(node, e.clientX, e.clientY, {
      boardId,
      parentId,
      index,
      depth,
      colorable: true,
      stackedIds: [],
    });
  };
  // Single click selects (highlight); double click jumps into the detail view.
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      e.preventDefault();
      select(node.id, "range");
    } else if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      select(node.id, "toggle");
    } else {
      select(node.id, "single");
      // linked columns: a Detail pane on this board follows the click
      onSelect(node.id);
    }
  };
  const onDoubleClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // a nesting card's double-click OPENS the board it stands in for,
    // the same gesture it answers in detail (board/openNested.ts)
    if (node.boardRef) openNested.ask(node.boardRef, e.clientX, e.clientY);
    else onJump(node.id);
  };
  const onDragStart = (e: React.DragEvent) => {
    if (!isSel) selection.clear(); // dragging an unselected proxy moves just it
    dragStore.start({ id: node.id, depth, boardId, nested: isNested(node) });
    e.dataTransfer.effectAllowed = "copyMove"; // cross-board drop = copy
  };

  /* Hover preview: the SAME miniature, scaled up instead of down -- this
   * tier's real card (its padding, fit cap and font), built by the shared
   * tipCardFor so the keyboard cursor's preview is the identical card.
   * Metadata values are drawn ONLY in the preview: on a proxy they're
   * illegible by construction -- a beat cell is ~18px tall and the value
   * doesn't scale with it, so it came out as one letter and an ellipsis. */
  const tipCard = tipCardFor(node, depth, levels, legend, nests, images);
  const acts = {
    onContextMenu: openMenu,
    onClick,
    onDoubleClick,
    onDragStart,
    onDragEnd: () => dragStore.end(),
    draggable: true,
    onMouseEnter: (e: MouseEvent) => overviewTip.show(tipCard, e.clientX, e.clientY),
    onMouseMove: (e: MouseEvent) => overviewTip.show(tipCard, e.clientX, e.clientY),
    onMouseLeave: () => overviewTip.hide(),
    ...drop.props,
  };
  const state =
    (isSel ? " ov-sel" : "") +

    (drop.over && drop.copy ? " ov-drop-copy" : "") +
    (drop.tagOver ? " tag-drop" : "");

  /* A SPINE: this tier as a vertical bar between the columns it covers.
   * The detail view's full-width band turned 90 degrees -- same color,
   * same title, reading down the page. It stretches to the tallest
   * column beside it (CSS align-self), so it reads as the bracket around
   * the run it belongs to. */
  if (spine) {
    return (
      <div
        ref={bandRef}
        className={"ov-spine" + state + (imgAt(spineHeight ?? 0) ? " has-image" : "")}
        data-tags={tagAttr(node.tags)}
        data-color={colorId}
        data-node={node.id}
        style={{
          ...cardFill(c.bg, node.tags, tags),
          borderColor: c.border,
          color: inkAt(spineHeight ?? 0),
          height: spineHeight, // fixed, and taller the higher the tier
          opacity: dim ? 0.22 : 1,
        }}
        {...acts}
      >
        {/* Priced off the BAR's height, not a card's: a spine is 300px+
            tall, so it clears the gate at almost any zoom -- which is the
            answer for a shape whose whole job is to be long. The picture
            reads as a strip down the bracket. */}
        {imgAt(spineHeight ?? 0) && <ImageFrame node={node} />}
        <span className="ov-spine-text">{node.title || lvl?.name || ""}</span>
        <TagTabs ids={node.tags} tags={tags} nodeId={node.id} w={band.w} h={band.h} scale={LANE_MINI} />
        <NoteDot notes={node.notes} on={noteDots} nodeId={node.id} />
      </div>
    );
  }

  // "Detail level": stop here rather than drawing what's inside
  const terminal = maxDepth !== undefined && depth >= maxDepth;

  /* A nesting card, at ANY tier: one card, the target board's name, and
   * nothing under it -- it can never have children, so there is nothing
   * to recurse into and no band to head. Drawn with the scene card's
   * treatment rather than its own tier's band, for the reason
   * flatten.ts's "nested" row gives: a band promises a lane below it.
   * NO SYMBOL here (unlike detail) -- at Overview scale the 13px mark
   * lands near 3px, which is a smudge rather than a sign. */
  if (face) {
    return (
      <MiniCard
        className={"ov-scene-card" + state}
        style={{ opacity: dim ? 0.22 : 1 }}
        text={face.title}
        fontClassName={titleFont}
        geo={inkGeo}
        targetH={targetH}
        bg={c.bg}
        border={c.border}
        color={ink.color}
        tagIds={node.tags}
        tags={tags}
        tagNodeId={node.id}
        notes={node.notes}
        noteDots={noteDots}
        data-tags={tagAttr(node.tags)}
        data-color={colorId}
        data-node={node.id}
        data-nested={face.missing ? "missing" : "on"}
        imageNode={imageNode}
        images={images}
        plain={plain}
        slotNode={node} /* alignment + populated rows only: no fields, so no slots draw */
        visibleOnly
        {...acts}
      />
    );
  }

  if (depth === leaf) {
    const w = Math.round(targetH * (geo.boxW / geo.boxH));
    // Beat titles only render once the cell is big enough on screen to read;
    // below that it's a plain color cell and no fit work happens at all.
    if (beatText && targetH * zoom >= OV_BEAT_TEXT_MIN) {
      return (
        <MiniCard
          className={"ov-beat-cell" + state}
          style={{ opacity: dim ? 0.22 : 1 }}
          text={node.title}
          fontClassName={titleFont}
          geo={inkGeo}
          targetH={targetH}
          bg={c.bg}
          border={c.border}
          color={ink.color}
          tagIds={node.tags}
          tags={tags}
          tagNodeId={node.id}
          notes={node.notes}
          noteDots={noteDots}
          data-tags={tagAttr(node.tags)}
          data-color={colorId}
          data-node={node.id}
          imageNode={imageNode}
          images={images}
          plain={plain}
          slotNode={node} /* alignment + populated rows only: no fields, so no slots draw */
          visibleOnly /* thousands of cells: fit only on-screen, a few per frame */
          {...acts}
        />
      );
    }
    // A beat with no text is still a beat with tags -- and the zoomed-out
    // view is exactly where a tag earns its keep, so the cell carries its
    // tabs too, shrunk by the same scale the miniatures use.
    return (
      <span
        className={"ov-cell" + state + (imageNode ? " has-image" : "")}
        data-tags={tagAttr(node.tags)}
        data-color={colorId}
        data-node={node.id}
        style={{
          ...cardFill(c.bg, node.tags, tags),
          borderColor: c.border,
          opacity: dim ? 0.22 : 1,
          width: w,
          height: Math.round(targetH),
        }}
        {...acts}
      >
        {/* The ONE image host that is not a scaled detail card -- a plain
            cell at proxy size. Fill and Fit are `object-fit`, so they are
            identical either way; only TILE differs, since it measures its
            box and this box is the small one, so a tiled beat repeats
            fewer times here than on its detail card. Accepted: tile is
            rare, and the alternative is promoting every imaged beat to a
            full MiniCard, which is exactly the fit work this branch
            exists to avoid. */}
        {imageNode && <ImageFrame node={imageNode} />}
        <TagTabs ids={node.tags} tags={tags} nodeId={node.id} w={w} h={targetH} scale={BEAT_MINI} />
        <NoteDot notes={node.notes} on={noteDots} nodeId={node.id} />
      </span>
    );
  }

  const renderChild = (child: Node, i: number) => (
    <ProxyNode
      key={child.id}
      node={child}
      depth={depth + 1}
      parentId={node.id}
      index={i}
      levels={levels}
      legend={legend}
      leaf={leaf}
      q={q}
      onJump={onJump}
      onSelect={onSelect}
      beatText={beatText}
      zoom={zoom}
      maxRowBeats={maxRowBeats}
      tags={tags}
      noteDots={noteDots}
      images={images}
      maxDepth={maxDepth}
    />
  );
  const kids = terminal ? null : node.children.map(renderChild);

  if (depth === leaf - 1) {
    // group beats into rows: manual breaks + auto-wrap once a row hits the
    // "Max beats per row" cap (keeps columns from overrunning their neighbors)
    const cap = Math.max(1, maxRowBeats);
    const cellRows: { child: Node; i: number }[][] = [[]];
    node.children.forEach((child, i) => {
      if (cellRows[cellRows.length - 1].length >= cap) cellRows.push([]);
      cellRows[cellRows.length - 1].push({ child, i });
      if (child.breakAfter) cellRows.push([]);
    });
    if (cellRows.length > 1 && cellRows[cellRows.length - 1].length === 0) cellRows.pop();
    return (
      <div className="ov-scene">
        {/* the scene's REAL card, scaled down -- same padding,
            fit cap and line-height, so its title breaks where the detail
            card's does */}
        <MiniCard
          className={"ov-scene-card" + state}
          style={{ opacity: dim ? 0.22 : 1 }}
          text={node.title}
          fontClassName={titleFont}
          geo={inkGeo}
          targetH={targetH}
          bg={c.bg}
          border={c.border}
          color={ink.color}
          tagIds={node.tags}
          tags={tags}
          tagNodeId={node.id}
          notes={node.notes}
          noteDots={noteDots}
          data-tags={tagAttr(node.tags)}
          data-color={colorId}
          data-node={node.id}
          /* Queued, like the beat cells -- a real cut has hundreds of
             scenes, and each immediate fit forces a reflow of the whole
             unvirtualized Overview. Measured on a 3220-node board: 108s
             of blocked thread to mount, because ~600 scene cards fitted
             synchronously in one commit. */
          imageNode={imageNode}
          images={images}
          plain={plain}
          slotNode={node} /* alignment + populated rows only: no fields, so no slots draw */
          visibleOnly
          {...acts}
        />
        {!terminal && (
          <OverviewCells sceneId={node.id} leafDepth={leaf} count={node.children.length}>
            {cellRows.map((row, r) => (
              <div className="ov-cell-row" key={r}>
                {row.map(({ child, i }) => renderChild(child, i))}
              </div>
            ))}
          </OverviewCells>
        )}
      </div>
    );
  }

  /* A header tier renders as a card here exactly when it does in the detail
   * view. "Fit to width" (fullWidth) tiers are bands there and stay bands
   * here -- there's no fixed-size card to make a miniature of.
   *
   * A column is `width: min-content`, sized by its widest descendant --
   * normally a beat ROW, which is wide. Cut the beats off with "Detail
   * level" and the widest thing left is one card, so the column collapses
   * onto it and the band above wraps its title over three or four lines.
   * So the tier one above the deepest drawn gets a floor of
   * HEAD_MIN_CHILDREN of its own children, wide. */
  const headMin =
    kid && maxDepth !== undefined && depth === maxDepth - 1
      ? Math.round(HEAD_MIN_CHILDREN * kid.w)
      : undefined;

  /* A BAND IS THE ONE TIER THAT ISN'T A SCALED MINIATURE, so it was the
   * one tier whose title didn't shrink with the board. It has no fixed
   * card box to scale -- it's a real element that wraps to the column's
   * width -- so its text sat at a flat 12px from CSS while every card
   * beside it was a true miniature (a scene's 30px title draws at ~8px
   * here). That is why the black day-bands read as the loudest thing on a
   * zoomed-out board: they were, by about 1.5x.
   *
   * The detail band sets its title to `textSize` (LaneHeader's headFont --
   * a band isn't height-constrained, so it never expands to fill), so the
   * miniature of one is that same number through LANE_MINI, the scale
   * every other lane-tier card here is drawn at. */
  const bandFont = (lvl?.textSize ?? (lvl?.variant === "section" ? 14 : 15)) * LANE_MINI;
  /* ...and its padding through the same scale, from the detail band's own
   * (.lane-card, HEAD_PAD_*). MEASURED, because the obvious follow-up here
   * was wrong: the worry was that a flat `4px 8px` would dominate a band
   * whose text had just shrunk, and it does not. CLB's Reel band is 70px
   * in detail, so a true miniature is 19.2px -- and scaling the FONT alone
   * already landed the band at 19.9px, within 4%. Vertically there was
   * nothing left to fix (16 * LANE_MINI = 4.4px, against the 4px it had).
   * The horizontal padding was the real disproportion: 8px where the
   * miniature is 3.3px, 2.4x too wide, which is why band titles sat
   * further off their left edge than every card beside them. */
  const bandPad = `${(HEAD_PAD_Y * LANE_MINI).toFixed(2)}px ${(HEAD_PAD_X * LANE_MINI).toFixed(2)}px`;
  return (
    <div className="ov-block" style={headMin ? { minWidth: headMin } : undefined}>
      {lvl?.fullWidth ? (
        <div
          ref={bandRef}
          className={"ov-band" + state + (imgAt(band.h) ? " has-image" : "")}
          data-tags={tagAttr(node.tags)}
          data-color={colorId}
          data-node={node.id}
          style={{
            ...cardFill(c.bg, node.tags, tags),
            borderColor: c.border,
            color: inkAt(band.h),
            fontSize: bandFont,
            padding: bandPad,
            opacity: dim ? 0.22 : 1,
          }}
          {...acts}
        >
          {/* A BAND TAKES A PICTURE TOO (owner, 2026-08-27) -- see
              cardImage.ts for why the shape rule that excluded it had
              already expired. Priced off its MEASURED height, which is
              what a content-sized bar actually is (~19px here) rather
              than the 36px card its tier would be. That costs one frame
              on first paint, exactly as the tabs beside it already do.

              The title has to be an ELEMENT now: a bare text node cannot
              be lifted in paint order, so it would sit under an
              absolutely-positioned photo with nothing able to raise it. */}
          {imgAt(band.h) && <ImageFrame node={node} />}
          <span className="ov-band-text">{node.title || lvl?.name || ""}</span>
          <TagTabs ids={node.tags} tags={tags} nodeId={node.id} w={band.w} h={band.h} scale={LANE_MINI} />
          <NoteDot notes={node.notes} on={noteDots} nodeId={node.id} />
        </div>
      ) : (
        <MiniCard
          className={"ov-head-card" + state}
          visibleOnly /* same reason as the scene cards above */
          text={node.title || lvl?.name || ""}
          fontClassName={titleFont}
          geo={inkGeo}
          targetH={targetH}
          bg={c.bg}
          border={c.border}
          color={ink.color}
          tagIds={node.tags}
          tags={tags}
          tagNodeId={node.id}
          imageNode={imageNode}
          images={images}
          plain={plain}
          slotNode={node} /* alignment + populated rows only: no fields, so no slots draw */
          data-tags={tagAttr(node.tags)}
          data-color={colorId}
          {...acts}
        />
      )}
      {kids && <div className="ov-children">{kids}</div>}
    </div>
  );
});

/* A scene's beat-cell wrap, doubling as a leaf-tier drop zone so beats can be
 * dropped into the scene even when it has none yet (appends to the end).
 * Its own component so the drop hook only runs for scenes, not every proxy. */
function OverviewCells({
  sceneId,
  leafDepth,
  count,
  children,
}: {
  sceneId: string;
  leafDepth: number;
  count: number;
  children: ReactNode;
}) {
  const { boardId } = useBoardUI();
  const drop = useDropZone(leafDepth, (item) => moveDropped(item, sceneId, count, boardId));
  // no highlight -- the per-cell edge markers guide precise drops; this zone
  // just makes an empty scene droppable
  return (
    <div className="ov-cells" {...drop.props}>
      {children}
    </div>
  );
}
