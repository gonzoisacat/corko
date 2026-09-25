import { useEffect, useState } from "react";
import { TagSwatch } from "./TagSwatch";
import { ops, useTags } from "../state/useBoard";
import { FloatPanel } from "../ui/FloatPanel";
import { bulkTag, useBulkTag } from "./bulkSearch";

const PANEL_W = 260;

/* ------------------------------------------------------------------ *
 *  Apply or remove one tag across everything the search matched.
 *
 *  The reason this exists rather than "select all matches, then drag a
 *  tag on": a selection is single-tier by design (board/selection.ts --
 *  drag, range and stack all need that), and a real query doesn't respect
 *  tiers. "Ariel" on a working board is 26 beats, 15 scenes and a shoot
 *  day; a selection could hold one of those three. `ops.setNodeTag` has
 *  never cared about depth, so the match set goes straight there and the
 *  selection store is never involved.
 *
 *  One transaction either way, so it is one undo step.
 * ------------------------------------------------------------------ */
export function BulkTagPopover() {
  const open = useBulkTag();
  const tags = useTags();
  // the panel is draggable; remember where it was shoved to
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [done, setDone] = useState<{ name: string; n: number } | null>(null);

  useEffect(() => {
    if (open) {
      setPos({ x: open.x, y: open.y });
      setDone(null);
    }
  }, [open]);

  if (!open) return null;
  const ids = open.matches.map((m) => m.id);
  const applying = open.mode === "apply";

  const run = (tagId: string, name: string) => {
    ops.setNodeTag(ids, tagId, applying);
    setDone({ name, n: ids.length });
  };

  /* Minting from here is the natural move -- you searched for a character
   * precisely because you wanted to mark them -- and the new tag lands on
   * the matches in the same gesture. */
  const mintAndApply = () => {
    const id = ops.addTag({ name: open.query });
    ops.setNodeTag(ids, id, true);
    setDone({ name: open.query, n: ids.length });
  };

  return (
    <FloatPanel
      title={`${applying ? "Apply" : "Remove"} tag · ${ids.length} cards`}
      x={pos.x}
      y={pos.y}
      onMove={(x, y) => setPos({ x, y })}
      width={PANEL_W}
      onClose={() => bulkTag.close()}
      done={Boolean(done)}
    >
      {done ? (
        <p className="fr-done">
          {done.name} {applying ? "applied to" : "removed from"} {done.n} cards. One undo step.
        </p>
      ) : (
        <>
          <p className="bulk-note">
            Everything matching "{open.query}" -- across every tier it hit.
          </p>
          <div className="bulk-tags">
            {tags.map((t) => (
              <button key={t.id} className="ctx-item" onClick={() => run(t.id, t.name)}>
                <TagSwatch tag={t} />
                {t.name || "(unnamed)"}
              </button>
            ))}
            {tags.length === 0 && <p className="bulk-note">This project has no tags yet.</p>}
          </div>
          {applying && open.query && (
            <button className="ctx-item bulk-new" onClick={mintAndApply}>
              + New tag "{open.query}"
            </button>
          )}
        </>
      )}
    </FloatPanel>
  );
}
