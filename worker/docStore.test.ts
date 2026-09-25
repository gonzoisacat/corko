import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CHUNK_BYTES,
  CHUNK_COUNT_KEY,
  DAILY_AT_KEY,
  LEGACY_DOC_KEY,
  MAX_CHUNKS,
  SLOT_KEY,
  chunkKey,
  dailyTakenAt,
  hasSnapshot,
  isEmptyUpdate,
  joinChunks,
  loadDoc,
  saveDaily,
  saveDoc,
  slotChunkKey,
  slotCountKey,
  splitUpdate,
  type DocStorage,
} from "./docStore";

/* ------------------------------------------------------------------ *
 *  The room's snapshot store, headless.
 *
 *  This is the one part of the Worker that can lose the owner's project,
 *  so it is pinned here rather than left to `npm run verify:sync` (which
 *  needs a real runtime and only ever exercises docs far under the
 *  ceiling). What matters:
 *
 *   - a snapshot bigger than one 2 MB storage value round-trips intact;
 *   - a room written by the PRE-chunking build still loads, and its key
 *     is never written or deleted -- that is what makes this deployable
 *     without a coordinated reload, and rollback-able; the single-slot
 *     chunked format that followed it loads the same way;
 *   - shrinking cleans up, in the SAME atomic op as the write;
 *   - nothing ever hands storage a value near the 2 MB wall;
 *   - every save leaves the PREVIOUS generation whole, an empty doc is
 *     never written over a stored one, and a torn slot falls back to the
 *     other slot and then the daily copy before the room starts empty
 *     (2026-09-01: the single-slot store could persist two bytes over the
 *     only copy of the project).
 * ------------------------------------------------------------------ */

/* A stand-in for DurableObjectStorage: a Map, plus a log of the calls so
 * the atomicity contract can be asserted rather than assumed. Values are
 * deep-copied on the way in, like a real structured-clone boundary. */
function fakeStorage() {
  const data = new Map<string, unknown>();
  const calls: string[] = [];
  let pendingPuts = 0;

  const storage: DocStorage = {
    get: (<T>(k: string | string[]) => {
      calls.push(Array.isArray(k) ? `get[${k.length}]` : `get:${k}`);
      if (Array.isArray(k)) {
        const out = new Map<string, T>();
        for (const key of k) if (data.has(key)) out.set(key, data.get(key) as T);
        return Promise.resolve(out);
      }
      return Promise.resolve(data.get(k) as T | undefined);
    }) as DocStorage["get"],
    put(entries: Record<string, unknown>) {
      calls.push(`put[${Object.keys(entries).length}]`);
      for (const [k, v] of Object.entries(entries)) {
        data.set(k, v instanceof Uint8Array ? new Uint8Array(v) : v);
      }
      // settle a tick later, so "was delete issued while the put was still
      // in flight?" is a question the test can actually ask
      pendingPuts++;
      return Promise.resolve().then(() => {
        pendingPuts--;
      });
    },
    delete(keys: string[]) {
      calls.push(`delete[${keys.length}]@pending${pendingPuts}`);
      let n = 0;
      for (const k of keys) if (data.delete(k)) n++;
      return Promise.resolve(n);
    },
  };
  return { storage, data, calls };
}

const bytes = (n: number, seed = 1): Uint8Array => {
  const u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = (i * 31 + seed) % 251;
  return u8;
};

/* Compare megabytes of bytes WITHOUT expect().toEqual -- its deep-equality
 * walk over a multi-megabyte TypedArray takes tens of seconds and blows the
 * test timeout, which reads as a logic failure and isn't one. */
const same = (a: Uint8Array | null, b: Uint8Array): boolean =>
  a !== null && a.length === b.length && a.every((v, i) => b[i] === v);

describe("splitUpdate / joinChunks", () => {
  it("round-trips any length, including the exact boundaries", () => {
    for (const n of [0, 1, 99, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, CHUNK_BYTES * 2]) {
      const src = bytes(n);
      expect(same(joinChunks(splitUpdate(src)), src)).toBe(true);
    }
  });

  it("never produces a chunk over the limit", () => {
    for (const p of splitUpdate(bytes(CHUNK_BYTES * 3 + 7))) {
      expect(p.length).toBeLessThanOrEqual(CHUNK_BYTES);
    }
  });

  it("an empty update is zero chunks, not one empty one", () => {
    expect(splitUpdate(new Uint8Array(0))).toEqual([]);
  });
});

