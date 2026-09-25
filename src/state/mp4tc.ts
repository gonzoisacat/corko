import { RATES, rateFor, type Rate } from "./timecode";

/* ------------------------------------------------------------------ *
 *  WHAT THE FILE SAYS ABOUT ITSELF: the start timecode and the frame
 *  rate, read out of an MP4 / QuickTime container (owner, 2026-09-06:
 *  "i would want the file's embedded timecode to be the 'timecode'
 *  figure"). The browser's <video> element exposes neither, so this
 *  reads the boxes itself.
 *
 *  TWO THINGS ARE READ:
 *    - the TIMECODE TRACK ("tmcd" handler, QuickTime's), whose sample
 *      description carries the rate and the drop-frame flag and whose
 *      one sample -- four bytes in the mdat, found through the track's
 *      chunk offsets -- is the start as a frame count. Premiere, Avid
 *      and Resolve all write one into a .mov and (usually) an .mp4.
 *    - the VIDEO TRACK's timing (mdhd timescale over the first stts
 *      delta), for the rate when there is no timecode track.
 *
 *  READ BY SLICES, never the whole file: a proxy is gigabytes and the
 *  `moov` is kilobytes. The top-level boxes are walked by their size
 *  fields until `moov` turns up (it can sit at either end), and only
 *  that box is pulled into memory. A WebM, or anything that is not an
 *  ISO box file, yields nothing -- which the caller reads as "no
 *  embedded timecode", not as an error.
 *
 *  Pure over a `Reader`, so the test feeds it a container built in
 *  memory and the panel feeds it a File.
 * ------------------------------------------------------------------ */

export interface Reader {
  size: number;
  read(offset: number, length: number): Promise<DataView>;
}

export interface EmbeddedTC {
  /* the start, as a frame count at `rate`; absent when the file has no
   * timecode track */
  startFrames?: number;
  rate?: Rate;
  drop?: boolean;
}

export function fileReader(file: File): Reader {
  return {
    size: file.size,
    async read(offset, length) {
      const buf = await file.slice(offset, offset + length).arrayBuffer();
      return new DataView(buf);
    },
  };
}

export function bufferReader(buf: ArrayBuffer): Reader {
  return {
    size: buf.byteLength,
    async read(offset, length) {
      return new DataView(buf.slice(offset, Math.min(buf.byteLength, offset + length)));
    },
  };
}

const MOOV_CAP = 64 * 1024 * 1024; // a moov past this is not a moov
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

interface Box {
  type: string;
  start: number; // offset of the box header
  body: number; // offset of the payload
  end: number;
}

function type4(dv: DataView, at: number): string {
  return String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
}

/* The boxes directly inside [start, end) of a DataView. */
function children(dv: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = dv.getUint32(at);
    const type = type4(dv, at + 4);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = Number(dv.getBigUint64(at + 8));
      body = at + 16;
    } else if (size === 0) size = end - at;
    if (size < 8 || at + size > end) break;
    out.push({ type, start: at, body, end: at + size });
    at += size;
  }
  return out;
}

/* Every box of `type` at any depth under `parent`, walking only the
 * containers that can hold tracks. */
function find(dv: DataView, parent: Box, type: string): Box[] {
  const out: Box[] = [];
  for (const b of children(dv, parent.body, parent.end)) {
    if (b.type === type) out.push(b);
    if (CONTAINERS.has(b.type)) out.push(...find(dv, b, type));
  }
  return out;
}

function first(dv: DataView, parent: Box, type: string): Box | null {
  return find(dv, parent, type)[0] ?? null;
}

/* The handler type of a track ("vide", "soun", "tmcd", ...). */
function handlerOf(dv: DataView, trak: Box): string | null {
  const hdlr = first(dv, trak, "hdlr");
  if (!hdlr || hdlr.body + 12 > hdlr.end) return null;
  return type4(dv, hdlr.body + 8); // version/flags 4, pre_defined 4, handler 4
}

/* mdhd timescale: version 0 has 32-bit times, version 1 64-bit. */
function timescaleOf(dv: DataView, trak: Box): number | null {
  const mdhd = first(dv, trak, "mdhd");
  if (!mdhd) return null;
  const version = dv.getUint8(mdhd.body);
  const at = mdhd.body + (version === 1 ? 4 + 8 + 8 : 4 + 4 + 4);
  return at + 4 <= mdhd.end ? dv.getUint32(at) : null;
}

