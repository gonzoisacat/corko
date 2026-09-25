import { setSetting, useSettings, sameSit } from "../state/settings";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  FoldHorizontal,
  FoldVertical,
  Image as ImageIcon,
  ImageOff,
} from "lucide-react";
import { CardImagesToggle } from "./CardImagesToggle";
import { ops, useBoard, useLegend, useNode } from "../state/useBoard";
import { resolveNodeColor, textColor } from "../colors";
import { isNested } from "../state/nesting";
import { spanOf } from "../state/gridBoard";
import { FloatPanel } from "../ui/FloatPanel";
import { confirmDialog } from "../ui/confirmDialog";
import { NOTE_W, imagePanel, useImagePanel } from "./cardPanels";
import { DEFAULT_IMAGE_ROOM, MAX_IMAGE_GAP, MAX_IMAGE_ROOM, MIN_IMAGE_ROOM } from "../state/types";
import { alignOf, hasPicture, pickCardImage, sitForTier, sitNewPicture, sitOf, tierCardIds } from "./cardImage";
import { ImageFrame } from "./ImageFrame";
import { useStillUrl } from "./stills";

/* The image's own aspect, measured off the pixels -- the tile path in
 * ImageFrame measures the same way, and for the same reason: nothing in
 * the doc records it, and only the ratio of image to box says which
 * axis a `cover` crop actually cuts. Null until it loads, and null is
 * read as "don't judge". */
function useImageAspect(src: string | null | undefined): number | null {
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    setAspect(null);
    if (!src) return;
    let dead = false;
    const img = new Image();
    img.onload = () => {
      if (!dead && img.naturalHeight > 0) setAspect(img.naturalWidth / img.naturalHeight);
    };
    img.src = src;
    return () => {
      dead = true;
    };
  }, [src]);
  return aspect;
}

/* ------------------------------------------------------------------ *
 *  THE IMAGE ON THIS CARD -- the third door, beside Note and More
 *  metadata (owner, 2026-08-26).
 *
 *  A PANEL rather than a hover submenu, because its neighbours are
 *  panels and because the work is panel-shaped: the fit modes are a
 *  choice you want to SEE the result of, which a flyout list of words
 *  cannot show.
 *
 *  ONE ENTRY, ALWAYS THE PANEL (his call). "Image..." opens this whether
 *  or not the card has one, and an empty card gets a big Add button
 *  rather than the menu deciding for you. It costs one extra click to
 *  add a first image and buys one rule instead of two.
 * ------------------------------------------------------------------ */

