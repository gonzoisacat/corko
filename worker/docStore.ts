/* ------------------------------------------------------------------ *
 *  Where the room's Yjs snapshot lives in Durable Object storage.
 *
 *  It used to be one key: `storage.put("doc", encodeStateAsUpdate(doc))`.
 *  That has a hard ceiling -- a SQLite-backed Durable Object caps KEY +
 *  VALUE COMBINED at 2 MB, on every plan (it is a platform limit, not a
 *  billing tier: paying for Workers Paid does not move it). Past that the
 *  put throws, and the only thing that notices is a console.error nobody
 *  is tailing: the room keeps serving from memory, every client keeps
 *  working off its own IndexedDB, and then the first hibernation eviction
 *  rebuilds from the last snapshot that fit and silently rolls the
 *  project back to whenever it crossed the line.
 *
 *  A Yjs update stream only ever grows -- gc is on, but tombstones and the
 *  delete set persist -- so that ceiling is a date, not a maybe.
 *
 *  So the snapshot is SPLIT across as many keys as it needs -- and, since
 *  2026-09-01, kept in TWO GENERATIONS plus a daily copy:
 *
 *      doc:slot -> "a" | "b"   which slot holds the CURRENT snapshot
 *      a:n      -> how many chunks slot a holds
 *      a:0..    -> its bytes, CHUNK_BYTES apiece
 *      b:n, b:0..   the same for slot b
 *      daily:n, daily:0.., daily:at   a copy the room's alarm takes once
 *                                     a day, so a bad save that has been
 *                                     repeated every 3s for an hour still
 *                                     has a yesterday behind it
 *
 *  A save writes the slot the pointer does NOT name and flips the pointer
 *  in the same atomic batch. The slot it came from is left whole: that is
 *  the previous generation, and the reason this changed. The single-slot
 *  store could be handed an EMPTY doc (a torn read starts the room empty;
 *  a fresh browser connects, finds nothing, and leaves; last-one-out
 *  persists) and would write two bytes over the only copy of the project.
 *  Now `saveDoc` refuses an empty doc while any snapshot is stored, and
 *  even a save that goes through leaves the one before it intact.
 *
 *  Three properties make this safe to run against real data:
 *
 *  - **Writes are ATOMIC.** The pointer flip, the count, every chunk, and
 *    the deletes for any chunks the doc shrank past all go in one
 *    transaction -- Durable Object storage combines put/delete calls
 *    issued without an `await` between them. There is no instant at which
 *    the pointer names a slot whose chunks are not all on disk.
 *  - **Older formats are read, never written, and never deleted.** The
 *    pre-chunking `doc` key and the single-slot `doc:n` / `doc:0..` set
 *    both still load, so a room last written by either build comes up
 *    unchanged and a rollback is just a redeploy. They cost a stale copy
 *    against a 5 GB cap, which is the cheapest insurance in the file.
 *  - **A torn read falls BACK, and only then refuses.** Applying a
 *    truncated Yjs update corrupts the doc, so a slot missing a chunk is
 *    never applied -- but the other slot, the daily copy and the legacy
 *    keys are each tried before the room starts empty.
 * ------------------------------------------------------------------ */

/* The pre-chunking single-key snapshot. Still LOADED (a room that has not
 * been written since the upgrade has only this), never written. */
export const LEGACY_DOC_KEY = "doc";

/* The single-slot chunked format (2026-08-03 .. 2026-09-01). Loaded when
 * no slot pointer exists yet; never written again. */
export const CHUNK_COUNT_KEY = "doc:n";
export const chunkKey = (i: number): string => `doc:${i}`;

export type Slot = "a" | "b";
export const SLOT_KEY = "doc:slot";
export const slotCountKey = (s: Slot | "daily"): string => `${s}:n`;
export const slotChunkKey = (s: Slot | "daily", i: number): string => `${s}:${i}`;
/* When the daily copy was taken (ms since epoch). */
export const DAILY_AT_KEY = "daily:at";

