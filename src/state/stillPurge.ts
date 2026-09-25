import type { Board, Node, Project } from "./types";

/* ------------------------------------------------------------------ *
 *  RECLAIMING SPACE -- mark and sweep, and NEVER automatically.
 *
 *  Purging is the argument FOR keeping stills out of the doc rather than
 *  a cost of it. In the doc, deleting is either impossible or
 *  irreversible-and-silent (undo pins the bytes; the only path that
 *  frees them cannot be undone). Out here it is deleting objects: the
 *  space returns at once and no board changes.
 *
 *  THE ONE RULE, and it is load-bearing:
 *
 *      A PEER WHOSE PROJECT HAS NOT FINISHED SYNCING IS
 *      INDISTINGUISHABLE FROM A BOARD THAT DOES NOT EXIST.
 *
 *  So a background cleaner would eventually delete live stills and be
 *  locally correct to do it. This is the same hazard that makes a
 *  dangling `boardRef` draw a TOMBSTONE rather than be repaired away
 *  (see CLAUDE.md's nested-boards section), and it takes the same
 *  answer: a button, with a preview of exactly what would go, run by a
 *  person who can see the project is whole. Never a cron, never an R2
 *  lifecycle rule, never on load.
 *
 *  A SECOND REASON THE SWEEP MUST BE PROJECT-WIDE: a key can be shared.
 *  Duplicating a board copies the cards, and `regenBoardIds` rewrites
 *  node ids but not the still key, so two boards legitimately point at
 *  one frame. Nothing may delete bytes because ONE card stopped using
 *  them -- only because NOTHING does.
 * ------------------------------------------------------------------ */

/* Every still key the project references, across every board. */
export function referencedStills(project: Project): Set<string> {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.still) out.add(n.still);
    n.children.forEach(walk);
  };
  for (const b of project.boards) b.roots.forEach(walk);
  return out;
}

/* The keys one board references -- for "delete this board's stills too",
 * which is the common case and wants no sweep at all. */
export function boardStills(board: Board): Set<string> {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.still) out.add(n.still);
    n.children.forEach(walk);
  };
  board.roots.forEach(walk);
  return out;
}

export interface StoredStill {
  key: string;
  size: number;
}

export interface PurgePlan {
  /* What nothing points at. The only thing that may be deleted. */
  orphans: StoredStill[];
  bytes: number;
  /* Referenced keys that are NOT in the store. Reported and never acted
   * on: it is the normal state for a collaborator who did not run the
   * import, and on a shared store it usually means an upload has not
   * landed yet. Showing it stops "why are some cards blank" being a
   * mystery, without inviting anyone to fix it by deleting things. */
  missing: string[];
}

/* How every surface says a size. Extracted from purgeSummary's inline
 * copy when the delete confirm and the Usage panel became its second and
 * third readers -- three places quoting bytes at a person about the one
 * deletion undo cannot reverse should quote them identically. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/* What deleting ONE board would strand: the stored frames it references
 * that no OTHER board does.
 *
 * The subtraction is the whole point and it is the sweep's second rule
 * in miniature -- a key can be shared, because duplicating a board
 * copies the cards and regenBoardIds rewrites node ids but not still
 * keys. So a board's own frames are NOT its exclusive frames, and the
 * difference is exactly the frames a naive per-board delete would take
 * away from the copy that still wants them.
 *
 * It is used to TELL, never to delete. Deciding "no other board wants
 * these" needs the whole project present, and a peer mid-sync cannot
 * know that it is -- the rule that keeps the real sweep a deliberate
 * button. Reporting a number that might be low is harmless; deleting on
 * one is not. */
export function boardOnlyStills(
  project: Project,
  boardId: string,
  stored: StoredStill[],
): { count: number; bytes: number } {
  const board = project.boards.find((b) => b.id === boardId);
  if (!board) return { count: 0, bytes: 0 };
  const mine = boardStills(board);
  const others = referencedStills({
    ...project,
    boards: project.boards.filter((b) => b.id !== boardId),
  });
  const only = stored.filter((s) => mine.has(s.key) && !others.has(s.key));
  return { count: only.length, bytes: only.reduce((n, s) => n + s.size, 0) };
}

/* What a purge WOULD do. Pure, so the preview and the deletion are
 * computed from one function and cannot disagree about the count. */
export function planPurge(project: Project, stored: StoredStill[]): PurgePlan {
  const used = referencedStills(project);
  const have = new Set(stored.map((s) => s.key));
  const orphans = stored.filter((s) => !used.has(s.key));
  return {
    orphans,
    bytes: orphans.reduce((n, s) => n + s.size, 0),
    missing: [...used].filter((k) => !have.has(k)).sort(),
  };
}

/* The sentences the confirm dialog says. Written here, beside the
 * arithmetic, so the number shown and the number deleted are the same
 * number -- the drift `edlFieldCounts` sharing `shotValues` closes, in
 * the one place where being wrong means deleting somebody's frames.
 *
 * It carries THREE things, each earning its line (`.confirm-body`
 * honours the newlines):
 *  - the count and size, which is the decision;
 *  - the MISSING report -- referenced keys the store does not hold.
 *    Computed by planPurge since the start and shown nowhere until
 *    2026-08-28, which made "why are some cards blank" a mystery this
 *    dialog had the answer to. Reported and never acted on: it is the
 *    normal state for an import that has not synced here.
 *  - the two caveats the arithmetic cannot see: a collaborator's
 *    un-synced import looks exactly like orphans, and undo cannot bring
 *    purged frames back (a board delete undone AFTER a purge returns
 *    with blank cards -- the frames were orphans at the moment of the
 *    sweep, and the sweep is the one deletion undo does not cover). */
export function purgeSummary(plan: PurgePlan): string {
  const miss = plan.missing.length
    ? `\n\n${plan.missing.length} referenced image${plan.missing.length === 1 ? " is" : "s are"} ` +
      `not stored here -- normal when an import has not synced yet. They are left alone.`
    : "";
  const n = plan.orphans.length;
  /* THE HAND-ADDED CAVEAT RIDES THE EMPTY CASE ONLY, which is the one
   * place it answers a question somebody is actually asking. An image
   * dropped in from Finder lives INSIDE the board (a data URI in the
   * doc) and no sweep can reach it, so "I deleted a pile of photos, why
   * did this find nothing?" has an answer -- and on every other run it
   * would be a paragraph about something that did not happen. */
  if (!n) {
    return (
      "Every stored image is still used by a card." +
      miss +
      "\n\nImages added by hand live inside the board itself, so they are never listed here."
    );
  }
  const size = formatBytes(plan.bytes);
  return (
    `${n} stored image${n === 1 ? "" : "s"} (${size}) ${n === 1 ? "is" : "are"} not used by any ` +
    `card in this project. Purging them frees that space and changes no board.` +
    miss +
    `\n\nRun this once everyone's imports have synced. Undo cannot bring purged images back.`
  );
}
