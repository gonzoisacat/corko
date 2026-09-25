import { setSetting, useSettings } from "../state/settings";

/* ------------------------------------------------------------------ *
 *  THE NOTE DOTS' SWITCH (owner, 2026-09-07): whether cards wear the
 *  green dot that marks "this card carries notes" (board/NoteDot.tsx).
 *  It used to be a row in the card's note popover; he cut that ("notes
 *  are just the text box and then the author field and done") and
 *  asked for "a symbol toggle, like dark mode ... next to the overrides
 *  symbol (on the board level)". So: the legend's top-right corner,
 *  beside the Overrides door, per board per browser like the setting
 *  it flips.
 *
 *  The symbol is a tiny card with the dot in its corner -- the mark as
 *  it sits on a real card, exaggerated -- rather than a bare green dot,
 *  which beside the topbar's "synced" light would read as a second
 *  status lamp. ON: the dot filled green. OFF: the dot hollow and gray.
 *  No filled button behind it: on is the default, and a corner button
 *  that is lit all day is noise, not a state.
 * ------------------------------------------------------------------ */
export function NoteDotsToggle({ boardId }: { boardId: string }) {
  const { noteDots } = useSettings(boardId);
  return (
    <button
      className={"note-dots-btn tip-left" + (noteDots ? " on" : "")}
      role="switch"
      aria-checked={noteDots}
      aria-label="Note indicator visibility"
      data-tip="Note indicator visibility"
      onClick={() => setSetting(boardId, "noteDots", !noteDots)}
    >
      <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
        <rect x="1.5" y="2" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        {noteDots ? (
          <circle cx="4.5" cy="5" r="2.4" fill="#2ae96c" />
        ) : (
          <circle cx="4.5" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.1" />
        )}
      </svg>
    </button>
  );
}
