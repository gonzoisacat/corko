import { useSyncExternalStore } from "react";
import { blobs, query } from "../state/blobStore";
import { uid } from "../state/ids";
import type { GrabPlan } from "../state/shotGrab";
import type { StoredStill } from "../state/stillPurge";

/* ------------------------------------------------------------------ *
 *  PULLING FRAMES OUT OF A PROXY, in the browser and nowhere else.
 *
 *  `<video>` + `<canvas>`: set currentTime, await `seeked`, draw,
 *  encode. No server, no upload, no ffmpeg, which is what keeps the
 *  self-deployable offline-first premise intact (spec Sec 3 / Sec 12).
 *
 *  THE CONSTRAINT THIS RESTS ON: the proxy must be H.264. Browsers
 *  decode H.264/AVC, VP9 and AV1; they do not decode ProRes, DNxHD/HR or
 *  MXF at all -- not slowly, at all. `canGrabFrom` is where that becomes
 *  a message rather than a hang.
 *
 *  AND THE SETTING NOBODY THINKS OF: a seek decodes forward from the
 *  previous keyframe, so a 5-second GOP makes every grab chew through up
 *  to 150 frames. A 1-second GOP is the difference between a 500-shot
 *  import taking under a minute and taking several. That is an export
 *  setting rather than something this code can fix, which is why the
 *  plan spells it out.
 *
 *  ffmpeg.wasm was weighed and rejected: ~25 MB of payload to solve
 *  codecs you can sidestep by asking for a proxy. WebCodecs is the known
 *  upgrade if this turns out slow -- a native API plus a ~100 KB
 *  demuxer, frame-accurate, and it would slot in behind this same
 *  function.
 * ------------------------------------------------------------------ */

/* Long edge of a stored still. Smaller than a pinned photo's 640: these
 * arrive in the hundreds, and what costs at that scale is DECODE (a
 * decoded bitmap is w*h*4 regardless of file size), not disk. 480 is
 * still generous for a card that paints at ~150-600 px. */
export const STILL_EDGE = 480;
export const STILL_QUALITY = 0.72;

export interface GrabResult {
  index: number; // back into the parse's events
  key: string; // the BlobStore key, minted here
  blob: Blob;
}

/* Load a video file and say whether this browser can actually decode it.
 * Resolves the element on success so the caller can go straight on to
 * seeking it; rejects with something worth showing a person. */
export function loadProxy(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    /* IN the document, parked off-screen -- rVFC's reliability notes in
     * framePresented depend on knowing exactly this arrangement. Being
     * attached is what lets it decode; being off-screen keeps it out of
     * the layout. */
    v.style.position = "fixed";
    v.style.left = "-9999px";
    let settled = false;
    const fail = (msg?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      /* Take the element with us -- releaseProxy is the caller's job on
       * SUCCESS; on failure there is no element handed over to release,
       * so leaving it appended leaked one per failed pick. */
      v.remove();
      URL.revokeObjectURL(url);
      reject(
        new Error(
          msg ??
            "That video could not be read. It needs to be H.264 in an .mp4 -- " +
              "browsers cannot decode ProRes, DNxHD or MXF at all.",
        ),
      );
    };
    /* A file whose metadata never arrives would otherwise hang the
     * dialog on "Opening video..." with no way to tell it is stuck.
     * Generous: metadata for a local file is normally milliseconds. */
    const timer = setTimeout(
      () => fail("That video took too long to open. It needs to be H.264 in an .mp4."),
      15000,
    );
    v.onerror = () => fail();
    v.onloadedmetadata = () => {
      /* A file can load its metadata and still have no picture -- an
       * audio-only export, or a codec the container knows about and the
       * decoder does not. */
      if (!v.videoWidth || !v.videoHeight) return fail();
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    v.src = url;
    document.body.appendChild(v);
  });
}

export function releaseProxy(v: HTMLVideoElement | null) {
  if (!v) return;
  const src = v.src;
  v.removeAttribute("src");
  v.load();
  v.remove();
  if (src.startsWith("blob:")) URL.revokeObjectURL(src);
}