describe("saveDoc / loadDoc", () => {
  it("returns null for a room that has never been written", async () => {
    const { storage } = fakeStorage();
    expect(await loadDoc(storage)).toBeNull();
  });

  it("round-trips a snapshot that needs several chunks", async () => {
    const { storage, data } = fakeStorage();
    const src = bytes(CHUNK_BYTES * 2 + 12345, 7);
    await saveDoc(storage, src);

    expect(data.get(SLOT_KEY)).toBe("a");
    expect(data.get(slotCountKey("a"))).toBe(3);
    expect(same(await loadDoc(storage), src)).toBe(true);
  });

  it("no stored value ever approaches the 2 MB ceiling", async () => {
    const { storage, data } = fakeStorage();
    await saveDoc(storage, bytes(CHUNK_BYTES * 4 + 999));
    for (const [k, v] of data) {
      if (!(v instanceof Uint8Array)) continue;
      expect(k.length + v.length).toBeLessThan(2_000_000);
    }
  });

  it("refuses a snapshot too big for one storage operation", async () => {
    const { storage } = fakeStorage();
    // don't allocate 190 MB -- splitUpdate is pure, so assert on the guard
    // via a stubbed-large update length
    const huge = { length: CHUNK_BYTES * (MAX_CHUNKS + 1), subarray: () => new Uint8Array(1) };
    await expect(saveDoc(storage, huge as unknown as Uint8Array)).rejects.toThrow(/over the 126/);
  });
});

describe("the upgrade path off the single-key format", () => {
  it("loads a room the PRE-chunking build wrote", async () => {
    const { storage, data } = fakeStorage();
    const legacy = bytes(4096, 3);
    data.set(LEGACY_DOC_KEY, legacy);
    expect(same(await loadDoc(storage), legacy)).toBe(true);
  });

  it("leaves the legacy key untouched -- the rollback escape hatch", async () => {
    const { storage, data } = fakeStorage();
    const legacy = bytes(4096, 3);
    data.set(LEGACY_DOC_KEY, legacy);

    await saveDoc(storage, bytes(9000, 5));

    expect(same(data.get(LEGACY_DOC_KEY) as Uint8Array, legacy)).toBe(true); // not rewritten, not deleted
  });

  it("prefers the chunked snapshot once one exists", async () => {
    const { storage, data } = fakeStorage();
    data.set(LEGACY_DOC_KEY, bytes(4096, 3));
    const fresh = bytes(9000, 5);
    await saveDoc(storage, fresh);
    expect(same(await loadDoc(storage), fresh)).toBe(true);
  });
});

describe("a doc that shrinks", () => {
  it("deletes the chunks it no longer fills, once that slot is written again", async () => {
    const { storage, data } = fakeStorage();
    await saveDoc(storage, bytes(CHUNK_BYTES * 3 + 5)); // slot a, 4 chunks
    expect(data.has(slotChunkKey("a", 3))).toBe(true);

    const smaller = bytes(1000, 9);
    await saveDoc(storage, smaller); // slot b
    // slot a is the previous generation and stays whole
    expect(data.has(slotChunkKey("a", 3))).toBe(true);

    await saveDoc(storage, smaller); // back into slot a
    expect(data.get(SLOT_KEY)).toBe("a");
    expect(data.get(slotCountKey("a"))).toBe(1);
    expect(data.has(slotChunkKey("a", 1))).toBe(false);
    expect(data.has(slotChunkKey("a", 3))).toBe(false);
    expect(same(await loadDoc(storage), smaller)).toBe(true);
  });

  it("cleans up in the SAME atomic op as the write, not after it", async () => {
    const { storage, calls } = fakeStorage();
    await saveDoc(storage, bytes(CHUNK_BYTES * 2 + 5)); // a: 3 chunks
    await saveDoc(storage, bytes(1000)); // b
    calls.length = 0;
    await saveDoc(storage, bytes(1000)); // a again: chunks 1 and 2 go

    /* The delete must be issued before the put has settled -- that is what
     * makes storage combine them into one transaction, and therefore what
     * stops a crash mid-save from leaving `doc:n` pointing at chunks that
     * were never written. "@pending1" = a put was still in flight. */
    expect(calls).toContain("delete[2]@pending1");
  });
});

describe("a torn snapshot", () => {
  it("refuses rather than applying half an update", async () => {
    const { storage, data } = fakeStorage();
    await saveDoc(storage, bytes(CHUNK_BYTES * 2 + 5));
    data.delete(slotChunkKey("a", 1)); // something outside this module ate a chunk

    expect(await loadDoc(storage)).toBeNull();
  });

  it("falls back to the previous generation", async () => {
    const { storage, data } = fakeStorage();
    const first = bytes(CHUNK_BYTES + 5, 2);
    const second = bytes(CHUNK_BYTES + 9, 3);
    await saveDoc(storage, first);
    await saveDoc(storage, second);
    expect(same(await loadDoc(storage), second)).toBe(true);

    data.delete(slotChunkKey("b", 1));
    expect(same(await loadDoc(storage), first)).toBe(true);
  });

  it("falls back to the daily copy when both slots are torn", async () => {
    const { storage, data } = fakeStorage();
    const daily = bytes(5000, 4);
    await saveDaily(storage, daily, 1000);
    await saveDoc(storage, bytes(CHUNK_BYTES + 5, 2));
    await saveDoc(storage, bytes(CHUNK_BYTES + 9, 3));
    data.delete(slotChunkKey("a", 0));
    data.delete(slotChunkKey("b", 0));
    expect(same(await loadDoc(storage), daily)).toBe(true);
    expect(await dailyTakenAt(storage)).toBe(1000);
    expect(data.get(DAILY_AT_KEY)).toBe(1000);
  });
});

