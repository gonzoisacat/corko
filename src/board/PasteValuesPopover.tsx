import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { ops, useFields } from "../state/useBoard";
import { FloatPanel } from "../ui/FloatPanel";
import { pasteValues, usePasteValues } from "./cardPanels";
import { useMetaClip } from "./metaClipboard";

/* ------------------------------------------------------------------ *
 *  "Paste metadata values..." -- the bulk half of the metadata workflow.
 *
 *  Copy a card, select the cards you want to fill, and pick which of the
 *  copied values actually go across. A checklist rather than a
 *  paste-everything, because the copied card is a whole row of values and
 *  you rarely want all of it: usually one column ("give these forty beats
 *  the same shoot day") while leaving their timecodes alone.
 *
 *  Every project category is listed, not just the ones the source filled
 *  in -- because a BLANK is a value here: checking an empty row clears
 *  that category across the selection, which is the only way to wipe a
 *  column in bulk. Blanks start unchecked so a careless paste can't erase
 *  work; filled rows start checked, since those are what you copied for.
 * ------------------------------------------------------------------ */

const W = 300;

export function PasteValuesPopover() {
  const open = usePasteValues();
  const clip = useMetaClip();
  const fields = useFields();
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // re-arm the defaults each time the dialog opens on a new copy/selection
  const key = open ? `${open.ids.join(",")}:${clip?.title ?? ""}` : null;
  useEffect(() => {
    if (!clip) return;
    const next: Record<string, boolean> = {};
    for (const f of fields) next[f.id] = Boolean(clip.values[f.id]);
    setChecked(next);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && !clip) pasteValues.close();
  }, [open, clip]);

  const picked = useMemo(() => fields.filter((f) => checked[f.id]), [fields, checked]);

  if (!open || !clip) return null;

  const targets = open.ids.length;
  const apply = () => {
    const patch: Record<string, string> = {};
    for (const f of picked) patch[f.id] = clip.values[f.id] ?? "";
    ops.setNodeValues(open.ids, patch);
    pasteValues.close();
  };


  return (
    <FloatPanel
      title="Paste metadata values"
      className="paste-values-panel"
      x={open.x}
      y={open.y} /* FloatPanel clamps to the window by measuring itself */
      width={W}
      onMove={pasteValues.moveTo}
      onClose={pasteValues.close}
    >
      <div className="info-card-title" title={clip.title}>
        from {clip.title || "an untitled card"}
      </div>
      {fields.length === 0 ? (
        <div className="info-empty-row">This project has no metadata categories yet.</div>
      ) : (
        <ul className="paste-rows">
          {fields.map((f) => {
            const value = clip.values[f.id] ?? "";
            return (
              <li key={f.id} className={"paste-row" + (value ? "" : " blank")}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(checked[f.id])}
                    onChange={(e) =>
                      setChecked((c) => ({ ...c, [f.id]: e.target.checked }))
                    }
                  />
                  <span className="paste-row-name">{f.name || "unnamed"}</span>
                  <span className="paste-row-value mono">
                    {value || <em className="info-empty">clear</em>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <button className="options-structure-btn" disabled={picked.length === 0} onClick={apply}>
        <ClipboardPaste size={13} /> Paste {picked.length} value
        {picked.length === 1 ? "" : "s"} onto {targets} card{targets === 1 ? "" : "s"}
      </button>
    </FloatPanel>
  );
}
