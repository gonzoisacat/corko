import { describe, expect, it } from "vitest";
import {
  RATES,
  formatDuration,
  formatTC,
  framesToSeconds,
  guessBase,
  parseTC,
  rateFor,
  secondsToFrames,
} from "./timecode";

/* ------------------------------------------------------------------ *
 *  TIMECODE.
 *
 *  Pinned hard because everything downstream is arithmetic on top of it:
 *  a shot board's durations, and (Phase B) which frame of a video gets
 *  grabbed for which card. An error here is not a wrong number on one
 *  card, it is every card being wrong by a growing amount.
 * ------------------------------------------------------------------ */

const ndf30 = rateFor(30, false);
const df30 = rateFor(30, true);
const r24 = RATES.find((r) => r.label === "23.976")!;
const r25 = rateFor(25, false);
const df60 = rateFor(60, true);

describe("parseTC: a timecode is a label for a frame number", () => {
  it("counts non-drop timecode at the base rate", () => {
    expect(parseTC("00:00:00:00", ndf30)).toBe(0);
    expect(parseTC("00:00:01:00", ndf30)).toBe(30);
    expect(parseTC("00:01:00:00", ndf30)).toBe(1800);
    expect(parseTC("01:00:00:00", ndf30)).toBe(108000);
  });

  it("counts 24 and 25 at THEIR base, not at 30", () => {
    expect(parseTC("00:00:01:00", r24)).toBe(24);
    expect(parseTC("00:00:01:00", r25)).toBe(25);
    expect(parseTC("01:00:00:00", r24)).toBe(86400);
  });

  it("DROP FRAME skips labels, not frames -- the numbers that matter", () => {
    /* The three canonical checks. Drop-frame removes two labels at the
     * top of nine minutes in every ten, so the count runs BEHIND the
     * non-drop reading of the same string by exactly the labels skipped. */
    expect(parseTC("00:00:00:00", df30)).toBe(0);
    // the first drop: 00:00:59:29 is 1799, and the next frame is labelled :02
    expect(parseTC("00:00:59:29", df30)).toBe(1799);
    expect(parseTC("00:01:00:02", df30)).toBe(1800);
    // the tenth minute keeps its labels, so ten minutes is 17982, not 18000
    expect(parseTC("00:10:00:00", df30)).toBe(17982);
    // an hour of 29.97 DF is 107892 frames -- 108 fewer than non-drop
    expect(parseTC("01:00:00:00", df30)).toBe(107892);
    expect(parseTC("01:00:00:00", ndf30)).toBe(108000);
  });

  it("59.94 drop skips FOUR a minute, not two", () => {
    expect(parseTC("00:10:00:00", df60)).toBe(35964); // 36000 - 4*9
  });

  it("accepts the `;` and `.` drop spellings, whatever the rate says", () => {
    /* The RATE decides whether drop arithmetic applies, not the
     * punctuation -- plenty of tools emit `:` for a drop-frame list. */
    expect(parseTC("01:00:00;00", df30)).toBe(parseTC("01:00:00:00", df30));
    expect(parseTC("01:00:00.00", ndf30)).toBe(parseTC("01:00:00:00", ndf30));
  });

  it("REFUSES a frame field the rate cannot hold, rather than clamping", () => {
    /* ff >= base means the rate is wrong. A clamped frame count is a
     * silently wrong answer, which is the whole failure mode here. */
    expect(parseTC("00:00:00:24", r24)).toBeNull();
    expect(parseTC("00:00:00:25", r25)).toBeNull();
    expect(parseTC("00:00:00:23", r24)).toBe(23);
  });

  it("refuses things that are not timecodes", () => {
    for (const bad of ["", "nope", "1:2:3", "00:00:00", "00:70:00:00", "aa:bb:cc:dd"]) {
      expect(parseTC(bad, ndf30)).toBeNull();
    }
  });
});

describe("formatTC: the inverse, asserted as a round trip", () => {
  /* Written as a round trip rather than against a table of expected
   * strings on purpose: the encode and decode formulas are each easy to
   * write and easy to get ALMOST right, and they fail in opposite
   * directions. Only walking real frame counts through both catches it. */
  for (const rate of [ndf30, df30, r24, r25, df60]) {
    it(`round-trips every frame across boundaries at ${rate.label}`, () => {
      const spots = [
        0, 1, rate.base - 1, rate.base,
        rate.base * 59, rate.base * 60, rate.base * 60 + 1,
        rate.base * 599, rate.base * 600, rate.base * 601,
        rate.base * 3599, rate.base * 3600,
        Math.floor(rate.base * 3600 * 1.5),
      ];
      const frames = new Set<number>();
      for (const s of spots) for (let d = -3; d <= 3; d++) if (s + d >= 0) frames.add(s + d);
      for (const f of frames) {
        const tc = formatTC(f, rate);
        expect(parseTC(tc, rate), `${f} -> ${tc}`).toBe(f);
      }
    });
  }

  it("round-trips a long exhaustive run at 29.97 DF, the awkward one", () => {
    /* Every frame of the first twenty-one minutes, which spans two
     * ten-minute blocks and every kind of minute boundary in them. */
    for (let f = 0; f < df30.base * 60 * 21; f++) {
      expect(parseTC(formatTC(f, df30), df30)).toBe(f);
    }
  });

  it("spells drop-frame with `;` and non-drop with `:`", () => {
    expect(formatTC(0, df30)).toBe("00:00:00;00");
    expect(formatTC(0, ndf30)).toBe("00:00:00:00");
  });

  it("shows a negative count as negative rather than wrapping to hour 23", () => {
    /* Reached when an offset runs off the head of the sequence. It
     * should look wrong, because it is. */
    expect(formatTC(-30, ndf30)).toBe("-00:00:01:00");
  });
});

