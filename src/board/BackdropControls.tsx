import type { BoardBg } from "../state/settings";
import { Toggle } from "./TierSettings";

/* ------------------------------------------------------------------ *
 *  THE BACKDROP'S ROWS, once, for both places that edit one.
 *
 *  A backdrop is a kind (lite grid, dark grid, cork, your own color)
 *  and grain when it is a flat color -- the cork's own roughness map
 *  over the paint, which is how a colored cork is had (owner, 2026-09-06:
 *  he kept this and cut the dye over the photo that had joined it the
 *  day before, as the redundant one of the two). The Options
 *  menu edits the BOARD's (ops.setBoardLook, shared -- everyone sees
 *  it), the Overrides menu edits YOURS (settings, this browser). Same
 *  rows, same labels, so the override reads as "the same
 *  question, answered for me" and not as a second feature. Which store
 *  a change lands in is the caller's: this component only draws.
 * ------------------------------------------------------------------ */

export interface BackdropValue {
  bg: BoardBg;
  custom: string;
  grain: boolean;
}

export function BackdropControls({
  value,
  disabled = false,
  onBg,
  onCustom,
  onGrain,
}: {
  value: BackdropValue;
  /* shown but inert (the Overrides menu with its switch off): a row
   * that vanishes reads as a bug, a row that waits reads as a promise */
  disabled?: boolean;
  onBg: (bg: BoardBg) => void;
  onCustom: (hex: string) => void;
  onGrain: (on: boolean) => void;
}) {
  return (
    <>
      <div className="options-row backdrop-row">
        <span>Backdrop</span>
        <span className="bg-choices">
          {(
            [
              { bg: "default", label: "Lite grid" },
              { bg: "slate", label: "Dark grid" },
              { bg: "cork", label: "Cork" },
            ] as const
          ).map(({ bg, label }) => (
            <button
              key={bg}
              className={"bg-choice bg-" + bg + (value.bg === bg ? " active" : "")}
              data-tip={label}
              aria-label={`${label} backdrop`}
              aria-pressed={value.bg === bg}
              disabled={disabled}
              onClick={() => onBg(bg)}
            />
          ))}
          {/* pick-your-own flat color: the swatch IS the picker */}
          <label
            className={"bg-choice bg-custom" + (value.bg === "custom" ? " active" : "")}
            data-tip="Your own color"
            style={{ background: value.custom }}
          >
            <input
              type="color"
              value={value.custom}
              aria-label="Your own backdrop color"
              disabled={disabled}
              onClick={() => onBg("custom")}
              onChange={(e) => onCustom(e.target.value)}
            />
          </label>
        </span>
      </div>
      {/* Grain belongs to the CUSTOM color and nothing else (owner's
          call): the two grids have their own texture and the cork photo
          is already cork, so the toggle only ever muddied them. Hidden
          AND inert off the custom swatch -- App gates the `data-grain`
          attribute on the same condition, so a setting you can't see
          can't still be doing something. The value itself survives, so
          going back to custom brings your grain back. */}
      {value.bg === "custom" && (
        <Toggle label="Cork grain" checked={value.grain} onChange={onGrain} disabled={disabled} />
      )}
    </>
  );
}
