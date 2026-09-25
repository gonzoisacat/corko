import { ArrowDownToLine, ArrowUpToLine, FoldVertical, RotateCcw } from "lucide-react";
import { ops, useBoard, useNode, useNodes } from "../state/useBoard";
import { sharedText, subjectLabel } from "./groupEdit";
import { FONTS } from "../fonts";
import { targetFontSize } from "../state/tierDefaults";
import { FloatPanel } from "../ui/FloatPanel";
import { NOTE_W, textPanel, useTextPanel } from "./cardPanels";

/* ------------------------------------------------------------------ *
 *  TEXT OVERRIDES -- one card's words (owner, 2026-09-01).
 *
 *  It exists because the alternative was a HIDDEN RULE. A card with a
 *  picture used to be given white type and a drop shadow by a stylesheet
 *  that nothing in the app named, showed, or could switch off. Adding a
 *  picture now WRITES those as ordinary overrides and this panel is
 *  where you see and change them -- so a card does exactly what the
 *  panel says it does, and nothing more.
 *
 *  EVERY CONTROL IS AN OVERRIDE, and each shows its resting state as the
 *  TIER's answer rather than as a blank. "Reset" clears the key, which
 *  is what returns the card to its tier -- so there is one spelling of
 *  the default and a card nobody has touched carries nothing.
 *
 *  Not a section of the Image panel, which is where the first version of
 *  this lived: these are properties of the TEXT, true whether or not the
 *  card carries a photo, and burying them under "Image" would mean
 *  having to add a picture to reach them.
 * ------------------------------------------------------------------ */

const NO_IDS: string[] = [];
/* the font menu's value for a set that disagrees -- never a real font id */
const MIXED = "__mixed";

