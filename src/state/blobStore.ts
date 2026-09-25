import { projectParam, scoped } from "./project";
/* ------------------------------------------------------------------ *
 *  BLOBSTORE -- where bytes live when they are too big for the doc.
 *
 *  A small interface with a local implementation as the default, which
 *  is `state/sync/types.ts`'s pattern and it earned itself: because
 *  multiplayer sat behind one, swapping PartyKit for Cloudflare was ONE
 *  FILE. A remote backend here (Phase C: R2 behind the Worker, served
 *  on a gated route) should be an adapter, never the architecture.
 *
 *  WHY ANYTHING LIVES OUT HERE AT ALL. The doc is persisted whole, in
 *  1.5 MB chunks, rewritten on every 3-second debounced save, and
 *  downloaded entire by every joining client. It is 740 KB for 3,200
 *  cards today. A still per shot at ~15 KB is 7.5 MB for 500 shots --
 *  ten times the whole project, on every save, forever. Forever is
 *  literal: an ordinary delete does not reclaim it, because the
 *  UndoManager pins deleted content so undo can bring it back (measured:
 *  100 x 50 KB deleted normally left the doc at 4,884 KB; deleted under
 *  an untracked origin it fell to 1.3 KB).
 *
 *  Which is also the argument FOR this design rather than a cost of it:
 *  out here, purging is deleting rows, and the space comes straight
 *  back.
 *
 *  KEYS ARE MINTED, NOT DERIVED FROM NODE IDS. A still is written before
 *  `ops.importBoard` has minted the node's final id, and node ids are
 *  regenerated again by duplicate/import -- so keying on them would
 *  strand every blob. `regenBoardIds` rewrites ids and not arbitrary
 *  string fields, so a minted key rides along untouched and a duplicated
 *  board's cards keep pointing at the frames they came with.
 *
 *  A CONSEQUENCE WORTH KNOWING: two boards can therefore share a blob,
 *  so nothing may delete a key just because ONE card stopped using it.
 *  That is what makes purging a mark-and-sweep over every board rather
 *  than a per-card cleanup, and why it must never run automatically -- a
 *  peer whose project has not finished syncing is indistinguishable from
 *  a board that does not exist.
 * ------------------------------------------------------------------ */

export interface BlobStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | null>;
  has(key: string): Promise<boolean>;
  /* Returns how many were actually removed, so a purge can report what
   * it did rather than what it attempted. */
  remove(keys: string[]): Promise<number>;
  keys(): Promise<string[]>;
  /* Total bytes held, for the "reclaim space" report. */
  size(): Promise<number>;
}

const DB = "corko-blobs";
const STORE = "blobs";

/* ONE DATABASE PER STORE, opened once, with the failure cached as null
 * rather than retried: private mode and a denied quota do not get better
 * on the second try, and every caller here already has a degraded path
 * (no still, rather than a crash). state/access.ts learned that one the
 * hard way with localStorage. A factory since 2026-09-04, because the
 * board frame's WALL pictures want the same store shape in a database
 * of their own -- the purge sweeps this one against every board's
 * references, and a wall is not referenced by any board. */
function idbStore(dbName: string): BlobStore {
  let dbp: Promise<IDBDatabase | null> | null = null;
  function open(): Promise<IDBDatabase | null> {
    if (dbp) return dbp;
    dbp = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbp;
  }
  function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
    return open().then(
      (db) =>
        new Promise<T | null>((resolve) => {
          if (!db) return resolve(null);
          try {
            const t = db.transaction(STORE, mode);
            const req = run(t.objectStore(STORE));
            req.onsuccess = () => resolve(req.result as T);
            req.onerror = () => resolve(null);
            t.onerror = () => resolve(null);
            t.onabort = () => resolve(null);
          } catch {
            resolve(null);
          }
        }),
    );
  }
  return {
    async put(key, blob) {
      await tx("readwrite", (s) => s.put(blob, key));
    },
    async get(key) {
      const v = await tx<Blob>("readonly", (s) => s.get(key));
      return v instanceof Blob ? v : null;
    },
    async has(key) {
      const v = await tx<number>("readonly", (s) => s.count(key));
      return (v ?? 0) > 0;
    },
    async remove(keys) {
      let n = 0;
      for (const k of keys) {
        if (await this.has(k)) {
          await tx("readwrite", (s) => s.delete(k));
          n++;
        }
      }
      return n;
    },
    async keys() {
      const v = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
      return (v ?? []).map(String);
    },
    async size() {
      const v = await tx<Blob[]>("readonly", (s) => s.getAll());
      return (v ?? []).reduce((n, b) => n + (b instanceof Blob ? b.size : 0), 0);
    },
  };
}

/* The default: this browser, offline, free, no accounts, and matching
 * the y-indexeddb story the doc already uses. Its one cost is that
 * collaborators do not see the stills unless they run the import
 * themselves -- which is exactly what Phase C's remote adapter fixes. */