/* 1.5 MB against a 2 MB ceiling. The key is a handful of bytes, so the
 * margin is really 500 KB of slack for structured-clone overhead -- big
 * enough that no encoding surprise reaches the wall, small enough that a
 * multi-megabyte doc still lands in a couple of rows. */
export const CHUNK_BYTES = 1_500_000;

/* `put`/`get`/`delete` take at most 128 keys per call; the count key and
 * the slot pointer are two of them. 126 chunks is ~190 MB of Yjs
 * snapshot -- unreachable in practice, but the guard names the limit
 * instead of letting a put fail with something inscrutable. */
export const MAX_CHUNKS = 126;

/* The slice of DurableObjectStorage this needs. Narrow on purpose: it is
 * what makes the whole thing testable against a plain Map (see
 * docStore.test.ts) rather than only inside a real runtime. */
export interface DocStorage {
  get<T>(key: string): Promise<T | undefined>;
  get<T>(keys: string[]): Promise<Map<string, T>>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
}

export function splitUpdate(update: Uint8Array, size = CHUNK_BYTES): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let at = 0; at < update.length; at += size) {
    parts.push(update.subarray(at, Math.min(at + size, update.length)));
  }
  return parts;
}

export function joinChunks(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* `Y.encodeStateAsUpdate` of a doc with no content is exactly two bytes
 * (zero structs, an empty delete set). Anything that short has nothing in
 * it, whatever the encoder's future framing. */
export function isEmptyUpdate(update: Uint8Array): boolean {
  return update.length <= 2;
}

/* Storage hands binary back as an ArrayBuffer; a test double (and
 * miniflare, depending on the path) may hand back the Uint8Array it was
 * given. Accept either rather than caring which. */
function toBytes(v: ArrayBuffer | Uint8Array): Uint8Array {
  return v instanceof Uint8Array ? v : new Uint8Array(v);
}

/* One chunked set under `prefix`: the bytes, `null` when it is TORN (a
 * count with chunks missing -- logged, never applied), `undefined` when it
 * was never written. The three callers below need all three answers. */
async function readSet(
  storage: DocStorage,
  countKey: string,
  key: (i: number) => string,
  label: string,
): Promise<Uint8Array | null | undefined> {
  const n = await storage.get<number>(countKey);
  if (typeof n !== "number") return undefined;
  if (n <= 0) return undefined;
  const keys = Array.from({ length: n }, (_, i) => key(i));
  const got = await storage.get<ArrayBuffer | Uint8Array>(keys);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const part = got.get(key(i));
    if (part === undefined) {
      /* Can only happen if something wrote these keys outside this module
       * -- every save path is atomic. Half a Yjs update is not a smaller
       * doc, it is a broken one, so this set is refused and the caller
       * moves on to the next-best copy. */
      console.error(`corko: ${label} snapshot chunk ${i}/${n} missing -- skipping it`);
      return null;
    }
    parts.push(toBytes(part));
  }
  return joinChunks(parts);
}

const other = (s: Slot): Slot => (s === "a" ? "b" : "a");

/* The stored snapshot, or null when the room has never been written (or
 * when nothing that is there can be trusted). Order of preference: the
 * current slot, the previous slot, the daily copy, then the two older
 * formats. */
export async function loadDoc(storage: DocStorage): Promise<Uint8Array | null> {
  const slot = await storage.get<Slot>(SLOT_KEY);
  if (slot === "a" || slot === "b") {
    for (const s of [slot, other(slot)]) {
      const got = await readSet(storage, slotCountKey(s), (i) => slotChunkKey(s, i), `slot ${s}`);
      if (got) return got;
    }
    const daily = await readSet(storage, slotCountKey("daily"), (i) => slotChunkKey("daily", i), "daily");
    if (daily) return daily;
  }
  const v1 = await readSet(storage, CHUNK_COUNT_KEY, chunkKey, "single-slot");
  if (v1) return v1;
  // never written in any chunked format: the old single key, if any
  const legacy = await storage.get<ArrayBuffer | Uint8Array>(LEGACY_DOC_KEY);
  return legacy ? toBytes(legacy) : null;
}