export function TextPanelPopover() {
  const open = useTextPanel();
  const board = useBoard(open?.boardId ?? null);
  const node = useNode(open?.boardId ?? null, open?.nodeId ?? null);
  /* THE SUBJECT (board/groupEdit.ts, 2026-09-12): the selection when the
   * panel was opened from a card in one, else the one card. Each control
   * shows what the set SHARES and reads MIXED where they differ; every
   * write goes to all of them, one transaction each. */
  const subject = useNodes(open?.boardId ?? null, open?.ids ?? NO_IDS);
  if (!open || !node) return null;
  const nodes = subject.length ? subject : [node];
  const ids = nodes.map((n) => n.id);
  const many = ids.length > 1;
  const shared = sharedText(nodes);
  const level = board?.levels[open.depth];
  const isLeaf = !!board && open.depth === board.levels.length - 1;
  const tierSize = level ? targetFontSize(level, isLeaf) : 20;
  const font = shared.font.mixed ? MIXED : (shared.font.value ?? level?.defaultFont ?? "sans");
  /* Nothing set on any of them -- what the Reset row switches on, and
   * the state a card is in before anybody has been here. */
  const clean = shared.clean;

  return (
    <FloatPanel
      title={`${level?.name || "Card"} text`}
      className="text-panel"
      x={open.x}
      y={open.y}
      width={NOTE_W}
      onMove={textPanel.moveTo}
      onClose={textPanel.close}
      done
    >
      <div className="info-card-title" title={subjectLabel(ids.length, level?.name ?? "Card", node.title)}>
        {many ? subjectLabel(ids.length, level?.name ?? "Card", node.title) : node.title || <em className="info-empty">Untitled</em>}
      </div>

      <div className="text-row">
        <span className="image-sub-label">Color</span>
        {/* The swatch IS the picker, the idiom the board backdrop's
            custom color already uses. */}
        <input
          type="color"
          className={"text-swatch" + (shared.color.mixed ? " mixed" : "")}
          aria-label="Text color"
          value={shared.color.mixed ? "#ffffff" : (shared.color.value ?? "#ffffff")}
          onChange={(e) => ops.setNodeTextColor(ids, e.target.value)}
        />
        {shared.color.mixed && <span className="text-mixed mono">Mixed</span>}
        <button
          className="text-clear"
          disabled={!shared.color.mixed && shared.color.value === undefined}
          data-tip="Back to the tier's color"
          aria-label="Clear text color"
          onClick={() => ops.setNodeTextColor(ids, "")}
        >
          <RotateCcw size={12} />
        </button>
      </div>

      <div className="text-row">
        <span className="image-sub-label">Size</span>
        <input
          type="range"
          min={8}
          max={72}
          step={1}
          aria-label="Text size"
          value={shared.size.mixed ? tierSize : (shared.size.value ?? tierSize)}
          onChange={(e) => ops.setNodeTextSize(ids, Number(e.target.value))}
        />
        <span className={"mono text-val" + (shared.size.mixed ? " text-mixed" : "")}>
          {shared.size.mixed ? "Mixed" : (shared.size.value ?? tierSize)}
        </span>
        <button
          className="text-clear"
          disabled={!shared.size.mixed && shared.size.value === undefined}
          data-tip="Back to the tier's size"
          aria-label="Clear text size"
          onClick={() => ops.setNodeTextSize(ids, null)}
        >
          <RotateCcw size={12} />
        </button>
      </div>

      <div className="text-row">
        <span className="image-sub-label">Font</span>
        <select
          className="text-select"
          aria-label="Typeface"
          value={font}
          onChange={(e) => e.target.value !== MIXED && ops.setNodeFont(ids, e.target.value)}
        >
          {/* a set that disagrees shows "Mixed" as the selected entry;
              it is a reading, not a choice, and picking it does nothing */}
          {shared.font.mixed && (
            <option value={MIXED} disabled>
              Mixed
            </option>
          )}
          {FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button
          className="text-clear"
          disabled={!shared.font.mixed && shared.font.value === undefined}
          data-tip="Back to the tier's typeface"
          aria-label="Clear typeface"
          onClick={() => ops.setNodeFont(ids, "")}
        >
          <RotateCcw size={12} />
        </button>
      </div>

      <div className="text-row">
        <span className="image-sub-label">Drop shadow</span>
        {/* The switch look the driving menu introduced -- the app's one
            on/off control, so this reads as a state rather than a choice
            between two things. No explanatory tail: everybody knows what
            a drop shadow is (owner, 2026-09-01). */}
        <button
          className={"driving-switch" + (shared.shadow.value && !shared.shadow.mixed ? " on" : "") + (shared.shadow.mixed ? " mixed" : "")}
          role="switch"
          aria-checked={shared.shadow.mixed ? "mixed" : shared.shadow.value}
          aria-label="Drop shadow"
          /* a mixed set switches ON: the press is "give them all a
             shadow", and the next one takes it off all of them */
          onClick={() => ops.setNodeTextShadow(ids, shared.shadow.mixed ? true : !shared.shadow.value)}
        >
          <span className="driving-knob" />
        </button>
        {shared.shadow.mixed && <span className="text-mixed mono">Mixed</span>}
      </div>

      <div className="text-row">
        <span className="image-sub-label">Position</span>
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
              className={"image-align-btn" + (!shared.align.mixed && (shared.align.value ?? "") === val ? " active" : "")}
              aria-label={label}
              data-tip={label}
              onClick={() => ops.setNodeTitleAlign(ids, val)}
            >
              <Glyph size={14} />
            </button>
          ))}
        </span>
      </div>

      {/* Shown ALWAYS and disabled when there is nothing to clear -- a
          control that vanishes reads as a lost feature, and this is the
          one place a card's whole override set can be handed back to its
          tier in one press. */}
      <button
        className="options-structure-btn text-reset-all"
        disabled={clean}
        data-tip={clean ? (many ? "These cards already follow their tier" : "This card already follows its tier") : undefined}
        /* one op, one transaction, one undo -- it was five of each */
        onClick={() => ops.resetNodeText(ids)}
      >
        <RotateCcw size={13} /> Clear overrides
      </button>
    </FloatPanel>
  );
}
