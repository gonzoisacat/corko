import type { Node, SlotId } from "../state/types";

/* ------------------------------------------------------------------ *
 *  A PANEL ABOUT A SELECTION (owner, 2026-09-11: "I need the ability to
 *  do group actions. This includes editing metadata on multiple cards at
 *  once and applying overrides to multi-select groups as well. this is
 *  actually true across all board types." -- and, picking from the
 *  options, 2026-09-12: "mixed panel ideally").
 *
 *  The metadata panel and the text-overrides panel open on the SELECTION
 *  when the card you opened from is part of one -- the rule the card
 *  menu's color swatches, Cut and Copy already follow -- and otherwise
 *  on the one card. Every write those panels make was already plural
 *  (state/ydoc.ts takes `ids: string[]` for values, slots, tags and the
 *  five text overrides); what was singular was what the panel SHOWED.
 *  This file is the pure statement of that: what a set of cards shows
 *  for a value they may not agree on.
 *
 *  MIXED means the cards disagree. A value they share shows as itself; a
 *  value that differs across the set shows EMPTY with a "Mixed"
 *  placeholder, and a write goes to all of them. Absent and empty are
 *  the same thing here ("" is how a cleared value reads), so two cards
 *  with nothing in a category agree.
 *
 *  A SELECTION IS ALWAYS ONE TIER (board/selection.ts resets on a card at
 *  another depth; a grid has one rung; Columns' two rungs never mix), so
 *  nothing here has to reconcile tiers -- a category is the project's
 *  and a text override is a card's, and both exist at every tier alike.
 *
 *  Pure, and pinned by groupEdit.test.ts.
 * ------------------------------------------------------------------ */

export interface Shared<T> {
  /* the value they all hold, or the FIRST one's when mixed -- a caller
   * that wants a resting position (a slider) may use it; one that shows
   * the truth (a field) must show `mixed` instead */
  value: T;
  mixed: boolean;
}

/* One reading for a list of values. `same` says when two count as the
 * same value; the default is strict equality, which is right for
 * strings, numbers, booleans and undefined. */
export function shared<T>(values: T[], same: (a: T, b: T) => boolean = Object.is): Shared<T> {
  if (!values.length) return { value: undefined as T, mixed: false };
  const first = values[0];
  return { value: first, mixed: values.some((v) => !same(v, first)) };
}

/* A metadata category across the set: absent reads as "". */
export function sharedValue(nodes: Node[], fieldId: string): Shared<string> {
  return shared(nodes.map((n) => n.values?.[fieldId] ?? ""));
}

/* A display slot across the set: which category sits in it, or null. */
export function sharedSlot(nodes: Node[], slot: SlotId): Shared<string | null> {
  return shared(nodes.map((n) => n.slots?.[slot] ?? null));
}

/* THE TEXT OVERRIDES across the set, one reading per control. Absent
 * (the tier decides) is a value of its own here -- a card at the tier's
 * size and one pinned to 20 disagree even if the tier's size is 20 --
 * because the panel shows overrides, not results. */
export interface SharedText {
  color: Shared<string | undefined>;
  size: Shared<number | undefined>;
  font: Shared<string | undefined>;
  shadow: Shared<boolean>;
  align: Shared<"top" | "bottom" | undefined>;
  /* nothing set on any of them -- what the Reset row switches on */
  clean: boolean;
}

export function sharedText(nodes: Node[]): SharedText {
  return {
    color: shared(nodes.map((n) => n.textColor)),
    size: shared(nodes.map((n) => n.textSize)),
    font: shared(nodes.map((n) => n.font)),
    shadow: shared(nodes.map((n) => !!n.textShadow)),
    align: shared(nodes.map((n) => n.titleAlign)),
    clean: nodes.every(
      (n) =>
        n.textColor === undefined &&
        n.textSize === undefined &&
        !n.textShadow &&
        n.titleAlign === undefined &&
        n.font === undefined,
    ),
  };
}

/* A TAG across the set: on how many of them. The tags section lists a
 * tag that is on ANY card, and marks the ones that are not on all. */
export function tagShare(nodes: Node[], tagId: string): { on: number; of: number } {
  return { on: nodes.filter((n) => n.tags?.includes(tagId)).length, of: nodes.length };
}

/* Every tag on any card of the set, in the order the project's tag list
 * gives (the caller passes that order), so the section is stable while
 * cards are added to the selection. */
export function tagsOnAny(nodes: Node[], tagOrder: string[]): string[] {
  const on = new Set<string>();
  for (const n of nodes) for (const t of n.tags ?? []) on.add(t);
  return tagOrder.filter((id) => on.has(id));
}

/* THE SUBJECT'S NAME: the card's own title for one, a count for many --
 * "3 scenes", in the tier's word. The naive plural every other count
 * in the app uses (the Boards menu, a band's meta), and for the same
 * reason: tier names are the user's nouns and a rule that guessed at
 * "-ies" would mangle as many as it fixed. */
export function subjectLabel(count: number, tierName: string, title: string): string {
  if (count <= 1) return title;
  return `${count} ${tierName.toLowerCase()}${tierName.toLowerCase().endsWith("s") ? "es" : "s"}`;
}