/* Is there ANY snapshot on disk? Cheap: counts and the pointer only. */
export async function hasSnapshot(storage: DocStorage): Promise<boolean> {
  const slot = await storage.get<Slot>(SLOT_KEY);
  if (slot === "a" || slot === "b") return true;
  if (typeof (await storage.get<number>(CHUNK_COUNT_KEY)) === "number") return true;
  return (await storage.get<unknown>(LEGACY_DOC_KEY)) !== undefined;
}

/* The one atomic batch every writer uses: count + chunks (+ any extra
 * keys) in, the tail of a shrunk set out, no `await` between them. */
async function writeSet(
  storage: DocStorage,
  update: Uint8Array,
  countKey: string,
  key: (i: number) => string,
  extra: Record<string, unknown>,
): Promise<void> {
  const parts = splitUpdate(update);
  if (parts.length > MAX_CHUNKS) {
    throw new Error(
      `corko: snapshot needs ${parts.length} chunks, over the ${MAX_CHUNKS} a single storage op allows`,
    );
  }
  // how many chunks the LAST write of this set held, so a doc that shrank
  // doesn't leave the tail of the old one lying around
  const prev = await storage.get<number>(countKey);
  const stale: string[] = [];
  if (typeof prev === "number") {
    for (let i = parts.length; i < prev; i++) stale.push(key(i));
  }
  const entries: Record<string, unknown> = { ...extra, [countKey]: parts.length };
  parts.forEach((p, i) => {
    // subarray VIEWS share the source buffer; copy so what is handed to
    // storage is exactly this chunk's bytes and nothing either side
    entries[key(i)] = new Uint8Array(p);
  });
  /* No `await` between these two: Durable Object storage combines
   * put/delete issued in the same turn into ONE atomic transaction. That
   * is what makes a crash mid-save leave the previous snapshot whole
   * instead of a count pointing at chunks that were never written. */
  const written = storage.put(entries);
  const cleaned = stale.length ? storage.delete(stale) : Promise.resolve(0);
  await Promise.all([written, cleaned]);
}

export type SaveResult = "written" | "refused-empty";

/* Write the current snapshot into the slot the pointer does not name and
 * flip the pointer -- so the slot it came from is left whole as the
 * previous generation. An EMPTY doc is refused whenever any snapshot is
 * already stored: a room that starts empty because its read was refused
 * must never overwrite what it could not read. */
export async function saveDoc(storage: DocStorage, update: Uint8Array): Promise<SaveResult> {
  if (isEmptyUpdate(update) && (await hasSnapshot(storage))) return "refused-empty";
  const current = await storage.get<Slot>(SLOT_KEY);
  const target: Slot = current === "a" ? "b" : "a";
  await writeSet(storage, update, slotCountKey(target), (i) => slotChunkKey(target, i), {
    [SLOT_KEY]: target,
  });
  return "written";
}

/* The day's copy. Same batch discipline, its own keys, stamped with when
 * it was taken so the room can pace itself. Empty docs are never copied. */
export async function saveDaily(storage: DocStorage, update: Uint8Array, now: number): Promise<boolean> {
  if (isEmptyUpdate(update)) return false;
  await writeSet(storage, update, slotCountKey("daily"), (i) => slotChunkKey("daily", i), {
    [DAILY_AT_KEY]: now,
  });
  return true;
}

export async function dailyTakenAt(storage: DocStorage): Promise<number | null> {
  const at = await storage.get<number>(DAILY_AT_KEY);
  return typeof at === "number" ? at : null;
}
