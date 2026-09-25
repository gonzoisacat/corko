import type { Board, LegendEntry, Node } from "./types";

/* ------------------------------------------------------------------ *
 *  THE PROJECT PALETTE, pure half (ADR 0006, owner 2026-09-04).
 *
 *  A color override used to be a legend entry OF A BOARD, and a card's
 *  `color` names that entry by id. Copy the card to another board and
 *  the id came along but the entry did not: the receiving legend had no
 *  such id, `resolveNodeEntry` fell back to the tier default, and the
 *  override was lost to the eye though not to the doc. Tags never had
 *  the problem because they are project-level.
 *
 *  So overrides are project-level too now: one palette, read by every
 *  board. This file is the arithmetic of getting there and staying
 *  there -- HOISTING whatever option entries a board's legend still
 *  holds up into the palette, with the owner's rules for the cases:
 *
 *   - the palette already has that ID   -> keep the reference; the
 *     project's version of the color wins (boards duplicated from one
 *     master share ids, and someone may have recolored it since);
 *   - the palette has the same LABEL    -> the board's cards are
 *     remapped onto the project's entry; again its version wins;
 *   - neither                           -> the entry moves up as it is.
 *
 *  Tier defaults and the nesting fill never move: they are the board's
 *  baseline, and a card that explicitly wore a tier's own color takes the
 *  receiving board's baseline when it travels, which is what he asked.
 *
 *  Idempotent and order-stable, so the repair pass can run it on every
 *  sync and two clients hoisting at once converge (a doubled id is then
 *  the repair pass's ordinary duplicate).
 * ------------------------------------------------------------------ */

/* a free option color: bound to no tier and no role */
export const isOption = (e: LegendEntry): boolean => !e.tier && !e.role;

/* labels match case- and space-insensitively; an unnamed entry matches
 * nothing by label, only by id */
export const normLabel = (s: string): string => s.trim().toLowerCase();

export interface Hoist {
  /* entries to append to the palette, in the order they were met */
  add: LegendEntry[];
  /* board entry id -> palette entry id, for cards that named a
   * same-label entry that now resolves to the project's */
  remap: Map<string, string>;
  /* per board id, the option entry ids to delete from its legend */
  strip: Map<string, string[]>;
}

export function planHoist(boards: Board[], palette: LegendEntry[]): Hoist {
  const byId = new Map(palette.map((e) => [e.id, e]));
  const byLabel = new Map<string, LegendEntry>();
  for (const e of palette) {
    const k = normLabel(e.label);
    if (k && !byLabel.has(k)) byLabel.set(k, e);
  }
  const add: LegendEntry[] = [];
  const remap = new Map<string, string>();
  const strip = new Map<string, string[]>();
  for (const b of boards) {
    const gone: string[] = [];
    for (const e of b.legend) {
      if (!isOption(e)) continue;
      gone.push(e.id);
      if (byId.has(e.id)) continue;
      const k = normLabel(e.label);
      const same = k ? byLabel.get(k) : undefined;
      if (same) {
        remap.set(e.id, same.id);
        continue;
      }
      const moved: LegendEntry = { id: e.id, label: e.label, bg: e.bg, border: e.border };
      add.push(moved);
      byId.set(moved.id, moved);
      if (k) byLabel.set(k, moved);
    }
    if (gone.length) strip.set(b.id, gone);
  }
  return { add, remap, strip };
}

/* Whether a hoist would change anything -- the repair pass's cheap gate. */
export const hoistNeeded = (h: Hoist): boolean => h.add.length > 0 || h.remap.size > 0 || h.strip.size > 0;

/* The color ids a board's cards actually name (an override is only ever
 * worn by a card that names it), for the legend row and the board file. */
export function usedColorIds(board: Board | null): Set<string> {
  const ids = new Set<string>();
  if (!board) return ids;
  const walk = (n: Node) => {
    if (n.color) ids.add(n.color);
    n.children.forEach(walk);
  };
  board.roots.forEach(walk);
  return ids;
}
