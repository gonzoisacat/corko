import { hasPicture, sitNewPicture } from "./cardImage";
import { blobs } from "../state/blobStore";
import { uid } from "../state/ids";
import { ops } from "../state/useBoard";
import { endChain, PLAYHEAD_FIELD, TIMECODE_FIELD } from "../state/player";
import type { Board, FieldDef, Node } from "../state/types";
import { select } from "./selection";

/* ------------------------------------------------------------------ *
 *  A CAPTURE, written: the impure half of state/player.ts. Given the
 *  frame (already a blob) and its stamps, mint the card at the end of
 *  the board at the chosen tier, hang the still on it, file the stamps
 *  as metadata values under the two categories (created on first use),
 *  put the timecode on the card's face, and select the new card so the
 *  next hand-typed cards land after it.
 *
 *  The still goes to the BLOB STORE, never the doc (state/blobStore.ts's
 *  header): on live that is R2, shared; locally IndexedDB. Written
 *  BEFORE the card references it, so a card never points at bytes that
 *  are not there yet.
 * ------------------------------------------------------------------ */

export interface CaptureInput {
  board: Board;
  tierDepth: number;
  blob: Blob | null;
  stamps: { timecode?: string; runtime?: string };
  fields: FieldDef[];
  /* THE ARMED TAGS (owner, 2026-09-06: "create tags in the player and
   * mint cards with the tags already on them" -- Lumberjack's logger
   * keywords, on a card). Project tags, applied as the card is minted. */
  tagIds?: string[];
}

function fieldIdNamed(fields: FieldDef[], name: string): string {
  const hit = fields.find((f) => f.name.trim().toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const id = ops.addField({ name });
  /* The playhead says its name on the face; a bare second timecode
   * beside the first would read as a mistake. Timecode reads fine bare. */
  if (name === PLAYHEAD_FIELD) ops.setField(id, { showLabel: true });
  return id;
}

/* The stamps as values, the categories minted on first use -- and the
 * TIMECODE on the card's face, bottom-left (owner, 2026-09-06, after
 * a reversal the same hour: "do add the timecode on the layout after
 * all"). `placeTC` is the caller's: a new card has no layout to
 * disturb, a card that already exists keeps a bottom-left slot somebody
 * placed. Runtime is never placed. */
function writeStamps(nodeId: string, stamps: CaptureInput["stamps"], fields: FieldDef[], placeTC: boolean) {
  const values: Record<string, string> = {};
  let tcId: string | null = null;
  if (stamps.timecode) {
    tcId = fieldIdNamed(fields, TIMECODE_FIELD);
    values[tcId] = stamps.timecode;
  }
  if (stamps.runtime) values[fieldIdNamed(fields, PLAYHEAD_FIELD)] = stamps.runtime;
  if (Object.keys(values).length) ops.setNodeValues([nodeId], values);
  if (tcId && placeTC) ops.setNodeSlot([nodeId], "bl", tcId);
}

/* Returns the new card's id, or null when the board has no ladder. */
export async function writeCapture(input: CaptureInput): Promise<string | null> {
  const { board, blob, stamps, fields } = input;
  const depth = Math.max(0, Math.min(input.tierDepth, board.levels.length - 1));

  /* The chain down the end of the board, minting whatever is missing
   * above the target tier -- a first capture into an empty board mints
   * the reel it needs. */
  const chain = endChain(board).map((n) => n.id);
  while (chain.length < depth) {
    const id = chain.length === 0 ? ops.addRoot(board.id) : ops.addChild(chain[chain.length - 1]);
    if (!id) return null;
    chain.push(id);
  }
  const newId = depth === 0 ? ops.addRoot(board.id) : ops.addChild(chain[depth - 1]);
  if (!newId) return null;

  if (blob) {
    const key = uid("st");
    await blobs.put(key, blob);
    ops.setNodeStill(newId, key);
    sitNewPicture(newId); // the remembered default sit, as for any new picture
  }

  writeStamps(newId, stamps, fields, true);

  for (const t of input.tagIds ?? []) ops.setNodeTag([newId], t, true);

  select(newId, "single");
  return newId;
}

/* APPLY: the same frame, stamps and tags onto a card that already
 * exists (owner, 2026-09-06: "retroactively apply an image from a
 * video to an existing board"). The still replaces the card's still;
 * a hand-pinned IMAGE wins in the renderer (cardImage.ts), so a card
 * that has one keeps showing it -- the caller says so rather than
 * letting the frame vanish silently. Returns whether the picture will
 * actually show. */
export async function applyCapture(input: Omit<CaptureInput, "board" | "tierDepth"> & { node: Node }): Promise<{
  pictureShows: boolean;
}> {
  const { node, blob, stamps, fields } = input;
  if (blob) {
    const key = uid("st");
    await blobs.put(key, blob);
    ops.setNodeStill(node.id, key);
    if (!hasPicture(node)) sitNewPicture(node.id); // a first picture; a replacement keeps the card's sit
  }
  writeStamps(node.id, stamps, fields, !node.slots?.bl);
  for (const t of input.tagIds ?? []) ops.setNodeTag([node.id], t, true);
  return { pictureShows: !node.image };
}
