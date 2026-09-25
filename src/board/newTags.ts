import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  TAGS MADE IN THIS SESSION, so "+ Add tag" visibly adds one.
 *
 *  The legend row shows only the tags a board USES (board/boardVocab.ts),
 *  which is right -- a mark no card here carries is one you will never
 *  find by scanning. But a brand-new tag is on no cards by definition, so
 *  it fell straight through into the "elsewhere" menu and the row did not
 *  change. Adding one looked like nothing happening (owner-reported
 *  2026-08-05: "i wasn't able to add another tag"). It HAD been added --
 *  the doc went from 5 tags to 6 -- just nowhere you could see it, which
 *  is worse than failing.
 *
 *  So a tag you just made is pinned into the row until a card carries it.
 *  That is the whole window where you need it visible: it is what you
 *  name, restyle and then drag onto the first card. Once any card has it
 *  the board's own vocabulary keeps it there and this store stops
 *  mattering.
 *
 *  SESSION-SCOPED ON PURPOSE, and not synced. It is about the row you are
 *  looking at right now, not about the project -- another collaborator
 *  has no reason to see an unused tag someone else just minted, and a
 *  reload is a fair moment to stop showing one you never used. Same
 *  reasoning as board/autoEdit.ts, which pins the just-added CARD.
 * ------------------------------------------------------------------ */

/* COPY-ON-WRITE, and it is not a style choice. useSyncExternalStore
 * compares the value getSnapshot returns with Object.is and BAILS OUT of
 * re-rendering when it is unchanged -- so mutating one Set in place and
 * handing back the same reference would notify React of nothing, forever.
 * A fresh Set per change is the reference change React needs, and these
 * hold a handful of ids. */
let made: ReadonlySet<string> = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const newTags = {
  add(id: string) {
    if (made.has(id)) return;
    made = new Set(made).add(id);
    emit();
  },
  has: (id: string): boolean => made.has(id),
  /* Dropped when the tag is deleted -- otherwise removing an unused tag
   * would leave its id pinned behind it. */
  forget(id: string) {
    if (!made.has(id)) return;
    const next = new Set(made);
    next.delete(id);
    made = next;
    emit();
  },
  ids: (): ReadonlySet<string> => made,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/* One subscription per legend row, not per chip -- there are two legends
 * at most (one per pane), so this is cheap where a per-card subscription
 * would not be. */
export function useNewTags(): ReadonlySet<string> {
  return useSyncExternalStore(newTags.subscribe, newTags.ids, newTags.ids);
}
