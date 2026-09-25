import { useEffect } from "react";
import { Trash2 } from "lucide-react";
import { ops, useBoard, useProject } from "../state/useBoard";
import { DraftInput } from "../ui/DraftInput";
import { FloatPanel } from "../ui/FloatPanel";
import { legendPanel, useLegendPanel } from "./legendPanel";
import { TierSettings } from "./TierSettings";
import { confirmDialog } from "../ui/confirmDialog";
import { countColorUses } from "./boardVocab";
import { newColors } from "./newColors";

/* ------------------------------------------------------------------ *
 *  The panel behind a legend color swatch's gear -- floating and
 *  DRAGGABLE, for the reason the tag panel is: anchored under its chip it
 *  would sit straight over the board you're watching while you drag a
 *  slider to see what it does.
 *
 *  Two kinds (see legendPanel.ts): a tier default opens that tier's whole
 *  look, a free override opens its own name and color.
 *
 *  (Named ...Popover like TagPanelPopover so the file doesn't collide with
 *  legendPanel.ts on a case-insensitive filesystem.)
 * ------------------------------------------------------------------ */

const W = 250;

export function LegendPanelPopover() {
  const open = useLegendPanel();
  // hooks run unconditionally, above the early return
  const board = useBoard(open?.boardId ?? "");
  const project = useProject(); // Remove counts across every board (ADR 0006)

  const index = open?.kind === "tier" ? board?.levels.findIndex((l) => l.id === open.levelId) ?? -1 : -1;
  const entry =
    open?.kind === "entry" ? board?.legend.find((e) => e.id === open.entryId) ?? null : null;
  const gone = !board || (open?.kind === "tier" ? index < 0 : !entry);

  // the tier or entry can go from under an open panel -- a collaborator
  // removing a color, a board switching in the pane, a board deleted
  useEffect(() => {
    if (open && gone) legendPanel.close();
  }, [open, gone]);

  if (!open || !board || gone) return null;

  if (open.kind === "tier") {
    const level = board.levels[index];
    return (
      <FloatPanel
        title={`${level.name || "Tier"} defaults`}
        x={open.x}
        y={open.y}
        width={W}
        onMove={legendPanel.moveTo}
        onClose={legendPanel.close}
      >
        {/* The tier's NAME, not the legend entry's label: a tier default
            entry is labelled by its tier, and ops.setLevelName renames both
            together. Writing setLegendLabel here would desync them, so the
            swatch would stop saying what the tier is called. */}
        <div className="options-row">
          <span>Name</span>
          <DraftInput
            className="options-name"
            value={level.name}
            ariaLabel="Tier name"
            onCommit={(v) => ops.setLevelName(board.id, index, v)}
          />
        </div>
        {/* `descriptor` is this door's alone: what the SWATCH means, which
            is a legend question, not a ladder one. */}
        <TierSettings board={board} index={index} descriptor />
      </FloatPanel>
    );
  }

  return (
    <FloatPanel
      title={entry!.label || "Untitled color"}
      x={open.x}
      y={open.y}
      width={W}
      onMove={legendPanel.moveTo}
      onClose={legendPanel.close}
    >
      <div className="options-row">
        <span>Meaning</span>
        <DraftInput
          className="options-name"
          value={entry!.label}
          ariaLabel="Color meaning"
          onCommit={(v) => ops.setLegendLabel(board.id, entry!.id, v)}
        />
      </div>
      <div className="options-row">
        <span>Color</span>
        <label className="gear-swatch" style={{ background: entry!.bg }}>
          <input
            type="color"
            value={entry!.bg}
            aria-label="Color"
            onChange={(e) => ops.setLegendColor(board.id, entry!.id, e.target.value)}
          />
        </label>
      </div>
      {/* Removing lives in here rather than as an X on the chip: the chip
          already carries a gear, and a delete sitting one pixel from the
          thing you click to LATCH a highlight is the wrong place for it.

          IT ONLY ASKS WHEN THERE IS SOMETHING TO LOSE (owner,
          2026-08-24). The confirm was there because the removal is
          board-wide and SILENT -- you cannot see from the legend which
          cards it repaints. Count them and that stops being true in the
          case that matters: nothing wears this color, so nothing
          changes, and a dialog for a no-op is a tax on tidying up an
          unused swatch. When cards DO wear it the dialog says how many,
          which is the thing the old one could not tell you. */}
      {/* A non-tier DEFAULT (today just the nesting-card fill) has no
          remove: it is not a color someone added, it is the color a
          card gets when nobody chose one, and taking it away would only
          mean the next `ensureTierDefaults` puts it straight back. Rename
          and recolor it instead -- which is the whole reason it is a
          legend entry rather than a constant. */}
      {!entry!.role && (
      <button
        className="options-structure-btn danger"
        onClick={async () => {
          /* PROJECT-WIDE (ADR 0006): an override is the project's, so
             removing it undresses cards on every board. Counted across
             all of them, and the dialog says on how many. */
          const perBoard = project.boards
            .map((b) => ({ title: b.title, n: countColorUses(b, entry!.id) }))
            .filter((x) => x.n > 0);
          const used = perBoard.reduce((n, x) => n + x.n, 0);
          if (used > 0) {
            const where =
              perBoard.length === 1
                ? perBoard[0].title === board.title
                  ? ""
                  : ` on "${perBoard[0].title}"`
                : ` across ${perBoard.length} boards`;
            const ok = await confirmDialog.ask({
              title: `Remove the color "${entry!.label || "Untitled"}" from the project?`,
              body:
                `${used} ${used === 1 ? "card wears" : "cards wear"} it${where}, and will fall back ` +
                `to their tier's default color.`,
              confirmLabel: "Remove",
            });
            if (!ok) return;
          }
          newColors.forget(entry!.id);
          ops.removeLegendEntry(board.id, entry!.id);
          legendPanel.close();
        }}
      >
        <Trash2 size={13} /> Remove this color
      </button>
      )}
    </FloatPanel>
  );
}
