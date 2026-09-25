import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ClipboardPaste, Copy, Calculator, Eraser, Target } from "lucide-react";
import { FloatPanel } from "../ui/FloatPanel";
import { setSetting, useSettings } from "../state/settings";
import { getSnapshot } from "../state/ydoc";
import { useFields } from "../state/useBoard";
import { usePlayerPrefs } from "../state/playerPrefs";
import { TIMECODE_FIELD } from "../state/player";
import { DEFAULT_RATE, RATES, type Rate } from "../state/timecode";
import {
  clearCalc,
  clockToFrames,
  derivedOf,
  EMPTY_CALC,
  parseAny,
  parseClock,
  setField,
  showClock,
  showDuration,
  showPosition,
  type TcCalc,
  type TcField,
} from "../state/tcCalc";

/* ------------------------------------------------------------------ *
 *  THE TIMECODE CALCULATOR (owner, 2026-09-10), behind the TC button in
 *  the topbar.
 *
 *  It exists because the automated version did not survive being thought
 *  about. A derived "TRT per scene" needs a rate everyone agrees on, a
 *  rule for the last card at a tier, and a story for what happens when
 *  cards are reordered -- he called it "very tricky and very conditional"
 *  and reached for the tool instead: "the manual part isn't that hard".
 *  A calculator is the same arithmetic with a person deciding what to
 *  subtract from what, which is the part that was conditional.
 *
 *  ALL THE MATHS IS state/tcCalc.ts and state/timecode.ts, both pure and
 *  both pinned. This file is the fields and nothing else, deliberately:
 *  drop-frame labelling and the 1000/1001 rate trap are exactly the sort
 *  of thing that should never be re-derived inside a component.
 *
 *  THE ANSWER IS WHICHEVER FIELD YOU HAVE NOT TOUCHED, and it is marked
 *  rather than disabled. Disabling it would mean you could not type into
 *  it to ask the question the other way round, which is the whole point
 *  of a three-field form.
 * ------------------------------------------------------------------ */

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const tcCalc = {
  toggle() {
    open = !open;
    emit();
  },
  close() {
    if (!open) return;
    open = false;
    emit();
  },
  isOpen: () => open,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useTcCalcOpen(): boolean {
  return useSyncExternalStore(tcCalc.subscribe, tcCalc.isOpen, () => false);
}

/* The button, for the topbar's tool cluster. */
export function TcCalcButton() {
  const on = useTcCalcOpen();
  return (
    <button
      className={"pane-btn icon-only" + (on ? " active" : "")}
      aria-label="Timecode calculator"
      data-tip="Timecode calculator"
      onClick={() => tcCalc.toggle()}
    >
      <Calculator size={14} />
    </button>
  );
}

/* ---- the clipboard, both ways (owner, 2026-09-10) ----------------- *
 *  Timecodes travel between this app and an NLE by being copied, so the
 *  two buttons are the bridge. Both are best-effort: a browser may refuse
 *  clipboard access outright, and a refusal must cost the click and not
 *  the panel.
 *
 *  PASTE ONLY TAKES A TIMECODE, which was his ask. Whatever is on the
 *  clipboard is run through the same parser the field uses, and anything
 *  that is not a timecode is declined rather than typed in -- so a stray
 *  copy of someone's name cannot wipe a field you were working in.
 * ------------------------------------------------------------------ */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function readClipboard(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null; // no permission, or no clipboard at all
  }
}

/* THE CARD THE "take this" buttons read: exactly one selected, and its
 * Timecode value, looked up across boards because the selection does not
 * say which board it is on. Returns frames, or null when there is
 * nothing to take -- which is what greys those buttons out. */
function selectedTimecode(selected: string[], fieldId: string | null, rate: Rate): number | null {
  if (selected.length !== 1 || !fieldId) return null;
  const id = selected[0];
  for (const b of getSnapshot().boards) {
    let hit: string | undefined;
    const walk = (ns: { id: string; values?: Record<string, string>; children: unknown[] }[]) => {
      for (const n of ns) {
        if (n.id === id) hit = n.values?.[fieldId];
        else if (n.children.length) walk(n.children as typeof ns);
      }
    };
    walk(b.roots as unknown as Parameters<typeof walk>[0]);
    if (hit !== undefined) return parseAny(hit, rate);
  }
  return null;
}