export function ImagePanelPopover() {
  const open = useImagePanel();
  // hooks run unconditionally, above the early return
  const node = useNode(open?.boardId ?? null, open?.nodeId ?? null);
  const board = useBoard(open?.boardId ?? null);
  const legend = useLegend(open?.boardId ?? "");
  const stillUrl = useStillUrl(node?.image ? undefined : node?.still);
  const imgAspect = useImageAspect(node?.image ?? stillUrl);

  // the card can be deleted from under an open panel (or by a collaborator)
  useEffect(() => {
    if (open && !node) imagePanel.close();
  }, [open, node]);

  // hooks run unconditionally, above the early return
  const { imageSits } = useSettings(""); // one remembered sit per tier
  const { cardImages: boardImages } = useSettings(open?.boardId ?? "");

  if (!open || !node) return null;
  const level = board?.levels[open.depth];
  /* WHICH AXIS THE CROP IS ACTUALLY CUTTING, judged against the REAL
   * card's box -- a grid card's own span, or the tier's aspect. `cover`
   * crops along exactly one axis, so the other row's anchor does
   * nothing until the geometry changes; that row DIMS rather than
   * disabling (owner, 2026-08-29): the choice is still a stored
   * preference that takes effect when the card is resized or the image
   * replaced, and the panel's 16:10 preview can disagree with the real
   * card about which axis is live, so a hard disable could refuse a
   * click the preview visibly honours. Null = unknowable (a full-width
   * band, an unmeasured image, a tier with no aspect set) = no dim. */
  const boxAspect =
    board?.type === "grid"
      ? (() => {
          const s = spanOf(node);
          return s.h > 0 ? s.w / s.h : null;
        })()
      : level && !level.fullWidth && level.aspect
        ? level.aspect
        : null;
  const liveAxis: "h" | "v" | "none" | null =
    imgAspect == null || boxAspect == null
      ? null
      : Math.abs(imgAspect - boxAspect) < 0.005
        ? "none"
        : imgAspect > boxAspect
          ? "h"
          : "v";
  /* EITHER SOURCE COUNTS. This asked `node.image` alone and so reported
   * "No image on this card" over a card visibly wearing a grabbed still
   * -- the same drift `hasPicture` was written to close, one layer up
   * from the renderers. Owner-reported 2026-08-28. */
  const has = hasPicture(node);
  const pinned = !!node.image;
  const fit = node.imageFit === "fit";
  const side = node.imageFit === "side";
  /* SCENE CARDS ONLY, for now (his scope, 2026-09-09: "lets have this be
   * an option only for scene cards... the other tiers just show fit and
   * fill for now. we're worried about tier 2 here primarily"). The scene
   * tier is the leaf's parent on a Beat Map; a Columns board's leaf-1 is
   * a column HEAD rather than a card, and the Free Grid's cards already
   * carry their own width, so neither is offered it. */
  const canSide = !board?.type && board !== null && open.depth === (board?.levels.length ?? 0) - 2;
  const roomEdge = level?.imageEdge ?? "left";
  /* THE PREVIEW WEARS THE CARD'S OWN COLOR (his ask, 2026-09-09: "i want
   * the card preview to at least have the color of the card its
   * representing applied"), resolved exactly as the card resolves it so
   * the glyph is that card rather than a generic one. */
  const previewFill = level ? resolveNodeColor(legend, node.color, level.id, isNested(node)) : null;
  const tile = fit && !!node.imageTile;
  /* ALIGNS tokens are "<horizontal> <vertical>" (object-position order),
   * so the two axis rows below read and write halves of one value. */
  const [alignH, alignV] = alignOf(node).split(" ");
  /* THE TIER'S OWN remembered sit (settings.imageSits), and whether this
   * card already matches it. Read through the map so the panel and
   * `sitNewPicture` cannot disagree about which tier is which. */
  const tierKey = level?.id || `d${open.depth}`;
  const isDefault = sameSit(sitOf(node), imageSits[tierKey] ?? sitForTier(tierKey));
  /* EVERY card at this tier, which is what the apply reaches and what
   * its count says. One transaction, so one Cmd+Z takes all of it back. */
  const tierMates = board ? tierCardIds(board.roots, open.depth) : [];

  const had = hasPicture(node);
  const pick = async () => {
    const r = await pickCardImage();
    if (!r) return; // cancelled
    if (!r.ok) {
      await confirmDialog.tell("That image could not be used", r.reason);
      return;
    }
    ops.setNodeImage(node.id, r.dataUri);
    // a replacement keeps the card's own sit; a first picture takes the default
    if (!had) sitNewPicture(node.id);
  };

  return (
    <FloatPanel
      title={`${level?.name || "Card"} image`}
      className="image-panel"
      x={open.x}
      y={open.y}
      width={NOTE_W}
      onMove={imagePanel.moveTo}
      onClose={imagePanel.close}
      done
    >
      {/* THE BOARD'S IMAGES SWITCH, HERE TOO (owner, 2026-09-08): a line
          saying what the board is showing, and the same switch the
          legend's corner has -- one setting, so they move together. */}
      <div className="options-row image-board-row">
        <span className="image-default-note">
          {boardImages === "on"
            ? "Images are shown on this board"
            : boardImages === "only"
              ? "Images ONLY on image cards"
              : "Images are hidden on this board"}
        </span>
        <CardImagesToggle boardId={open.boardId} />
      </div>
      <div className="info-card-title" title={node.title}>
        {node.title || <em className="info-empty">Untitled</em>}
      </div>

      {/* THE PREVIEW IS THE REAL THING, at the card's own aspect: the fit
          modes differ only in how the image sits in a box, so a preview
          that used a different box would be showing you a different
          question. `ImageFrame` is the same component the card draws
          with, so what you see here IS what lands. */}
      {has ? (
        <div className="image-preview">
          <ImageFrame node={node} preview />
        </div>
      ) : (
        <div className="image-preview image-preview-empty">No image on this card</div>
      )}

      <div className="image-actions">
        <button className="pane-btn" onClick={pick}>
          <ImageIcon size={13} /> {has ? "Replace image..." : "Add image..."}
        </button>
        {/* REMOVE IS NOT GATED on `canShowImage`, the same reasoning the
            card menu carries: a board edited before that rule existed can
            hold an image on a band, and the way to get rid of one has to
            outlive the way to add one. */}
        {has && (
          <button
            className="pane-btn"
            onClick={() => {
              /* Clear whichever is actually showing. A hand-pinned image
                 WINS in the renderer, so removing it on a card that also
                 has a grabbed still reveals the still again rather than
                 emptying the card -- which is the honest reading of
                 "remove this picture". A second press then clears the
                 still too. */
              if (pinned) ops.setNodeImage(node.id, "");
              else ops.setNodeStill(node.id, "");
            }}
          >
            <ImageOff size={13} /> Remove
          </button>
        )}
      </div>

      {has && (
        <>
          {/* THE TEXT CONTROLS MOVED OUT (owner, 2026-09-01). Color,
              size, typeface, shadow and position are properties of the
              WORDS, true whether or not a card carries a photo -- so
              they are their own door ("Text overrides...") rather than
              a section you can only reach by adding a picture. */}
          <div className="image-fit-row">
            <button
              className={"image-fit" + (!fit && !side ? " active" : "")}
              onClick={() => ops.setNodeImageFit(node.id, "fill")}
            >
              <span className="image-fit-demo image-fit-demo-fill" />
              Fill
            </button>
            <button
              className={"image-fit" + (fit ? " active" : "")}
              onClick={() => ops.setNodeImageFit(node.id, "fit")}
            >
              <span className="image-fit-demo image-fit-demo-fit" />
              Fit
            </button>
            {/* SIDE BY SIDE (owner, 2026-09-09), which replaced Corner:
                the picture beside the words instead of under them. The
                MODE is this card's; the ROOM it sits in belongs to the
                tier, so every card there is one box and a row stays
                true -- which is why picking this seeds the tier's room
                if it has none. */}
            {canSide && (
              <button
                className={"image-fit" + (side ? " active" : "")}
                onClick={() => {
                  ops.setNodeImageFit(node.id, "side");
                  if (!level?.imageEdge) ops.setLevelImageStrip(open.boardId, open.depth, { edge: "left" });
                }}
              >
                <span className="image-fit-demo image-fit-demo-side" data-edge={roomEdge} />
                Side by side
              </button>
            )}
          </div>

          {/* EACH MODE CARRIES ITS OWN SUB-OPTIONS, shown only when that
              mode is chosen (owner, 2026-08-27). This is the one place
              the app's "show it disabled, with the reason" rule is set
              aside deliberately: these are not controls you might want
              and cannot have, they are a different question the other
              mode does not ask.

              THE TRAY IS ONE CONSTANT-HEIGHT, CENTERED BOX for both modes
              (owner-reported "lopsided", 2026-08-29). It used to hang a
              70px anchor grid off the LEFT edge under the centered mode
              pair -- 170px of dead space beside it -- and swap to a
              25px checkbox on the other mode, so the panel bounced and
              neither state lined up with the pair above. The picker
              modal's own rule applies: both branches carry the same
              height, so switching "should not shift". */}
          <div className="image-sub">
            {side ? (
              /* WHICH SIDE, drawn as the thing itself: the card in the
                 middle with a slot on each of its four edges, and the
                 chosen slot holding the picture. A direction picker
                 rather than four words, since the answer IS a direction
                 (owner's shape, 2026-09-09). */
              <div className="image-side-tray">
                <div className="image-side-pick" role="group" aria-label="Which side">
                  <span
                    className="image-side-card"
                    style={
                      previewFill
                        ? ({
                            background: previewFill.bg,
                            borderColor: previewFill.border,
                            "--rule": textColor(previewFill.bg),
                          } as CSSProperties)
                        : undefined
                    }
                    aria-hidden
                  />
                  {(
                    [
                      ["left", "Left"],
                      ["right", "Right"],
                    ] as const
                  ).map(([edge, label]) => (
                    <button
                      key={edge}
                      className={"image-side-slot" + (roomEdge === edge ? " active" : "")}
                      data-edge={edge}
                      aria-label={label}
                      data-tip={label}
                      onClick={() => ops.setLevelImageStrip(open.boardId, open.depth, { edge })}
                    >
                      <span className="image-side-demo" />
                    </button>
                  ))}
                </div>
                {/* THE SIDE IN WORDS, so the choice is legible without
                    reading two small rectangles against each other (his
                    ask: "some kind of persistent indicator on the
                    control that we've chosen L vs R"). */}
                <span className="image-side-which">{roomEdge === "left" ? "Left" : "Right"}</span>
                <label className="image-side-size">
                  <span className="image-side-lbl">Size</span>
                  <input
                    type="range"
                    min={MIN_IMAGE_ROOM}
                    max={MAX_IMAGE_ROOM}
                    step={0.05}
                    value={level?.imageRoom ?? DEFAULT_IMAGE_ROOM}
                    aria-label="Picture size"
                    onChange={(e) =>
                      ops.setLevelImageStrip(open.boardId, open.depth, { size: Number(e.target.value) })
                    }
                  />
                  <span className="mono image-side-val">
                    {(level?.imageRoom ?? DEFAULT_IMAGE_ROOM).toFixed(2)}x
                  </span>
                </label>
                {/* The room is the TIER's, so say so rather than let it
                    surprise: setting it here widens every card at this
                    tier, which is what keeps a row's cards one size. */}
                <label className="image-side-size">
                  <span className="image-side-lbl">Gap</span>
                  <input
                    type="range"
                    min={0}
                    max={MAX_IMAGE_GAP}
                    step={1}
                    value={level?.imageGap ?? 0}
                    aria-label="Gap between the picture and the card"
                    onChange={(e) =>
                      ops.setLevelImageStrip(open.boardId, open.depth, { gap: Number(e.target.value) })
                    }
                  />
                  <span className="mono image-side-val">{level?.imageGap ?? 0}px</span>
                </label>
                {/* Centered only shows on a picture narrower than its
                    strip, which at a proportional strip means anything
                    squarer than the card. */}
                <label className="image-side-center">
                  <input
                    type="checkbox"
                    checked={!!level?.imageCenter}
                    onChange={(e) =>
                      ops.setLevelImageStrip(open.boardId, open.depth, { center: e.target.checked })
                    }
                  />
                  Center in the space
                </label>
                {/* The strip is held for every card at this tier, with or
                    without a picture, which is what keeps them in one
                    column -- so say it rather than let it surprise. */}
                <span className="image-side-note">
                  Every {level?.name.toLowerCase() ?? "card"} keeps this space
                </span>
              </div>
            ) : fit ? (
              /* WHAT FILLS THE BARS -- one choice with three answers,
                 drawn in the mode pair's own language (a mini-picture
                 each) rather than as a checkbox with a nested checkbox:
                 plain bars, tiled copies (hard seams), or mirrored
                 copies (the seamless back-and-forth). */
              <div className="image-tile-row" role="group" aria-label="Bars">
                {(
                  [
                    ["bars", "Bars", !tile],
                    ["tiled", "Tiled", tile && !node.imageMirror],
                    ["mirrored", "Mirrored", tile && !!node.imageMirror],
                  ] as const
                ).map(([id, label, active]) => (
                  <button
                    key={id}
                    className={"image-tile-opt" + (active ? " active" : "")}
                    onClick={() => {
                      ops.setNodeImageTile(node.id, id !== "bars");
                      ops.setNodeImageMirror(node.id, id === "mirrored");
                    }}
                  >
                    <span className={`image-fit-demo image-tile-demo-${id}`} />
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              /* WHICH PART OF THE CROP SURVIVES -- two axis rows, not a
                 3x3 (owner, 2026-08-29: "the 9 grid is kind of counter
                 intuitive really, since nothing changes vertically or
                 horizontally depending on the aspect"). He is right
                 about the mechanics: `cover` crops along exactly ONE
                 axis for any given image-in-box, so whole rows of the
                 old grid were equivalent -- nine buttons where three
                 mattered. One choice per axis is the honest shape, in
                 the traditional alignment glyphs.

                 The glyphs are ARROWS-TO-LINES, the word-processor
                 family (owner's second pass: the object-alignment
                 glyphs "are typically used for aligning two or more
                 similar objects"). The row whose axis the crop is not
                 currently cutting DIMS -- by color, never opacity or
                 disabled: the buttons carry data-tip (the opacity trap)
                 and stay clickable (the choice is a stored preference
                 -- see liveAxis above). */
              <div className="image-align" role="group" aria-label="Crop anchor">
                {(
                  [
                    ["left", "Left", ArrowLeftToLine],
                    ["center", "Center", FoldHorizontal],
                    ["right", "Right", ArrowRightToLine],
                  ] as const
                ).map(([val, label, Glyph]) => (
                  <button
                    key={val}
                    className={
                      "image-align-btn" +
                      (alignH === val ? " active" : "") +
                      (liveAxis === "v" || liveAxis === "none" ? " inert" : "")
                    }
                    aria-label={label}
                    data-tip={label}
                    onClick={() => ops.setNodeImageAlign(node.id, `${val} ${alignV}`)}
                  >
                    <Glyph size={14} />
                  </button>
                ))}
                <span className="image-align-break" />
                {(
                  [
                    ["top", "Top", ArrowUpToLine],
                    ["center", "Middle", FoldVertical],
                    ["bottom", "Bottom", ArrowDownToLine],
                  ] as const
                ).map(([val, label, Glyph]) => (
                  <button
                    key={"v" + val}
                    className={
                      "image-align-btn" +
                      (alignV === val ? " active" : "") +
                      (liveAxis === "h" || liveAxis === "none" ? " inert" : "")
                    }
                    aria-label={label}
                    data-tip={label}
                    onClick={() => ops.setNodeImageAlign(node.id, `${alignH} ${val}`)}
                  >
                    <Glyph size={14} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* TEXT POSITION, here too (owner, 2026-09-08: "maybe just also add
          it to image so that it change in either menu?"): the same three
          buttons the Text overrides panel has, writing the same value,
          because over a picture is where the position matters most. */}
      {has && (
        <div className="text-row">
          <span className="image-sub-label">Text position</span>
          <span className="image-title-align" role="group" aria-label="Text position">
            {(
              [
                ["top", "Top", ArrowUpToLine],
                ["", "Centered", FoldVertical],
                ["bottom", "Bottom", ArrowDownToLine],
              ] as const
            ).map(([val, label, Glyph]) => (
              <button
                key={"t" + (val || "mid")}
                className={"image-align-btn" + ((node.titleAlign ?? "") === val ? " active" : "")}
                aria-label={label}
                data-tip={label}
                onClick={() => ops.setNodeTitleAlign([node.id], val)}
              >
                <Glyph size={14} />
              </button>
            ))}
          </span>
        </div>
      )}

      {/* SET AS DEFAULT (owner, 2026-09-08): remember this card's sit --
          fill or fit and the sub-settings -- for every picture added from
          here on. Grayed (by color, never opacity) while the card already
          matches the remembered default. */}
      {has && (
        <div className="options-row">
          <span className="image-default-note">Make default for new images in this tier</span>
          <button
            className="gear-auto"
            disabled={isDefault}
            onClick={() => setSetting("", "imageSits", { ...imageSits, [tierKey]: sitOf(node) })}
          >
            Set tier default
          </button>
        </div>
      )}

      {/* APPLY TO THE REST OF THE TIER (owner, 2026-09-09). The card's
          whole image look -- its mode, its sub-settings and its text
          position -- onto every OTHER card at this tier that carries a
          picture. Named with the count and the tier, so the reach is
          legible before the press rather than after it; it lands as one
          transaction, so Cmd+Z takes it all back. */}
      {has && tierMates.length > 0 && (
        <div className="options-row">
          <span className="image-default-note">Apply image settings to every card in this tier</span>
          <button className="gear-auto image-apply-tier" onClick={() => ops.setNodeImageSit(tierMates, sitOf(node))}>
            Apply
            <span className="image-apply-count">
              {tierMates.length} total {level?.name.toLowerCase() ?? "card"}
              {tierMates.length === 1 ? "" : "s"}
            </span>
          </button>
        </div>
      )}

      {/* THE BAND WARNING IS GONE (owner, 2026-08-27: images "including on
          bands"). It said an image here would not show on the board, and
          as of this change that is simply untrue -- a note that lies is
          worse than no note. See cardImage.ts for why the shape rule
          behind it had already expired. */}
    </FloatPanel>
  );
}