describe("the previous generation", () => {
  it("survives every save -- two slots alternate", async () => {
    const { storage, data } = fakeStorage();
    const a = bytes(100, 1);
    const b = bytes(200, 2);
    const c = bytes(300, 3);
    await saveDoc(storage, a);
    await saveDoc(storage, b);
    await saveDoc(storage, c);
    expect(data.get(SLOT_KEY)).toBe("a");
    expect(same(data.get(slotChunkKey("a", 0)) as Uint8Array, c)).toBe(true);
    expect(same(data.get(slotChunkKey("b", 0)) as Uint8Array, b)).toBe(true);
  });
});

describe("an empty doc", () => {
  const empty = Y.encodeStateAsUpdate(new Y.Doc());

  it("is what Yjs encodes for nothing, and is recognised as such", () => {
    expect(empty.length).toBe(2);
    expect(isEmptyUpdate(empty)).toBe(true);
    expect(isEmptyUpdate(bytes(3))).toBe(false);
  });

  it("is REFUSED over a stored snapshot -- the torn-read-then-persist path", async () => {
    const { storage, data } = fakeStorage();
    const real = bytes(CHUNK_BYTES + 5, 2);
    await saveDoc(storage, real);
    data.delete(slotChunkKey("a", 0)); // the read is refused, the room starts empty...
    expect(await loadDoc(storage)).toBeNull();
    // ...a client connects, finds nothing, leaves, and last-one-out persists
    expect(await saveDoc(storage, empty)).toBe("refused-empty");
    expect(data.get(SLOT_KEY)).toBe("a");
    expect(data.has(slotCountKey("b"))).toBe(false);
  });

  it("is refused over the older formats too", async () => {
    const { storage, data } = fakeStorage();
    data.set(LEGACY_DOC_KEY, bytes(10));
    expect(await hasSnapshot(storage)).toBe(true);
    expect(await saveDoc(storage, empty)).toBe("refused-empty");
    const v1 = fakeStorage();
    v1.data.set(CHUNK_COUNT_KEY, 1);
    v1.data.set(chunkKey(0), bytes(10));
    expect(await saveDoc(v1.storage, empty)).toBe("refused-empty");
  });

  it("is written into a room that has never held anything", async () => {
    const { storage } = fakeStorage();
    expect(await hasSnapshot(storage)).toBe(false);
    expect(await saveDoc(storage, empty)).toBe("written");
  });

  it("is never taken as the daily copy", async () => {
    const { storage, data } = fakeStorage();
    expect(await saveDaily(storage, empty, 5)).toBe(false);
    expect(data.size).toBe(0);
  });
});

describe("the single-slot chunked format", () => {
  it("loads a room the 2026-08 build wrote, and never touches its keys", async () => {
    const { storage, data } = fakeStorage();
    const old = bytes(CHUNK_BYTES + 77, 6);
    const parts = splitUpdate(old);
    data.set(CHUNK_COUNT_KEY, parts.length);
    parts.forEach((p, i) => data.set(chunkKey(i), new Uint8Array(p)));
    expect(same(await loadDoc(storage), old)).toBe(true);

    const fresh = bytes(9000, 5);
    await saveDoc(storage, fresh);
    expect(same(await loadDoc(storage), fresh)).toBe(true);
    expect(data.get(CHUNK_COUNT_KEY)).toBe(parts.length);
    expect(same(data.get(chunkKey(1)) as Uint8Array, parts[1])).toBe(true);
  });
});

describe("with a real Yjs document", () => {
  it("survives a save/load bigger than a single storage value", () => {
    const doc = new Y.Doc();
    const arr = doc.getArray<string>("cards");
    // ~2.4 MB of content: comfortably past the old one-key ceiling
    doc.transact(() => {
      for (let i = 0; i < 2400; i++) arr.push([`beat ${i} ` + "x".repeat(1000)]);
    });
    const update = Y.encodeStateAsUpdate(doc);
    expect(update.length).toBeGreaterThan(CHUNK_BYTES);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, joinChunks(splitUpdate(update)));

    expect(restored.getArray<string>("cards").length).toBe(arr.length);
    expect(restored.getArray<string>("cards").get(2399)).toBe(arr.get(2399));
  });
});