/* Wait until a frame for the CURRENT position has actually been
 * presented -- which is not the same thing as `seeked` firing.
 *
 * THIS IS THE BUG THAT PUT THE WRONG PICTURE ON A CARD. `seeked` means
 * the seek completed, not that the decoder has produced the frame for
 * compositing, so a `drawImage` straight after it can capture the
 * PREVIOUS position. It shows up on the first grab of any run that seeks
 * BACKWARDS -- caught live re-grabbing a contact sheet after a nudge:
 * eleven frames moved correctly and shot 1 came back holding the last
 * frame of the previous run, 11.2s into a 12s file.
 *
 * `requestVideoFrameCallback` is the answer and exists for exactly this;
 * it fires once for a paused element when the new frame is presented.
 * The rAF pair is the fallback where it is missing, and the timeout is
 * there because neither is guaranteed to fire for a frame the decoder
 * decides is identical to the last -- a hang would be worse than an
 * occasional early draw. */
interface RVFC {
  requestVideoFrameCallback?: (cb: () => void) => number;
}
function framePresented(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    /* ALL THREE ARE REGISTERED, AND THE FIRST ONE WINS. That is the fix
     * for a slow grab the owner reported (2026-08-28: "the reading
     * frames refresh seems to be taking longer"), and the cause was mine:
     * the rAF pair was written as an `else` to rVFC, so whenever rVFC
     * was AVAILABLE it was the only signal registered.
     *
     * And rVFC is available but NOT RELIABLE for this element. Measured
     * over five seeks on an off-screen `<video>`: rVFC won twice at
     * ~8ms, the rAF pair won three times at 16-24ms, and the timeout
     * never fired. So roughly half the seeks had no signal at all and
     * sat out the whole timeout -- which I had just raised from 200ms to
     * 1500ms, making it seven times worse. An element parked at
     * `left: -9999px` is not reliably composited, and rVFC is tied to a
     * frame being PRESENTED.
     *
     * Racing them costs nothing (whichever is ready first resolves) and
     * the timeout goes back to being a genuine last resort. 400ms rather
     * than 200: it now fires so rarely that a little slack is free, and
     * firing early is exactly the stale frame this exists to prevent. */
    const rvfc = (v as HTMLVideoElement & RVFC).requestVideoFrameCallback;
    if (typeof rvfc === "function") rvfc.call(v, done);
    requestAnimationFrame(() => requestAnimationFrame(done));
    setTimeout(done, 400);
  });
}

/* Seek, and say whether it completed. `seeked` has no guarantee of ever
 * firing on a broken region of a file, and an un-timed await here was
 * the one place a stalled decode could hang an entire import with
 * nothing on screen saying so. On timeout this resolves FALSE rather
 * than shooting whatever frame is current -- a missing still is honest,
 * a wrong picture is the exact thing framePresented exists to prevent.
 * 10s is far past any real seek (measured ~16ms on HD with a sane GOP);
 * it only ever fires on a file that is genuinely broken there. */
const SEEK_TIMEOUT_MS = 10000;
function seek(v: HTMLVideoElement, seconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    /* Past the end is not an error -- an EDL can outrun its own export by
     * a frame or two at the tail. Clamp and take the last frame. */
    const t = Math.min(Math.max(0, seconds), Math.max(0, (v.duration || 0) - 0.05));
    if (Math.abs(v.currentTime - t) < 0.001) {
      framePresented(v).then(() => resolve(true));
      return;
    }
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeEventListener("seeked", onSeeked);
      if (ok) framePresented(v).then(() => resolve(true));
      else resolve(false);
    };
    const onSeeked = () => done(true);
    const timer = setTimeout(() => done(false), SEEK_TIMEOUT_MS);
    v.addEventListener("seeked", onSeeked);
    v.currentTime = t;
  });
}

