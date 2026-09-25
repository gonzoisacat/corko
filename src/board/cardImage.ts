/* ------------------------------------------------------------------ *
 *  PUTTING A PICTURE ON A CARD -- ANY card, on any board type.
 *
 *  It started in board/grid/ because the Free Grid is where photographs
 *  obviously belong, and moved out the moment the owner asked the right
 *  question: "we should be able to add images to cards wherever we are."
 *  Nothing about it was ever grid-specific -- `Node.image` is a field on
 *  the node like any other, so a beat card can wear one too.
 *
 *  The image rides in the Yjs doc as a data URI, so it syncs, persists
 *  and exports like everything else -- no image server, no second store
 *  to keep in step, and a board file that still works when you mail it
 *  to someone. That is the right trade for this app (self-deployable, no
 *  third-party services -- spec Sec 3 / Sec 12), and it comes with one
 *  hard obligation: the picture has to be SMALL.
 *
 *  How small, and why it is not a guess. The live project doc is about
 *  740 KB for 3,200 cards. The Durable Object that persists it stores
 *  1.5 MB chunks, and the whole doc is rewritten on every debounced
 *  save. A 4 MB phone photo would therefore cost more than the entire
 *  cut it was pinned to, on every save, forever -- Yjs is monotonic, so
 *  deleting it later does not give the space back.
 *
 *  So nothing here stores an original. Every picture is re-encoded to at
 *  most MAX_EDGE on its long side as JPEG, which for a corkboard
 *  thumbnail lands around 40-70 KB. A card is ~150-600 px on screen; a
 *  640 px thumbnail is already generous for it.
 * ------------------------------------------------------------------ */

import { ops } from "../state/useBoard";
import { getSnapshot } from "../state/ydoc";
import { DEFAULT_IMAGE_SIT, settingsFor, type ImageSit } from "../state/settings";
import type { Board, Node } from "../state/types";

export const MAX_EDGE = 640;
export const QUALITY = 0.72;
/* A refusal, not a clamp: something has gone wrong if a downscaled JPEG
 * lands here, and silently pinning a megabyte to a shared doc is worse
 * than saying no. */
export const MAX_BYTES = 400_000;

export interface ImageResult {
  ok: true;
  dataUri: string;
  bytes: number;
  w: number;
  h: number;
}
export interface ImageError {
  ok: false;
  reason: string;
}

/* Roughly what a data URI costs in the doc: base64 is 4 bytes per 3. */
export const dataUriBytes = (uri: string): number =>
  Math.round(((uri.length - (uri.indexOf(",") + 1)) * 3) / 4);

/* Downscale a picked file to a card-sized thumbnail. Returns a result
 * rather than throwing, because every caller wants to tell the person
 * what happened rather than crash a board. */
export async function toCardImage(file: File | Blob): Promise<ImageResult | ImageError> {
  if (!file.type.startsWith("image/")) return { ok: false, reason: "That is not an image." };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "That image could not be read." };
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "This browser could not resize the image." };
  /* A white ground: a transparent PNG re-encoded as JPEG would otherwise
   * composite onto black, which is the classic "why did my logo go
   * dark" surprise. */
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const dataUri = canvas.toDataURL("image/jpeg", QUALITY);
  const bytes = dataUriBytes(dataUri);
  if (bytes > MAX_BYTES) {
    return { ok: false, reason: "That image is too complex to store on a card." };
  }
  return { ok: true, dataUri, bytes, w, h };
}

/* The first image on a clipboard or a drop, if there is one. Both
 * gestures carry a DataTransfer and both should behave the same way, so
 * they read it through one function. */