export const localBlobs: BlobStore = idbStore(DB);

/* The board frame's WALL pictures (board/wallImage.ts): this browser's
 * own, never uploaded, never swept. */
export const wallBlobs: BlobStore = idbStore("corko-walls");

/* ------------------------------------------------------------------ *
 *  SHARED STILLS (Phase C): R2, through the Worker.
 *
 *  NOT a public bucket URL. The boards sit behind CORKO_PASSWORD, so a
 *  public still URL would leave the cut gated and the pictures open to
 *  anyone with a link. A `/still/<key>` route runs the same `authState`
 *  that `/auth` and `/sync` already drive, so the gate cannot drift.
 *  The BROWSER's HTTP cache holds the responses (a key is immutable, so
 *  they are cacheable for a year) -- and it is the only cache that does:
 *  `private` forbids shared caches on purpose, and Worker responses are
 *  not edge-cached by default anyway. Each viewer fetches each still
 *  once, then the local IndexedDB copy below answers for good.
 *
 *  READS GO THROUGH THE LOCAL STORE FIRST. Whoever ran the import
 *  already has every blob on disk, so their board paints without a
 *  single request; everyone else fetches once and the browser caches it
 *  for a year (a key is immutable -- it names one grabbed frame and is
 *  never rewritten). Writes go to BOTH, so the importer keeps working
 *  offline and the upload is what makes it shared.
 * ------------------------------------------------------------------ */
/* ---- UPLOADS THAT DID NOT LAND, remembered so they can be retried ----
 *
 * A PUT can fail for every ordinary reason -- offline, a stale key
 * answering 401, a 5xx -- and until 2026-09-01 the failure was swallowed
 * whole: the importer saw their pictures (local-first), everyone else saw
 * blank cards, and nothing anywhere said so. The key is kept in
 * localStorage (the blob is already in IndexedDB) and retried when the
 * store is chosen, when the browser comes back online, and before the
 * next import. `pendingUploads()` is what the Usage panel reads. */
const PENDING_KEY = scoped("corko-still-uploads"); // a retry must land in the project it was grabbed for
function readPending(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}
function writePending(keys: string[]) {
  try {
    if (keys.length) localStorage.setItem(PENDING_KEY, JSON.stringify(keys));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode: the list is best-effort */
  }
}
function markPending(k: string, on: boolean) {
  const cur = readPending();
  const has = cur.includes(k);
  if (on && !has) writePending([...cur, k]);
  if (!on && has) writePending(cur.filter((x) => x !== k));
}
export function pendingUploads(): string[] {
  return readPending();
}

/* `?k=<key>&p=<project>` -- the project half is empty for the default
 * project, so its URLs are the ones every existing object was stored
 * under (worker/access.ts). */
export const query = (k: string): string => {
  const parts = [k ? `k=${encodeURIComponent(k)}` : "", projectParam()].filter(Boolean);
  return parts.length ? `?${parts.join("&")}` : "";
};