export function TcCalcPopover({ boardId, selected }: { boardId: string; selected: string[] }) {
  const isOpen = useTcCalcOpen();
  const { tcPinned, tcRate } = useSettings();
  const { tcRate: boardRate } = useSettings(boardId);
  const player = usePlayerPrefs(boardId);
  const fields = useFields();
  const [calc, setCalc] = useState<TcCalc>(EMPTY_CALC);
  /* What is being typed, per field, so a half-written timecode is not
   * reformatted under the cursor. Null means "show the model's value". */
  const [draft, setDraft] = useState<Partial<Record<string, string>>>({});
  /* STATE, not a ref (owner-reported 2026-09-10: it "doesn't want to get
   * dragged around"). FloatPanel renders at the x/y PROPS once a drag has
   * started -- `freed` -- and calls `onMove` for every mousemove, so the
   * position has to come back through a render or the panel sits still
   * while the pointer walks away from it. A ref took the value and told
   * nobody. The metadata panel is not a ref either: its x/y live in a
   * store that emits.
   *
   * It lives here rather than in the open/close store on purpose: the
   * component stays mounted and returns null while closed, so where you
   * left the calculator is where it opens next time. */
  const [pos, setPos] = useState({ x: 120, y: 120 });

  /* The board's own rate, else the player's for this board, else the
   * documentary default -- see settings.ts on why this is not global. */
  const rate: Rate = useMemo(() => {
    const pick = boardRate || tcRate;
    return (
      RATES.find((r) => r.label === pick) ??
      RATES.find((r) => r.label === player.rateLabel) ??
      DEFAULT_RATE
    );
  }, [boardRate, tcRate, player.rateLabel]);

  const tcFieldId = fields.find((f) => f.name.trim().toLowerCase() === TIMECODE_FIELD.toLowerCase())?.id ?? null;
  const fromCard = selectedTimecode(selected, tcFieldId, rate);

  const derived = derivedOf(calc);
  const put = useCallback((f: TcField, frames: number | null) => {
    setCalc((c) => setField(c, f, frames));
  }, []);

  if (!isOpen) return null;

  const rows: { key: TcField; label: string }[] = [
    { key: "in", label: "In" },
    { key: "out", label: "Out" },
    { key: "dur", label: "Duration" },
  ];

  /* THE ANSWER IGNORES ITS DRAFT. A draft is what you are part-way
   * through typing, and it is only cleared on blur -- so a field that
   * BECOMES the answer while your cursor is elsewhere would go on showing
   * the number you typed into it two edits ago instead of the one it now
   * computes. Typing into the answer makes it stop being the answer on
   * the same keystroke, so the draft applies again immediately. */
  const shown = (f: TcField) => {
    const value = f === "dur" ? showDuration(calc.frames.dur, rate) : showPosition(calc.frames[f], rate);
    return f === derived ? value : (draft[f] ?? value);
  };

  return (
    <FloatPanel
      title="Timecode calculator"
      x={pos.x}
      y={pos.y}
      width={396}
      onMove={(x, y) => setPos({ x, y })}
      onClose={tcCalc.close}
      sticky={tcPinned}
      /* the board's keys keep working with the calculator up (owner,
       * 2026-09-12); its fields still take what is typed into them */
      passive
      pin={{
        on: tcPinned,
        toggle: () => setSetting("", "tcPinned", !tcPinned),
        tip: "Pin window",
      }}
      done
    >
      {rows.map(({ key, label }) => (
        <div key={key} className={"tc-row" + (derived === key ? " answer" : "")}>
          <span className="tc-row-label mono">{label}</span>
          <input
            className="tc-input mono"
            aria-label={label}
            value={shown(key)}
            placeholder={key === "dur" ? "00:00:00:00" : "01:00:00:00"}
            onChange={(e) => {
              /* Typing the duration as a timecode RELEASES the clock
                 field beside it: the two are one number in two spellings,
                 so a draft left on the other one would keep showing what
                 you typed before rather than what you just said. */
              setDraft((d) => ({ ...d, [key]: e.target.value, ...(key === "dur" ? { durClock: undefined } : {}) }));
              put(key, parseAny(e.target.value, rate));
            }}
            /* ENTER COMMITS, which is where he expects to see it resolve
               ("if you enter 48 in frames, it'll resolve to 2:00 when you
               hit enter"). Dropping the draft is all it takes: the field
               then shows the model's value, which is the carried one.
               Blur does the same, for a click away. */
            onKeyDown={(e) => {
              if (e.key === "Enter") setDraft((d) => ({ ...d, [key]: undefined }));
            }}
            onBlur={() => setDraft((d) => ({ ...d, [key]: undefined }))}
          />
          {/* the clock form, his ask: the same length said out loud */}
          {key === "dur" ? (
            <input
              className="tc-input tc-clock mono"
              aria-label="Duration in minutes and seconds"
              value={draft.durClock ?? showClock(calc.frames.dur, rate)}
              placeholder="0:00"
              onChange={(e) => {
                // ...and the same the other way: see the timecode field above
                setDraft((d) => ({ ...d, durClock: e.target.value, dur: undefined }));
                const secs = parseClock(e.target.value);
                put("dur", secs === null ? null : clockToFrames(secs, rate));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") setDraft((d) => ({ ...d, durClock: undefined }));
              }}
              onBlur={() => setDraft((d) => ({ ...d, durClock: undefined }))}
            />
          ) : (
            <button
              className="tc-take tc-take-card"
              aria-label={`Take ${label.toLowerCase()} from the selected card`}
              data-tip={
                fromCard === null
                  ? "Select a card to pull timecode"
                  : "Pull timecode from active card"
              }
              disabled={fromCard === null}
              onClick={() => {
                setDraft((d) => ({ ...d, [key]: undefined }));
                put(key, fromCard);
              }}
            >
              <Target size={12} />
            </button>
          )}
          <span className="tc-clip">
          <button
            className="tc-take"
            aria-label={`Copy ${label.toLowerCase()}`}
            data-tip={`Copy the ${label.toLowerCase()}`}
            disabled={calc.frames[key] === null}
            onClick={() => void copyText(shown(key))}
          >
            <Copy size={12} />
          </button>
          <button
            className="tc-take tip-left"
            aria-label={`Paste into ${label.toLowerCase()}`}
            data-tip="Paste a timecode from the clipboard"
            onClick={async () => {
              const text = await readClipboard();
              if (text === null) return;
              const frames = parseAny(text, rate);
              if (frames === null) return; // not a timecode: leave the field alone
              setDraft((d) => ({ ...d, [key]: undefined, ...(key === "dur" ? { durClock: undefined } : {}) }));
              put(key, frames);
            }}
          >
            <ClipboardPaste size={12} />
          </button>
          </span>
          {/* THE FORMAT HINTS live INSIDE this row, on its second grid
              line, so they share its columns by construction. As a
              sibling row they had their own copy of the template, and
              its last column held no buttons -- so its middle column was
              47px wider and the mm:ss hint sat 47px off the box it
              describes (owner's screenshot, 2026-09-10). */}
          {key === "dur" && (
            <>
              <span className="tc-hint tc-hint-tc mono">hh:mm:ss:ff</span>
              <span className="tc-hint tc-hint-clock mono">mm:ss (rounded)</span>
            </>
          )}
        </div>
      ))}

      <div className="tc-foot">
        {/* THE RATE LIVES WITH THE FRAME COUNT IT GOVERNS. It used to be a
            full-width picker across the top, the biggest thing in the box
            and the one you touch least -- set once per cut. Down here it
            reads as what it is: the unit the number beside it is in. */}
        <select
          className="tc-rate-pick mono"
          aria-label="Frame rate"
          data-tip="Frame rate"
          value={rate.label}
          onChange={(e) => setSetting(boardId, "tcRate", e.target.value)}
        >
          {RATES.map((r) => (
            <option key={r.label} value={r.label}>
              {r.label}
            </option>
          ))}
        </select>
        {/* ALWAYS THE DURATION, whichever field happens to be the
            answer: reading a frame count off an in-point (an absolute
            position, some 86,000 frames since midnight) says nothing
            anybody asked.

            FRAMES ONLY. It used to add real elapsed seconds, which now
            CONTRADICTS the mm:ss box beside it -- that box re-reads the
            label (60:00 for an hour) while real time is 3603.6 seconds,
            and one panel should not answer the same question two ways.
            Frames is the exact number and mm:ss is the readable one;
            real time belongs to the "more technically robust" mode he
            parked, if it ever comes. */}
        <span className="mono tc-total">
          {calc.frames.dur === null ? "fill any two" : `${calc.frames.dur} frames`}
        </span>
        {/* tip-left, like the panel's own close button: a centered tip on
            a control at the panel's right edge reaches past it, and the
            panel clips (owner's screenshot, 2026-09-10: "tooltip's
            cropped"). The window-edge guard cannot see a panel's edge. */}
        <button
          className="tc-take tip-left"
          aria-label="Clear the calculator"
          data-tip="Clear all three fields"
          onClick={() => {
            setDraft({});
            setCalc((c) => clearCalc(c));
          }}
        >
          <Eraser size={12} />
        </button>
      </div>
    </FloatPanel>
  );
}
