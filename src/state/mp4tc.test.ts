import { describe, expect, it } from "vitest";
import { bufferReader, readEmbeddedTC } from "./mp4tc";
import { formatTC, parseTC, RATES } from "./timecode";

/* ------------------------------------------------------------------ *
 *  A container built by hand, box by box, so the reader is pinned
 *  against the QuickTime layout rather than against whatever some
 *  export happened to write. The shapes follow the QuickTime File
 *  Format: a moov holding a video trak (mdhd timescale + stts) and a
 *  timecode trak (hdlr tmcd, stsd tmcd with rate and flags, stco to
 *  the four-byte sample in the mdat).
 * ------------------------------------------------------------------ */

const enc = new TextEncoder();
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const str4 = (s: string) => [...enc.encode(s.padEnd(4).slice(0, 4))];

function box(type: string, ...parts: number[][]): number[] {
  const body = parts.flat();
  return [...u32(8 + body.length), ...str4(type), ...body];
}

function hdlr(handler: string): number[] {
  return box("hdlr", u32(0), u32(0), str4(handler), u32(0), u32(0), u32(0), [0]);
}

function mdhd(timescale: number): number[] {
  // version 0: flags, ctime, mtime, timescale, duration, language, quality
  return box("mdhd", u32(0), u32(0), u32(0), u32(timescale), u32(0), u16(0), u16(0));
}

function stts(delta: number): number[] {
  return box("stts", u32(0), u32(1), u32(1), u32(delta));
}

function stco(offset: number): number[] {
  return box("stco", u32(0), u32(1), u32(offset));
}

/* the tmcd sample description: header (reserved 6, data ref 2) then
   reserved 4, flags 4, timescale 4, frame duration 4, frames 1, pad 1 */
function stsdTmcd(flags: number, timescale: number, frameDuration: number, frames: number): number[] {
  const entry = box("tmcd", [0, 0, 0, 0, 0, 0], u16(1), u32(0), u32(flags), u32(timescale), u32(frameDuration), [frames, 0]);
  return box("stsd", u32(0), u32(1), entry);
}

function videoTrak(timescale: number, delta: number): number[] {
  return box("trak", box("mdia", mdhd(timescale), hdlr("vide"), box("minf", box("stbl", stts(delta)))));
}

function tmcdTrak(flags: number, timescale: number, frameDuration: number, frames: number, sampleAt: number): number[] {
  return box(
    "trak",
    box("mdia", mdhd(timescale), hdlr("tmcd"), box("minf", box("stbl", stsdTmcd(flags, timescale, frameDuration, frames), stco(sampleAt)))),
  );
}

/* ftyp, then moov, then an mdat holding the timecode sample at a known
 * offset -- the stco must point at the absolute file offset, so the
 * mdat's position is computed from the sizes before it. */
function container(opts: { tc?: { frames: number; flags: number; timescale: number; frameDuration: number; fps: number }; video?: { timescale: number; delta: number }; moovLast?: boolean }): ArrayBuffer {
  const ftyp = box("ftyp", str4("qt  "), u32(0));
  const build = (sampleAt: number) => {
    const traks: number[][] = [];
    if (opts.video) traks.push(videoTrak(opts.video.timescale, opts.video.delta));
    if (opts.tc) traks.push(tmcdTrak(opts.tc.flags, opts.tc.timescale, opts.tc.frameDuration, opts.tc.fps, sampleAt));
    return box("moov", box("mvhd", u32(0)), ...traks);
  };
  const sample = u32(opts.tc?.frames ?? 0);
  const mdat = box("mdat", sample);
  if (opts.moovLast) {
    // ftyp, mdat, moov: the sample sits at ftyp + 8
    const sampleAt = ftyp.length + 8;
    const moov = build(sampleAt);
    return new Uint8Array([...ftyp, ...mdat, ...moov]).buffer;
  }
  // ftyp, moov, mdat: the moov's size does not depend on the offset value
  const probe = build(0);
  const sampleAt = ftyp.length + probe.length + 8;
  const moov = build(sampleAt);
  return new Uint8Array([...ftyp, ...moov, ...mdat]).buffer;
}

const r2397 = RATES.find((r) => r.label === "23.976")!;
const r2997df = RATES.find((r) => r.label === "29.97 DF")!;

describe("the embedded timecode", () => {
  it("reads the start and the rate off a QuickTime timecode track", async () => {
    const start = parseTC("01:00:00:00", r2397)!;
    const buf = container({ tc: { frames: start, flags: 0, timescale: 24000, frameDuration: 1001, fps: 24 } });
    const got = await readEmbeddedTC(bufferReader(buf));
    expect(got.rate?.label).toBe("23.976");
    expect(got.drop).toBe(false);
    expect(formatTC(got.startFrames!, got.rate!)).toBe("01:00:00:00");
  });

  it("honors the drop-frame flag", async () => {
    const start = parseTC("00:59:58;02", r2997df) ?? parseTC("00:59:58:02", r2997df)!;
    const buf = container({ tc: { frames: start, flags: 1, timescale: 30000, frameDuration: 1001, fps: 30 } });
    const got = await readEmbeddedTC(bufferReader(buf));
    expect(got.rate?.label).toBe("29.97 DF");
    expect(got.startFrames).toBe(start);
  });

  it("finds a moov that sits after the mdat", async () => {
    const start = parseTC("10:00:00:00", r2397)!;
    const buf = container({ tc: { frames: start, flags: 0, timescale: 24000, frameDuration: 1001, fps: 24 }, moovLast: true });
    const got = await readEmbeddedTC(bufferReader(buf));
    expect(formatTC(got.startFrames!, got.rate!)).toBe("10:00:00:00");
  });

  it("falls back to the video track's timing for the rate, with no start", async () => {
    const buf = container({ video: { timescale: 25, delta: 1 } });
    const got = await readEmbeddedTC(bufferReader(buf));
    expect(got.rate?.label).toBe("25");
    expect(got.startFrames).toBeUndefined();
  });

  it("says nothing about a file that is not a box file", async () => {
    const junk = new TextEncoder().encode("Eß£ this is a webm, honest").buffer;
    expect(await readEmbeddedTC(bufferReader(junk))).toEqual({});
    expect(await readEmbeddedTC(bufferReader(new ArrayBuffer(0)))).toEqual({});
  });

  it("prefers the timecode track's rate over the video track's", async () => {
    const start = parseTC("01:00:00:00", r2397)!;
    const buf = container({
      video: { timescale: 25, delta: 1 },
      tc: { frames: start, flags: 0, timescale: 24000, frameDuration: 1001, fps: 24 },
    });
    const got = await readEmbeddedTC(bufferReader(buf));
    expect(got.rate?.label).toBe("23.976");
  });
});
