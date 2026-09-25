import { useEffect, useState } from "react";
import { wallBlobs } from "../state/blobStore";

/* ------------------------------------------------------------------ *
 *  THE WALL BEHIND A FRAMED BOARD, as a picture of the user's own
 *  (board/frame.ts says what the frame is). Per browser: the picture
 *  lives in its own IndexedDB store (state/blobStore.ts wallBlobs) and
 *  the settings hold only its key, so nothing large goes near the doc
 *  or localStorage, and the stills purge cannot sweep it.
 *
 *  Downscaled on the way in: a wall is seen at fit, never 1:1, and a
 *  phone photo is 12 MB. 2048 on the long edge as JPEG keeps a retina
 *  pane crisp at a few hundred KB.
 * ------------------------------------------------------------------ */

export const WALL_MAX_EDGE = 2048;
const WALL_QUALITY = 0.85;

/* Read a File, shrink it, store it, and hand back the key. Null when the
 * file is not an image the browser can decode. */
export async function storeWallImage(boardId: string, file: File | Blob): Promise<string | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return null;
  }
  const k = Math.min(1, WALL_MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", WALL_QUALITY));
  if (!blob) return null;
  const key = `wall-${boardId}-${Date.now().toString(36)}`;
  await wallBlobs.put(key, blob);
  return key;
}

export function removeWallImage(key: string): Promise<number> {
  return key ? wallBlobs.remove([key]) : Promise.resolve(0);
}

/* The picture as an object URL for CSS, revoked when the key changes or
 * the view goes. "" while loading or when there is none. */
export function useWallImage(key: string): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!key) {
      setUrl("");
      return;
    }
    let live = true;
    let made = "";
    void wallBlobs.get(key).then((blob) => {
      if (!live || !blob) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl("");
    };
  }, [key]);
  return url;
}

/* The file picker, the same shape cardImage.ts uses. */
export function pickWallImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