describe("formatDuration: an amount, not a position", () => {
  it("never takes drop-frame's `;` -- there is no clock to stay aligned to", () => {
    expect(formatDuration(1800, df30)).toBe("00:01:00:00");
    expect(formatDuration(1800, ndf30)).toBe("00:01:00:00");
  });

  it("counts plainly at the base rate, with no drop adjustment", () => {
    /* The distinction that matters: 1800 frames at 29.97 IS one minute
     * of frames, and reading it as a POSITION would spell it 00:01:00;02.
     * A duration must not do that. */
    expect(formatDuration(0, df30)).toBe("00:00:00:00");
    expect(formatDuration(29, df30)).toBe("00:00:00:29");
    expect(formatDuration(30, df30)).toBe("00:00:01:00");
    expect(formatDuration(-5, ndf30)).toBe("00:00:00:00"); // clamped, not negative
  });
});

describe("framesToSeconds: the only place `exact` is read", () => {
  it("uses the EXACT rate, so 23.976 is not 24", () => {
    /* An hour of 23.976 timecode is 86400 frames, which plays for
     * 3603.6 seconds -- 3.6 seconds LONGER than an hour. Reading it at
     * 24 would say exactly 3600 and be wrong by that much. */
    const anHour = parseTC("01:00:00:00", r24)!;
    expect(anHour).toBe(86400);
    expect(framesToSeconds(anHour, r24)).toBeCloseTo(3603.6, 3);
    expect(framesToSeconds(anHour, RATES.find((r) => r.label === "24")!)).toBe(3600);
  });

  it("29.97 drop-frame lands within a couple of frames of wall clock", () => {
    /* Which is the whole point of drop frame, and a good cross-check
     * that the drop arithmetic and the exact rate agree. */
    const anHour = parseTC("01:00:00:00", df30)!;
    expect(Math.abs(framesToSeconds(anHour, df30) - 3600)).toBeLessThan(0.15);
  });

  it("round-trips against secondsToFrames", () => {
    for (const rate of [ndf30, df30, r24, r25]) {
      for (const f of [0, 1, 999, 86400]) {
        expect(secondsToFrames(framesToSeconds(f, rate), rate)).toBe(f);
      }
    }
  });
});

describe("guessBase: a floor, never a fact", () => {
  it("takes the smallest base that fits every frame field seen", () => {
    expect(guessBase(["00:00:00:23", "00:00:01:12"])).toBe(24);
    expect(guessBase(["00:00:00:24"])).toBe(25);
    expect(guessBase(["00:00:00:29"])).toBe(30);
    expect(guessBase(["00:00:00:59"])).toBe(60);
  });

  it("under-estimates rather than over-estimates, which is the honest way to be wrong", () => {
    /* A 25 fps list that happens never to use frame 24 reads as 24, and
     * that is why the caller offers this as a default rather than
     * applying it. It can never claim a base HIGHER than the evidence. */
    expect(guessBase(["00:00:00:10", "00:00:00:11"])).toBe(24);
  });

  it("falls back rather than throwing on junk or nothing", () => {
    expect(guessBase([])).toBe(24);
    expect(guessBase(["not a timecode"])).toBe(24);
  });
});

describe("rateFor", () => {
  it("prefers the /1001 member, because that is what cuts are actually in", () => {
    expect(rateFor(24, false).label).toBe("23.976");
    expect(rateFor(30, false).label).toBe("29.97 NDF");
    expect(rateFor(30, true).label).toBe("29.97 DF");
  });

  it("falls back for a base it does not know, rather than throwing", () => {
    /* Reached from a file we did not write. */
    expect(rateFor(48, false).base).toBe(24);
  });

  it("offers drop only where drop is defined", () => {
    /* 25 has no drop-frame variant -- PAL never needed one. Asking for
     * one must not invent it. */
    expect(rateFor(25, true).drop).toBe(false);
  });
});
