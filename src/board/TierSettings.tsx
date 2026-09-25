import { ops } from "../state/useBoard";
import { DraftInput } from "../ui/DraftInput";
import type { Board } from "../state/types";
import { FONTS } from "../fonts";
import { textColor } from "../colors";
import { BEAT_CARD_H, LANE_CARD_H } from "./cardSizing";
import { targetFontSize } from "../state/tierDefaults";

/* ------------------------------------------------------------------ *
 *  One tier's whole look: font, font color, text size, expand-to-fill,
 *  fill color, height, card aspect, full-width band.
 *
 *  Extracted from OptionsMenu because it now has TWO doors. It has always
 *  been reachable from Options -> Board structure -> that tier's gear, and
 *  it is now also the panel behind a Default Tier Colors swatch in the
 *  legend -- which is the more natural door, since the swatch you're
 *  looking at IS that tier's fill color.
 *
 *  Shared as a component rather than duplicated so the two doors show the
 *  same controls in the same order BY CONSTRUCTION. Duplicating this block
 *  would have them drift apart the first time a knob is added, and the
 *  owner's ask was explicitly "all those same options, in order".
 *
 *  Everything here writes to `LevelDef` (or the tier's legend entry, for
 *  fill) and is SHARED board data -- a tier's look is how the board reads,
 *  so it changes for every collaborator, unlike the local view prefs in
 *  the same menu.
 *
 *  ONE control breaks the two-doors rule on purpose (owner's call,
 *  2026-08-03): the DESCRIPTOR is about what this tier's swatch means in
 *  the legend, so it only appears at the legend door. It would be noise
 *  in Options -> Board structure, which is about the ladder itself.
 * ------------------------------------------------------------------ */