export function remoteBlobs(key: () => string, base = ""): BlobStore & { retry(): Promise<number> } {
  const url = (k: string) => `${base}/still/${encodeURIComponent(k)}${query(key())}`;
  /* True when the bucket now holds it. 201 = stored, 204 = it already
   * was; anything else -- 401 on a stale key, 413, 501, a 5xx -- is a
   * failure the caller must not mistake for sharing. */
  const upload = async (k: string, blob: Blob): Promise<boolean> => {
    try {
      const r = await fetch(url(k), {
        method: "PUT",
        body: blob,
        headers: { "content-type": blob.type || "image/jpeg" },
      });
      return r.status === 201 || r.status === 204;
    } catch {
      return false;
    }
  };
  const store = {
    async put(k: string, blob: Blob) {
      /* Local first and always, so a failed or unconfigured upload still
       * leaves the person who grabbed it with their own pictures. */
      await localBlobs.put(k, blob);
      /* Sharing it is what can fail, and that is not worth losing the
       * import over -- but it IS worth remembering. */
      markPending(k, !(await upload(k, blob)));
    },
    /* Push every remembered failure again. Serial, and one at a time
     * because a bucket that is down is down for all of them. Returns how
     * many are STILL pending. */
    async retry(): Promise<number> {
      for (const k of readPending()) {
        const blob = await localBlobs.get(k);
        if (!blob) {
          markPending(k, false); // nothing left to send
          continue;
        }
        if (await upload(k, blob)) markPending(k, false);
      }
      return readPending().length;
    },
    async get(k: string) {
      const local = await localBlobs.get(k);
      if (local) return local;
      try {
        const r = await fetch(url(k));
        if (!r.ok) return null;
        /* ONLY AN IMAGE IS A STILL. A dev server's SPA fallback answers
         * 200 text/html to any path, and caching that would write
         * index.html into IndexedDB under a still key -- permanently,
         * since local answers first ever after. The boot probe's marker
         * header should keep this store from existing against such a
         * server at all; this is the belt to that braces. */
        if (!(r.headers.get("content-type") ?? "").startsWith("image/")) return null;
        const blob = await r.blob();
        /* Cache it locally too: the next board that shows this frame
         * costs nothing, and it survives going offline. */
        await localBlobs.put(k, blob);
        return blob;
      } catch {
        return null;
      }
    },
    async has(k: string) {
      if (await localBlobs.has(k)) return true;
      try {
        return (await fetch(url(k), { method: "HEAD" })).ok;
      } catch {
        return false;
      }
    },
    async remove(keys: string[]) {
      /* COUNT WHAT ACTUALLY WENT, on either side. A key can live in the
       * bucket and not in this browser (another client uploaded it, or
       * this one cleared its site data), so counting local deletions
       * alone reported "0 frames deleted" for a purge that had just
       * emptied the bucket. A key counts once however many places held
       * it; the Worker's DELETE answers 404 for a key that was not
       * there, which is what makes the remote half countable at all.
       * A failed or offline DELETE simply does not count -- left for
       * the next purge rather than retried here. */
      let n = 0;
      for (const k of keys) {
        let went = await localBlobs.remove([k]) > 0;
        try {
          const r = await fetch(url(k), { method: "DELETE" });
          if (r.status === 204) went = true;
        } catch {
          /* offline; the local half already counted if it held it */
        }
        if (went) n++;
      }
      return n;
    },
    /* Listing and sizing stay LOCAL on purpose: the purge asks the
     * bucket directly (board/stills.ts storedStills -> GET /stills),
     * because only the bucket can say what exists remotely -- these two
     * answer for this browser's own store, the fallback truth. */
    keys: () => localBlobs.keys(),
    size: () => localBlobs.size(),
  };
  return store;
}

/* The one the app uses. A single mutable binding rather than a prop
 * threaded through the render tree: which store is in play is a
 * deployment fact, not a per-card one. */
export let blobs: BlobStore = localBlobs;
export const setBlobStore = (s: BlobStore) => {
  blobs = s;
};

/* Which store the app settled on, for anyone who must not write before
 * that is known. An import that ran before the boot probe answered used
 * to write into the local store and never upload -- with no failure to
 * remember, because nothing had failed. Resolves "local" at once if the
 * probe was never started (tests, a build with no Worker). */
let chosen: Promise<"local" | "shared"> | null = null;
export function whenBlobStoreChosen(): Promise<"local" | "shared"> {
  return chosen ?? Promise.resolve("local");
}

/* Retry what this browser still owes the bucket. A no-op on the local
 * store. Wired to `online` so a laptop that shut mid-import catches up
 * on its own. */
export async function retryUploads(): Promise<number> {
  const s = blobs as BlobStore & { retry?: () => Promise<number> };
  return s.retry ? s.retry() : 0;
}
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void retryUploads());
}

/* ------------------------------------------------------------------ *
 *  WHICH STORE THIS DEPLOYMENT USES -- asked once, at boot.
 *
 *  A `/stills` probe answers three ways and each means something
 *  different: 200 WITH the Worker's marker header = a bucket is bound,
 *  go shared; 501 = the Worker is there and has no bucket, stay local;
 *  anything else (a network failure, an offline load) = also stay
 *  local. The MARKER is load-bearing, not a nicety: vite's SPA fallback
 *  answers 200 text/html to any path, HEAD included, so a bare 200
 *  check chose the shared store in every dev session -- found live
 *  2026-08-28 by the doomed PUT /still requests it produced.
 *
 *  LOCAL IS THE SAFE ANSWER TO EVERY FAILURE, which is the same
 *  reasoning `checkAccess` uses for being optimistic when /auth is
 *  unreachable: a deployment with no bucket, a dev server with no
 *  Worker, and a laptop on a train must all keep working, and the only
 *  thing they lose is that collaborators cannot see the pictures.
 *
 *  Fire-and-forget on purpose. Nothing waits for it: a still that
 *  resolves before this lands simply misses the shared store on its
 *  first read and finds it on the next, which is strictly better than
 *  holding up the boot for a picture. */
export function chooseBlobStore(key: () => string, base = ""): Promise<"local" | "shared"> {
  const probe = (async (): Promise<"local" | "shared"> => {
    try {
      const url = `${base}/stills${query(key())}`;
      const r = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (!r.ok || r.headers.get("x-corko-stills") !== "1") return "local";
      setBlobStore(remoteBlobs(key, base));
      /* The bucket is reachable now; whatever an earlier session failed
       * to upload can go. Not awaited -- it is housekeeping. */
      void retryUploads();
      return "shared";
    } catch {
      return "local";
    }
  })();
  chosen = probe;
  return probe;
}
