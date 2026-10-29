import { accessInfo } from "./access";
import { blobs, wallBlobs, whenBlobStoreChosen } from "./blobStore";
import { carryOver, SHARED_WALL_PREFIX } from "./boardStyle";
import { ownSettingsFor } from "./settings";
import { ops } from "./ydoc";
import type { Board } from "./types";

/* ------------------------------------------------------------------ *
 *  THE ONE-TIME CHANGEOVER (owner, 2026-10-29: "automatic").
 *
 *  Before boards had their own style (state/boardStyle.ts), the look
 *  that had been dialled in lived in each browser. So the first time an
 *  ADMIN's browser opens a board that has no style yet, it writes its own
 *  values for that board onto it -- only those that differ from the
 *  app's defaults -- and the board wears them for everyone from then on.
 *  A browser that is not an admin's never writes; its old values simply
 *  become its overrides, behind the switch.
 *
 *  Once: a board with a style is never carried onto again. A board
 *  whose admin had nothing but defaults writes nothing, so the next
 *  admin with a look of their own may dress it -- the first admin with
 *  something to say. Asked only once the room has SYNCED, or a browser
 *  holding a stale copy could dress a board another admin already had.
 *
 *  A personal wall picture is copied into the shared store first, so the
 *  board's key is one everyone can fetch.
 * ------------------------------------------------------------------ */

const tried = new Set<string>();

export async function carryStyle(board: Board): Promise<void> {
  if (board.style || tried.has(board.id) || !accessInfo()?.admin) return;
  tried.add(board.id);
  const own = ownSettingsFor(board.id);
  const patch = carryOver(own);
  if (own.wallImage) {
    try {
      const blob = await wallBlobs.get(own.wallImage);
      if (blob) {
        await whenBlobStoreChosen();
        const key = `${SHARED_WALL_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        await blobs.put(key, blob);
        patch.wallImage = key;
      }
    } catch {
      /* no picture is the safe answer; the wall color still carries */
    }
  }
  if (Object.keys(patch).length) ops.setBoardStyle(board.id, patch);
}