export function TierSettings({
  board,
  index,
  descriptor,
}: {
  board: Board;
  index: number;
  descriptor?: boolean; // legend door only -- see above
}) {
  const l = board.levels[index];
  if (!l) return null;

  const tierColor = board.legend.find((e) => e.tier === l.id)?.bg ?? "#cccccc";
  const isLeaf = index === board.levels.length - 1;
  // defaults mirror the render sites so an unset slider shows the value
  // actually in effect
  const defHeight = isLeaf ? BEAT_CARD_H : LANE_CARD_H;
  /* The size the board ACTUALLY renders this tier at -- the same helper
   * the cards use, so the slider can never show a number the board
   * disagrees with (a retired expandText makes stored textSize inert;
   * see targetFontSize). Dragging it clears that flag. */
  const shownText = targetFontSize(l, isLeaf);
  const autoText = textColor(tierColor); // auto-contrast when no override

  return (
    <>
      {/* What this tier's COLOR means, in parentheses beside its swatch:
          "Scene (Linear)" against a "Scene (Floaters)" override. Kept off
          the tier's name because that noun is used everywhere -- counts,
          add buttons, the graduation menu -- where a color's meaning
          would be noise. Blank adds nothing. */}
      {descriptor && (
        <div className="options-row">
          <span>Descriptor</span>
          <DraftInput
            className="options-name"
            value={l.descriptor ?? ""}
            ariaLabel={`${l.name} legend descriptor`}
            placeholder="e.g. Linear"
            onCommit={(v) => ops.setLevelDescriptor(board.id, index, v)}
          />
        </div>
      )}
      {/* --- text --- */}
      <div className="options-row">
        <span>Font</span>
        <select
          className="options-select"
          value={l.defaultFont ?? "sans"}
          onChange={(e) => ops.setLevelDefaultFont(board.id, index, e.target.value)}
        >
          {FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="options-row">
        <span>Font color</span>
        <span className="gear-color-cell">
          {l.textColor && (
            <button
              className="gear-auto"
              data-tip="Back to auto contrast"
              onClick={() => ops.setLevelTextColor(board.id, index, "")}
            >
              auto
            </button>
          )}
          <label className="gear-swatch" style={{ background: l.textColor ?? autoText }}>
            <input
              type="color"
              value={l.textColor ?? autoText}
              aria-label={`${l.name} font color`}
              onChange={(e) => ops.setLevelTextColor(board.id, index, e.target.value)}
            />
          </label>
        </span>
      </div>
      {/* The ONE size control now that "Expand text to fill" is gone
          (owner, 2026-08-14). It is a TARGET, not a cap: a title is set
          at this size and still auto-shrinks to fit, which is what
          useFitText has always done underneath. Always shown -- the old
          rule hid it whenever expand was on, which is why the tier's
          real size was invisible on most boards. */}
      <div className="options-row">
        <span>Target font size</span>
        <span className="options-slider">
          <input
            type="range"
            min={8}
            max={40}
            value={shownText}
            aria-label={`${l.name} target font size`}
            onChange={(e) => ops.setLevelTextSize(board.id, index, Number(e.target.value))}
          />
          <span className="mono options-val">{shownText}px</span>
        </span>
      </div>
      {/* --- card --- */}
      <div className="options-row">
        <span>Fill color</span>
        <label className="gear-swatch" style={{ background: tierColor }}>
          <input
            type="color"
            value={tierColor}
            aria-label={`${l.name} fill color`}
            onChange={(e) => ops.setTierColor(board.id, l.id, e.target.value)}
          />
        </label>
      </div>
      {!l.fullWidth && (
        <>
          <div className="options-row">
            <span>Height</span>
            <span className="options-slider">
              <input
                type="range"
                min={40}
                max={280}
                value={l.height ?? defHeight}
                aria-label={`${l.name} height`}
                onChange={(e) => ops.setLevelHeight(board.id, index, Number(e.target.value))}
              />
              <span className="mono options-val">{l.height ?? defHeight}px</span>
            </span>
          </div>
          <div className="options-row">
            <span>Card aspect</span>
            <span className="options-slider">
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.05}
                value={l.aspect ?? 1.45}
                aria-label={`${l.name} card aspect`}
                onChange={(e) => ops.setLevelAspect(board.id, index, Number(e.target.value))}
              />
              <span className="mono options-val">{(l.aspect ?? 1.45).toFixed(2)}</span>
            </span>
          </div>
        </>
      )}
      {/* header tiers (above the scene tier) can drop the aspect card and
          render as a full-width swimlane band instead */}
      {index < board.levels.length - 2 && (
        <>
          <Toggle
            label="Full width"
            checked={l.fullWidth ?? false}
            onChange={(v) => ops.setLevelFullWidth(board.id, index, v)}
          />
          {/* the band's own height, appearing with the mode it belongs to
              -- the mirror of Height/Aspect appearing when it's off. Unset
              ("auto") is content-sized, the way bands always were; sliding
              to the far left clears back to it. */}
          {l.fullWidth && (
            <div className="options-row">
              <span>Band height</span>
              <span className="options-slider">
                <input
                  type="range"
                  min={27}
                  max={160}
                  value={l.bandHeight ?? 27}
                  aria-label={`${l.name} band height`}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    ops.setLevelBandHeight(board.id, index, v <= 27 ? 0 : v);
                  }}
                />
                <span className="mono options-val">
                  {l.bandHeight ? `${l.bandHeight}px` : "auto"}
                </span>
              </span>
            </div>
          )}
        </>
      )}
      {/* SET TO APP DEFAULT (owner, 2026-09-08, "per tier"): this tier's
          sizes back to what a new board stamps for its rung
          (state/tierDefaults.ts) -- text size, height, aspect, full
          width, band height. Its name, color, font and descriptor are
          the tier's identity and stay. One transaction, one undo. */}
      <div className="options-row">
        <span />
        <button className="gear-auto" onClick={() => ops.resetLevelGeometry(board.id, index)}>
          Set to app default
        </button>
      </div>
    </>
  );
}

/* The options-menu switch row. Lives here rather than in OptionsMenu
 * because TierSettings is its heaviest user and OptionsMenu now imports
 * this file anyway. */
export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="options-row">
      <span>{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={"switch" + (checked ? " on" : "")}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}