/* The first stts entry's delta -- the duration of the first sample. */
function firstDeltaOf(dv: DataView, trak: Box): number | null {
  const stts = first(dv, trak, "stts");
  if (!stts || stts.body + 16 > stts.end) return null;
  const count = dv.getUint32(stts.body + 4);
  if (!count) return null;
  return dv.getUint32(stts.body + 12);
}

/* The absolute file offset of the track's first chunk (stco or co64). */
function firstChunkOffset(dv: DataView, trak: Box): number | null {
  const stco = first(dv, trak, "stco");
  if (stco && stco.body + 12 <= stco.end && dv.getUint32(stco.body + 4) > 0) return dv.getUint32(stco.body + 8);
  const co64 = first(dv, trak, "co64");
  if (co64 && co64.body + 16 <= co64.end && dv.getUint32(co64.body + 4) > 0) {
    return Number(dv.getBigUint64(co64.body + 8));
  }
  return null;
}

/* The nearest of the rates a cut can be in, by real frames per second. */
function nearestRate(fps: number, drop: boolean): Rate | null {
  if (!Number.isFinite(fps) || fps <= 0) return null;
  let best: Rate | null = null;
  let bestErr = Infinity;
  for (const r of RATES) {
    if (r.drop !== drop) continue;
    const err = Math.abs(r.exact - fps);
    if (err < bestErr) {
      best = r;
      bestErr = err;
    }
  }
  /* a rate more than 1% off every known one is not one of them */
  return best && bestErr / best.exact < 0.01 ? best : null;
}

/* Find and load the moov box. */
async function loadMoov(r: Reader): Promise<{ dv: DataView; moov: Box } | null> {
  let at = 0;
  while (at + 16 <= r.size) {
    const head = await r.read(at, 16);
    if (head.byteLength < 8) return null;
    let size = head.getUint32(0);
    const type = type4(head, 4);
    if (size === 1) size = Number(head.getBigUint64(8));
    else if (size === 0) size = r.size - at;
    if (size < 8) return null;
    if (type === "moov") {
      if (size > MOOV_CAP) return null;
      const dv = await r.read(at, size);
      return { dv, moov: { type, start: 0, body: 8, end: dv.byteLength } };
    }
    at += size;
  }
  return null;
}

/* The embedded timecode and rate, or {} when the file carries neither.
 * Never throws on a foreign file: anything unparseable is "nothing". */
export async function readEmbeddedTC(r: Reader): Promise<EmbeddedTC> {
  try {
    const loaded = await loadMoov(r);
    if (!loaded) return {};
    const { dv, moov } = loaded;
    const out: EmbeddedTC = {};
    const traks = find(dv, moov, "trak");

    /* the timecode track: rate + drop from its sample description, the
       start from its one sample out in the file */
    for (const trak of traks) {
      if (handlerOf(dv, trak) !== "tmcd") continue;
      const stsd = first(dv, trak, "stsd");
      if (!stsd) continue;
      const entries = children(dv, stsd.body + 8, stsd.end);
      const tmcd = entries.find((e) => e.type === "tmcd");
      if (!tmcd) continue;
      /* sample description header: reserved 6 + data ref index 2, then
         tmcd: reserved 4, flags 4, timescale 4, frame duration 4,
         number of frames 1 */
      const at = tmcd.body + 8;
      if (at + 17 > tmcd.end) continue;
      const flags = dv.getUint32(at + 4);
      const timescale = dv.getUint32(at + 8);
      const frameDuration = dv.getUint32(at + 12);
      const numberOfFrames = dv.getUint8(at + 16);
      const drop = (flags & 1) === 1;
      const rate = rateFor(numberOfFrames, drop);
      const fps = frameDuration ? timescale / frameDuration : 0;
      out.rate = nearestRate(fps, drop) ?? rate;
      out.drop = drop;
      const off = firstChunkOffset(dv, trak);
      if (off !== null && off + 4 <= r.size) {
        const sample = await r.read(off, 4);
        if (sample.byteLength >= 4) out.startFrames = sample.getInt32(0);
      }
      break;
    }

    /* the video track's timing, for the rate when the timecode track
       said nothing */
    if (!out.rate) {
      for (const trak of traks) {
        if (handlerOf(dv, trak) !== "vide") continue;
        const ts = timescaleOf(dv, trak);
        const delta = firstDeltaOf(dv, trak);
        if (ts && delta) out.rate = nearestRate(ts / delta, false) ?? undefined;
        break;
      }
    }
    return out;
  } catch {
    return {};
  }
}
