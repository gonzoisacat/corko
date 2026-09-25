import { storedKey } from "../state/access";
import { isSettled } from "../state/sync";
import { planPurge, purgeSummary } from "../state/stillPurge";
import type { PurgePlan } from "../state/stillPurge";
import type { Project } from "../state/types";
import { confirmDialog } from "../ui/confirmDialog";
import { purgeStills, storedStills } from "./stills";

/* ------------------------------------------------------------------ *
 *  RECLAIMING FRAMES, THE ONE FLOW -- now that it has two doors.
 *
 *  It lived inline in the Boards menu while that was the only way in.
 *  The Usage panel is the second (you go there worried about space, so
 *  the answer to "can I get some back" belongs beside the gauge), and a
 *  second copy of a confirm-then-delete is exactly how the two would
 *  come to disagree about what they are about to erase. This is the one
 *  deletion in the app that undo cannot reverse, so its wording and its
 *  arithmetic get one home.
 *
 *  Everything about WHY it is a deliberate button rather than a cleaner
 *  lives in state/stillPurge.ts's header. The short of it: a peer whose
 *  project has not finished syncing is indistinguishable from a board
 *  that does not exist.
 * ------------------------------------------------------------------ */

/* What could be reclaimed right now, or null if the store could not be
 * read. For TELLING -- the Usage panel's line. Never deletes. */
export async function reclaimable(project: Project): Promise<PurgePlan | null> {
  const stored = await storedStills(storedKey());
  return stored ? planPurge(project, stored) : null;
}

/* The whole gesture: read the store, show exactly what would go, delete
 * only on a yes, then report what ACTUALLY went rather than what was
 * attempted. Answers whether anything was deleted, so a caller showing
 * a reclaimable figure knows to re-read it. */
export async function runReclaim(project: Project): Promise<boolean> {
  /* THE GATE THE HEADER PROMISES. A replica that has not caught up with
   * the room sees every board it lacks as absent, and every image those
   * boards hold as unreferenced -- so until the server's state has
   * arrived (or there is no server to wait for) the answer is no, said
   * in words rather than as a disabled button. */
  if (!isSettled()) {
    confirmDialog.tell(
      "Waiting for the shared board",
      "This browser has not caught up with the room yet, so it cannot tell which images are unused. Try again in a moment.",
    );
    return false;
  }
  const plan = await reclaimable(project);
  if (!plan) return false;
  if (!plan.orphans.length) {
    confirmDialog.tell("Nothing to purge", purgeSummary(plan));
    return false;
  }
  const ok = await confirmDialog.ask({
    title: "Purge unused card images?",
    body: purgeSummary(plan),
    confirmLabel: "Purge",
  });
  if (!ok) return false;
  const n = await purgeStills(plan.orphans);
  confirmDialog.tell("Purged", `${n} image${n === 1 ? "" : "s"} deleted. No board changed.`);
  return n > 0;
}
