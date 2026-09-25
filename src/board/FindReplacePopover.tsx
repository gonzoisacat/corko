import { useEffect, useMemo, useRef, useState } from "react";
import { ops } from "../state/useBoard";
import { countOccurrences, matchSpans, replaceAll } from "../state/search";
import { FloatPanel } from "../ui/FloatPanel";
import { findReplace, useFindReplace } from "./bulkSearch";

const PANEL_W = 380;
const PREVIEW_ROWS = 6; // enough to trust it, few enough to read

/* Mark EVERY occurrence, not just the first. ui/highlight's
 * renderHighlight marks one, which is fine on a card and dishonest here:
 * "Ariel + Stephen, Ariel leads" changes twice and the preview has to
 * show both or the count won't match what you see. */
function marked(text: string, q: string, matchCase: boolean, cls: string) {
  const spans = matchSpans(text, q, matchCase);
  if (!spans.length) return text;
  const out: React.ReactNode[] = [];
  let at = 0;
  spans.forEach(([from, to], i) => {
    if (from > at) out.push(text.slice(at, from));
    out.push(
      <mark key={i} className={cls}>
        {text.slice(from, to)}
      </mark>,
    );
    at = to;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/* ------------------------------------------------------------------ *
 *  Find and replace across the search's match set (2026-08-03).
 *
 *  The preview is the feature, not decoration. A bulk replace across a
 *  real cut is irreversible for everyone but the person who ran it (undo
 *  is local-origin only), so the panel's job is to make the blast radius
 *  legible BEFORE the button: how many titles change, how many
 *  occurrences that is, and what the first few actually become.
 *
 *  TWO NUMBERS on purpose. "18 of 42 titles" because Find can differ from
 *  the query that built the match set -- you searched "Ariel" and may be
 *  replacing "Ariel enters" -- and "21 occurrences" because a single
 *  title can contain the term more than once. Reporting only cards would
 *  quietly under-count the edit.
 * ------------------------------------------------------------------ */
export function FindReplacePopover() {
  const open = useFindReplace();
  const [find, setFind] = useState("");
  const [to, setTo] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  // the panel is draggable; remember where it was shoved to
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [done, setDone] = useState<number | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  /* Find pre-fills from the search that got you here -- you found it,
   * you're replacing it -- and the Aa toggle inherits the search bar's,
   * so the set you were shown is the set you start from. */
  useEffect(() => {
    if (!open) return;
    setFind(open.query);
    setTo("");
    setMatchCase(open.matchCase);
    setDone(null);
    setPos({ x: open.x, y: open.y });
    const t = setTimeout(() => firstRef.current?.select(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const plan = useMemo(() => {
    if (!open || !find) return { rows: [], titles: 0, occurrences: 0, nested: 0 };
    const rows = [];
    let titles = 0;
    let occurrences = 0;
    let nested = 0;
    for (const m of open.matches) {
      /* A NESTING CARD CANNOT BE REPLACED (state/search.ts `nested`). It
       * matched on its target board's name, which it only DISPLAYS, so
       * the op skips it -- and the preview has to skip it too, or the
       * count would promise a change that never comes. Counted so the
       * note below can say why one of the matches is standing still. */
      if (m.nested) {
        if (countOccurrences(m.title, find, matchCase)) nested++;
        continue;
      }
      const n = countOccurrences(m.title, find, matchCase);
      if (!n) continue;
      titles++;
      occurrences += n;
      if (rows.length < PREVIEW_ROWS) {
        rows.push({ ...m, after: replaceAll(m.title, find, to, matchCase) });
      }
    }
    return { rows, titles, occurrences, nested };
  }, [open, find, to, matchCase]);

  if (!open) return null;

  const run = () => {
    const n = ops.replaceInTitles(
      open.matches.map((m) => m.id),
      find,
      to,
      matchCase,
    );
    setDone(n);
  };

  return (
    <FloatPanel
      title="Find and replace"
      x={pos.x}
      y={pos.y}
      onMove={(x, y) => setPos({ x, y })}
      width={PANEL_W}
      onClose={() => findReplace.close()}
    >
      <div className="fr-fields">
        <label className="fr-row">
          <span>Find</span>
          <input ref={firstRef} value={find} onChange={(e) => setFind(e.target.value)} />
          <button
            className={"search-case" + (matchCase ? " active" : "")}
            data-tip="Match case"
            aria-pressed={matchCase}
            onClick={() => setMatchCase((v) => !v)}
          >
            Aa
          </button>
        </label>
        <label className="fr-row">
          <span>Replace</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="(empty deletes it)" />
        </label>
      </div>

      {done !== null ? (
        <p className="fr-done">
          {done} {done === 1 ? "title" : "titles"} changed. Cmd/Ctrl+Z undoes all of it in one step.
        </p>
      ) : (
        <>
          <p className="fr-count mono">
            {plan.titles === 0
              ? `Nothing in the ${open.matches.length} matches contains that`
              : `${plan.titles} of ${open.matches.length} titles change` +
                (plan.occurrences !== plan.titles ? ` · ${plan.occurrences} occurrences` : "")}
          </p>
          {plan.nested > 0 && (
            <p className="bulk-note">
              {plan.nested === 1 ? "1 match is a nested board" : `${plan.nested} matches are nested boards`}
              {" "}and cannot change here -- that name belongs to the board, so rename it from the card menu.
            </p>
          )}

          <div className="fr-preview">
            {plan.rows.map((r) => (
              <div className="fr-item" key={r.id}>
                <div className="fr-tier mono">{r.tier}</div>
                <div className="fr-before">{marked(r.title, find, matchCase, "fr-out")}</div>
                <div className="fr-after">{marked(r.after, to, matchCase, "fr-in")}</div>
              </div>
            ))}
            {plan.titles > plan.rows.length && (
              <div className="fr-more">and {plan.titles - plan.rows.length} more...</div>
            )}
          </div>

          <div className="fr-actions">
            <button className="pane-btn" onClick={() => findReplace.close()}>
              Cancel
            </button>
            <button className="pane-btn fr-go" disabled={!plan.titles} onClick={run}>
              Replace {plan.titles} {plan.titles === 1 ? "title" : "titles"}
            </button>
          </div>
        </>
      )}
    </FloatPanel>
  );
}