export function imageFrom(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (const item of Array.from(dt.files)) if (item.type.startsWith("image/")) return item;
  for (const item of Array.from(dt.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/* Ask for a file and hand back a card-ready thumbnail.
 *
 * A hidden <input type="file"> rather than anything cleverer: it is the
 * only way to open the OS picker, it needs no permissions, and it is the
 * one path that works identically on every board type -- which is the
 * point, since the card menu is the universal route to a picture and
 * drop/paste are the grid's shortcuts on top of it.
 *
 * Resolves null if the person cancels. The input is removed either way;
 * a cancelled picker fires no event at all in some browsers, so the
 * element is parked out of the layout rather than relied on to clean
 * itself up on a callback that may never come.
 */
export function pickCardImage(): Promise<ImageResult | ImageError | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    let done = false;
    const finish = async (file: File | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(file ? await toCardImage(file) : null);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    /* `cancel` is not universal, so a stray input would otherwise sit in
     * the DOM forever. Harmless, but it is one line to not leak it. */
    input.addEventListener("cancel", () => finish(null));
    input.click();
  });
}

/* ------------------------------------------------------------------ *
 *  WHERE A PICTURE CAN GO -- one definition, guarded on by the menu that
 *  OFFERS an image and by every renderer that DRAWS one.
 *
 *  It exists because the two disagreed, silently, in the worst possible
 *  direction: the card menu offered "Add picture..." on every node in
 *  the app while only Card and GridCard read `node.image`. So putting a
 *  photo on a scene label, a header tier or a Columns column head wrote
 *  a ~50 KB data URI into the SHARED doc, synced it to everyone, cost
 *  that space forever (Yjs is monotonic, so removing it later does not
 *  give it back) -- and painted nothing. The only evidence was the menu
 *  afterwards reading "Replace picture..." over a card showing none.
 *
 *  IT ADMITS EVERY SHAPE TODAY, INCLUDING BANDS (owner, 2026-08-27: "lets
 *  keep the images. including on bands. I won't use it much, but it
 *  should be workable if people want to use them"). That is not a
 *  reversal of the rule it shipped with -- it is the removal of a reason
 *  that had already gone.
 *
 *  The original line was the card's SHAPE ("card shapes only, hide on
 *  bands", 2026-08-26), and the argument was that a picture fills its
 *  card and turns the title into a CAPTION over the bottom of it, which
 *  needs a known aspect to be a design rather than an accident -- while a
 *  full-width band spans the pane and can be 20:1 at one width and 6:1 at
 *  another. Sound at the time. But the caption was CUT 104 minutes later
 *  the same day ("A picture no longer moves the title"): a title now sits
 *  centered where it always sits, in white with a drop shadow, over the
 *  photo. That treatment has no opinion about aspect at all, so the one
 *  thing a band could not supply stopped being needed and the exclusion
 *  outlived its own justification by a day.
 *
 *  SO WHY KEEP A PREDICATE THAT ALWAYS SAYS YES? Because the drift it
 *  prevents was real and expensive, and it is the SEAM: the menu and five
 *  renderers ask this one question, so a shape that genuinely cannot draw
 *  an image later has exactly one place to say so. Deleting it would put
 *  the next exclusion back where the first one was -- in six files that
 *  can disagree.
 * ------------------------------------------------------------------ */
export function canShowImage(_board: Board | null, _node: Node, _depth: number): boolean {
  return true;
}

/* ------------------------------------------------------------------ *
 *  WHICH PART OF A CROPPED IMAGE SURVIVES.
 *
 *  In Fill the card shows a crop, and by default it is the middle -- fine
 *  for a landscape, wrong for a face near an edge or a title at the top.
 *  These are the nine `object-position` values a 3x3 picker offers, and
 *  the absence of one means the center, so nothing needed migrating.
 * ------------------------------------------------------------------ */
/* DOES THIS CARD SHOW A PICTURE AT ALL -- from either source.
 *
 * `image` is a data URI pinned by hand; `still` is a key into the
 * BlobStore, grabbed from a proxy. The `has-image` class drives the
 * title's white-on-shadow treatment, so it has to mean "there is a
 * picture behind the words", not "there is a data URI on the node" --
 * five hosts asked the narrower question and would have left a grabbed
 * still with dark type on it. One helper so the sixth cannot get it
 * wrong either. */
export const hasPicture = (n: { image?: string; still?: string }): boolean =>
  !!(n.image || n.still);

export const ALIGNS = [
  "left top", "center top", "right top",
  "left center", "center center", "right center",
  "left bottom", "center bottom", "right bottom",
] as const;

export const DEFAULT_ALIGN = "center center";

export const alignOf = (n: { imageAlign?: string }): string =>
  (ALIGNS as readonly string[]).includes(n.imageAlign ?? "")
    ? (n.imageAlign as string)
    : DEFAULT_ALIGN;

/* A node's sit as one value, normalized (absent fields are the fill
 * defaults), so the Image panel can compare it with the remembered
 * default and gray "Set as default" when they match. */
export function sitOf(n: {
  imageFit?: string;
  imageTile?: boolean;
  imageMirror?: boolean;
  imageAlign?: string;
  imageCorner?: string;
  titleAlign?: string;
}): ImageSit {
  return {
    fit: n.imageFit === "fit" || n.imageFit === "side" ? n.imageFit : "fill",
    tile: !!n.imageTile,
    mirror: !!n.imageMirror,
    align: n.imageAlign || "center center",
    corner: n.imageCorner === "tl" || n.imageCorner === "tr" || n.imageCorner === "bl" ? n.imageCorner : "br",
    titleAlign: n.titleAlign === "top" || n.titleAlign === "bottom" ? n.titleAlign : "",
  };
}

/* Stamp the remembered default sit on a picture that just arrived, from
 * any door -- picked, dropped, grabbed (owner, 2026-09-08). */
/* WHICH TIER A CARD BELONGS TO, as the key the remembered sit is stored
 * under (settings.imageSits). Derived from the card rather than passed
 * in, so the six places that add a picture -- the panel, the player's
 * capture, a Finder drop on a pane or on the grid -- did not each have
 * to learn about tiers.
 *
 * The tier's own id, so "my scene cards look like this" travels between
 * boards built from the same ladder; the depth is the fallback for a
 * ladder whose rungs carry no id. */
export function tierKeyOf(nodeId: string): string {
  const snap = getSnapshot();
  for (const b of snap.boards) {
    let found = "";
    const walk = (n: Node, d: number) => {
      if (found) return;
      if (n.id === nodeId) {
        found = b.levels[d]?.id || `d${d}`;
        return;
      }
      for (const kid of n.children ?? []) walk(kid, d + 1);
    };
    for (const r of b.roots) walk(r, 0);
    if (found) return found;
  }
  return "";
}

/** The sit this tier remembers for a new picture, or the app's own. */
export function sitForTier(tierKey: string): ImageSit {
  return settingsFor("").imageSits[tierKey] ?? DEFAULT_IMAGE_SIT;
}

export function sitNewPicture(nodeId: string) {
  ops.setNodeImageSit([nodeId], sitForTier(tierKeyOf(nodeId)));
}

/* Whether the card with this id already wears a picture, by id alone --
 * for the doors that hold a target id rather than the node (a drop). A
 * walk of the snapshot; drops are rare. */
export function pictureOn(nodeId: string): boolean {
  const walk = (nodes: Node[]): boolean =>
    nodes.some((n) => (n.id === nodeId ? hasPicture(n) : walk(n.children)));
  return getSnapshot().boards.some((b) => walk(b.roots));
}

/* EVERY CARD AT ONE TIER, for "apply image settings to every card in
 * this tier" (owner, 2026-09-09 -- his words, and EVERY is the operative
 * one: this used to reach only the pictured cards, and the button's own
 * count now says "61 total scenes", which has to be true of the whole
 * rung).
 *
 * Pure. SAME BOARD, same DEPTH: a tier is a rung on one board's ladder,
 * and another board's Scene tier is a different tier however it is
 * named. The card you are standing on is INCLUDED -- applying its own
 * look to itself is a no-op, and leaving it out would make the count
 * lie by one. */
export function tierCardIds(roots: Node[], depth: number): string[] {
  const out: string[] = [];
  const walk = (n: Node, d: number) => {
    if (d === depth) {
      out.push(n.id);
      return; // a tier is one rung: nothing below it is at this depth
    }
    for (const kid of n.children ?? []) walk(kid, d + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}