/* Grab one frame at the current position, downscaled. */
function shoot(v: HTMLVideoElement): Promise<Blob | null> {
  const scale = Math.min(1, STILL_EDGE / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.max(1, Math.round(v.videoWidth * scale));
  const h = Math.max(1, Math.round(v.videoHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(v, 0, 0, w, h);
  return new Promise((resolve) => c.toBlob(resolve, "image/jpeg", STILL_QUALITY));
}

/* ONE FRAME, NOW: what the player's capture button does (2026-09-06).
 * Waits for the presented frame first, for framePresented's reason --
 * the picture on screen and the picture the decoder has composited are
 * not always the same one. Works on a playing element too: drawImage
 * takes whatever frame is current, which is the one you saw. */
export async function captureFrame(v: HTMLVideoElement): Promise<Blob | null> {
  if (!v.videoWidth) return null;
  await framePresented(v);
  return shoot(v);
}

export interface GrabRun {
  /* Called after each frame, so the dialog can show progress on a job
   * that runs to minutes on a real cut. */
  onProgress?: (done: number, total: number) => void;
  /* Checked between frames. A long grab must be abandonable -- and
   * abandoning has to leave nothing behind, which is why the caller only
   * writes to the store after the whole run returns. */
  cancelled?: () => boolean;
}

/* Seek and shoot, one at a time and IN ORDER.
 *
 * Serial rather than parallel because there is one decoder: firing a
 * dozen seeks at a single `<video>` just makes the last one win. In
 * order because seeking forward through a file is what a decoder is
 * built for -- a shuffled seek order on a long GOP is many times slower
 * for exactly the same frames.
 *
 * Nothing is written to the BlobStore here. The caller decides, so a
 * cancelled or abandoned run leaves no orphans to purge.
 */
export async function grabStills(
  v: HTMLVideoElement,
  plans: GrabPlan[],
  run: GrabRun = {},
): Promise<GrabResult[]> {
  const out: GrabResult[] = [];
  const ordered = [...plans].sort((a, b) => a.seconds - b.seconds);
  let done = 0;
  for (const p of ordered) {
    if (run.cancelled?.()) break;
    const sought = await seek(v, p.seconds);
    done++;
    /* A timed-out seek SKIPS the shot rather than shooting whatever is
     * current: a card with no picture is legible, a card with the wrong
     * picture is a lie. The rest of the run continues -- one broken
     * region must not cost the other 499 frames. */
    if (!sought) {
      run.onProgress?.(done, ordered.length);
      continue;
    }
    const blob = await shoot(v);
    run.onProgress?.(done, ordered.length);
    if (blob) out.push({ index: p.index, key: uid("st"), blob });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  READING A STILL BACK, for the card that wears it.
 *
 *  A module store rather than a hook-with-its-own-effect per card: the
 *  Overview is not virtualized, so a card renders in the thousands and
 *  the object URL for one key must be made ONCE and shared. This is the
 *  same reason `tags` and `noteDots` are threaded rather than
 *  subscribed, arriving at a store instead because a still is fetched
 *  asynchronously and cannot be threaded from a snapshot.
 *
 *  Object URLs are never revoked. That is deliberate: a card can mount
 *  and unmount constantly under virtualization, and revoking on unmount
 *  would break every other card showing the same still. The cost is
 *  bounded by the number of DISTINCT stills a session looks at, which is
 *  the board's size, not the render count.
 * ------------------------------------------------------------------ */
const urls = new Map<string, string | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/* A MISS IS RE-ASKED, not remembered for the session. A still can be
 * absent from every store this browser can see for reasons that fix
 * themselves -- the boot probe has not chosen the shared store yet, a
 * colleague's upload is still in flight, a retried upload just landed --
 * and caching `null` for good meant a card that rendered a moment too
 * early stayed blank until a reload, which read exactly like the frame
 * had been purged. One fresh look per key per half-minute is bounded by
 * the number of distinct missing stills, not by renders. */
const MISS_RETRY_MS = 30_000;

function request(key: string) {
  if (urls.has(key) || pending.has(key)) return;
  pending.add(key);
  blobs
    .get(key)
    .then((b) => {
      urls.set(key, b ? URL.createObjectURL(b) : null);
      if (!b) {
        setTimeout(() => {
          if (urls.get(key) === null) {
            urls.delete(key);
            emit();
          }
        }, MISS_RETRY_MS);
      }
    })
    .catch(() => urls.set(key, null))
    .finally(() => {
      pending.delete(key);
      emit();
    });
}

/* The URL for a still, or null while it loads AND when it is genuinely
 * missing -- the two are deliberately the same to a caller. A still
 * whose blob is not in THIS browser is the normal state for a
 * collaborator until Phase C, so it must render as "no picture" rather
 * than as an error. */
export function useStillUrl(key: string | undefined): string | null {
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (key ? (urls.get(key) ?? null) : null),
    () => null,
  );
  if (key) request(key);
  return snap;
}

/* Forget a cached URL, so the next read goes back to the store.
 *
 * REVOKING IS RIGHT HERE and nowhere else. The cache deliberately never
 * revokes on unmount (see the header: a card remounts constantly under
 * virtualization, and revoking then would blank every other card showing
 * the same still). Both callers of THIS function are different: the blob
 * behind the key is either gone for good or about to be replaced, so the
 * URL is holding a dead blob in memory and must not be handed out again. */
export function forgetStill(key: string) {
  const url = urls.get(key);
  if (url) URL.revokeObjectURL(url);
  urls.delete(key);
  emit();
}

/* ------------------------------------------------------------------ *
 *  RECLAIM SPACE -- the button, and only ever a button.
 *
 *  The arithmetic is `state/stillPurge.ts`; this is the part that talks
 *  to the two stores and asks. It is deliberately a deliberate action:
 *  a peer whose project has not finished syncing is indistinguishable
 *  from a board that does not exist, so anything automatic would
 *  eventually delete live frames and be locally correct to do it.
 * ------------------------------------------------------------------ */

/* What the store holds. The shared bucket is the authority when there is
 * one -- it knows about frames this browser never grabbed -- and the
 * local store answers for a purely local deployment. */
export async function storedStills(key: string): Promise<StoredStill[] | null> {
  try {
    const r = await fetch(`/stills${query(key)}`, {
      cache: "no-store",
    });
    /* JSON or it is not the Worker: a dev server's SPA fallback answers
     * 200 text/html here, and json() throwing into the catch was the
     * only thing keeping the purge honest in dev. Said out loud now. */
    if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) {
      return (await r.json()) as StoredStill[];
    }
    /* 501 = no bucket bound. Fall through to the local store, which is
     * then the whole truth. */
  } catch {
    /* offline, or no Worker (dev) */
  }
  const keys = await blobs.keys();
  const sizes = await Promise.all(
    keys.map(async (k) => ({ key: k, size: (await blobs.get(k))?.size ?? 0 })),
  );
  return sizes;
}

/* Delete what nothing points at, after the caller has confirmed. Returns
 * how many actually went, so the report is what HAPPENED rather than
 * what was attempted.
 *
 * AND FORGETS THE CACHED URLS, which is not housekeeping -- it is the
 * difference between the screen telling the truth and lying about the
 * one deletion undo cannot reverse (owner-reported 2026-08-30, on live,
 * within minutes of the reclaim shipping).
 *
 * An object URL keeps its own blob alive, so deleting the bytes from
 * IndexedDB and R2 left every purged frame still painting from memory.
 * He deleted a board, reclaimed its frames, pressed Cmd-Z -- and the
 * card came back WITH its picture. It was gone after a reload, so the
 * purge had worked perfectly and the display was the liar. That is the
 * worst possible direction for this particular illusion: it makes a
 * permanent, shared deletion look like something undo just took care
 * of, at exactly the moment someone is deciding whether it is safe.
 *
 * Forget everything we ASKED to delete rather than only what `remove`
 * counted -- a key it did not delete simply gets re-read from the store
 * and re-cached, which is cheap and self-correcting, whereas a key left
 * cached after a successful delete is the bug itself. */
export async function purgeStills(orphans: StoredStill[]): Promise<number> {
  if (!orphans.length) return 0;
  const keys = orphans.map((o) => o.key);
  const n = await blobs.remove(keys);
  keys.forEach(forgetStill);
  return n;
}
