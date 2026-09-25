import { describe, expect, it } from "vitest";
import {
  clearCalc,
  clockToFrames,
  derivedOf,
  EMPTY_CALC,
  formatClock,
  parseAny,
  parseClock,
  setField,
  showClock,
  showDuration,
  showPosition,
} from "./tcCalc";
import { RATES, rateFor } from "./timecode";

const r24 = rateFor(24, false); // 23.976
const r30df = rateFor(30, true); // 29.97 DF

describe("the three-field solve", () => {
  it("starts with duration as the answer", () => {
    expect(derivedOf(EMPTY_CALC)).toBe("dur");
  });

  it("in and out give the duration", () => {
    let c = setField(EMPTY_CALC, "in", 100);
    c = setField(c, "out", 340);
    expect(c.frames.dur).toBe(240);
    expect(derivedOf(c)).toBe("dur");
  });

  /* Typing into the ANSWER moves the answer: the field you have ignored
   * longest gives way, so what you just said is never overwritten. */
  it("typing the duration makes the older field the answer", () => {
    let c = setField(EMPTY_CALC, "in", 100);
    c = setField(c, "out", 340);
    c = setField(c, "dur", 480);
    expect(derivedOf(c)).toBe("in"); // `out` was newer, so `in` gave way
    expect(c.frames.out).toBe(340);
    expect(c.frames.in).toBe(340 - 480);
  });

  it("in plus duration gives the out", () => {
    let c = setField(EMPTY_CALC, "dur", 240);
    c = setField(c, "in", 100);
    expect(derivedOf(c)).toBe("out");
    expect(c.frames.out).toBe(340);
  });

  it("out minus duration gives the in", () => {
    let c = setField(EMPTY_CALC, "dur", 240);
    c = setField(c, "out", 340);
    expect(derivedOf(c)).toBe("in");
    expect(c.frames.in).toBe(100);
  });

  it("re-typing a held field keeps the same answer", () => {
    let c = setField(EMPTY_CALC, "in", 100);
    c = setField(c, "out", 340);
    c = setField(c, "in", 200);
    expect(derivedOf(c)).toBe("dur");
    expect(c.frames.dur).toBe(140);
  });

  it("the answer is null until both of the others are filled", () => {
    const c = setField(EMPTY_CALC, "in", 100);
    expect(c.frames.dur).toBe(null);
  });

  /* Out before in is something you typed, not an error to swallow. */
  it("a backwards in and out gives a negative duration", () => {
    let c = setField(EMPTY_CALC, "in", 340);
    c = setField(c, "out", 100);
    expect(c.frames.dur).toBe(-240);
    expect(showDuration(c.frames.dur, r24)).toBe("-00:00:10:00");
  });

  it("clearing keeps which field is the answer", () => {
    let c = setField(EMPTY_CALC, "dur", 240);
    c = setField(c, "out", 340);
    const cleared = clearCalc(c);
    expect(derivedOf(cleared)).toBe("in");
    expect(cleared.frames).toEqual({ in: null, out: null, dur: null });
  });
});

describe("mm:ss, a rounded re-reading of the timecode", () => {
  /* HIS RULE (2026-09-10): "lets do mm:ss that's just a rounded
   * re-configuration of the TC. it can go over 60 and even into triple
   * or quadruple digits on the minutes." It is NOT real elapsed time --
   * an hour of 23.976 labels takes an hour and 3.6 real seconds, and a
   * box answering 1:00:02 for 01:00:00:00 is right about physics and
   * useless on a card. */
  it("re-reads the label, so an hour is sixty minutes", () => {
    expect(showClock(60 * 60 * r24.base, r24)).toBe("60:00");
    expect(showClock(2 * 60 * r24.base + 30 * r24.base, r24)).toBe("2:30");
  });

  it("lets the minutes run past sixty into three and four digits", () => {
    expect(showClock(123 * 60 * r24.base + 5 * r24.base, r24)).toBe("123:05");
    expect(showClock(1000 * 60 * r24.base, r24)).toBe("1000:00");
  });

  it("rounds the frames into a second rather than truncating", () => {
    expect(showClock(2 * 60 * r24.base + 29 * r24.base + 14, r24)).toBe("2:30"); // 14/24 rounds up
    expect(showClock(2 * 60 * r24.base + 29 * r24.base + 4, r24)).toBe("2:29"); // 4/24 rounds down
    expect(showClock(r24.base / 2, r24)).toBe("0:01"); // exactly half rounds up
  });

  it("says when it is negative", () => {
    expect(showClock(-(2 * 60 * r24.base + 30 * r24.base), r24)).toBe("-2:30");
  });

  /* The two boxes are exact inverses now, which is the point of doing it
   * off the label: type 2:30 and the timecode reads 00:02:30:00. */
  it("round-trips against the timecode box", () => {
    for (const rate of RATES) {
      const frames = clockToFrames(parseClock("2:30")!, rate);
      expect(showDuration(frames, rate)).toBe("00:02:30:00");
      expect(showClock(frames, rate)).toBe("2:30");
    }
  });

  it("reads the ways people write a length", () => {
    expect(parseClock("2:30")).toBe(150);
    expect(parseClock("02:30")).toBe(150);
    expect(parseClock("123:05")).toBe(7385);
    expect(parseClock("90")).toBe(90); // carries: a minute and a half
  });

  it("fills bare digits from the right: the last two are seconds", () => {
    expect(parseClock("230")).toBe(150);
    expect(parseClock("30")).toBe(30);
    expect(parseClock("12305")).toBe(7385);
  });

  /* An h:mm:ss somebody pastes is folded in rather than refused, and
   * comes back with its hours poured into the minutes. */
  it("folds a pasted h:mm:ss into minutes", () => {
    expect(parseClock("1:05:17")).toBe(3917);
    expect(formatClock(3917)).toBe("65:17");
  });

  it("carries an overfull seconds place", () => {
    expect(parseClock("1:75")).toBe(135);
    expect(formatClock(135)).toBe("2:15");
  });

  it("refuses what is not a clock", () => {
    expect(parseClock("")).toBe(null);
    expect(parseClock("abc")).toBe(null);
    expect(parseClock("2:30:11:04")).toBe(null); // that is a timecode
  });
});

describe("reading fields in and out", () => {
  it("a position wears drop-frame's semicolon and a duration never does", () => {
    const oneMin = 30 * 60;
    expect(showPosition(oneMin, r30df)).toContain(";");
    expect(showDuration(oneMin, r30df)).not.toContain(";");
  });

  it("takes a written timecode", () => {
    expect(parseAny("01:00:00:00", r24)).toBe(24 * 60 * 60);
    expect(parseAny("", r24)).toBe(null);
    expect(parseAny("nope", r24)).toBe(null);
  });

  /* HIS REPORT: bare digits used to read as a raw frame count, so "0100"
   * was a hundred frames rather than one second -- the numbers going the
   * wrong way. They fill from the FRAMES place now, as every editing
   * system does, which is the only reading you can type left to right. */
  describe("bare digits fill from the right", () => {
    const f = (s: string) => parseAny(s, r24);
    it("lands in frames first and pushes left", () => {
      expect(f("1")).toBe(1);
      expect(f("115")).toBe(24 + 15); // one second, fifteen frames
      expect(f("10000")).toBe(60 * 24);
      expect(f("1000000")).toBe(60 * 60 * 24);
    });

    it("is the same number the written form gives", () => {
      expect(f("1000000")).toBe(f("01:00:00:00"));
      expect(f("115")).toBe(f("00:00:01:15"));
    });

    /* IT CARRIES rather than refusing (his "flexible on entry"): a frame
     * number that does not exist at this rate is still an instant you
     * described, and it is shown back to you the moment you type it. */
    it("carries a segment that is out of range", () => {
      expect(f("130")).toBe(24 + 30); // 1s30f at base 24 -> 00:00:02:06
      expect(showPosition(f("130"), r24)).toBe("00:00:02:06");
      expect(f("0060")).toBe(60); // sixty FRAMES: the last two digits are ff
      expect(showPosition(f("0060"), r24)).toBe("00:00:02:12");
      expect(f("6000")).toBe(60 * 24); // sixty seconds -> one minute
      expect(showPosition(f("6000"), r24)).toBe("00:01:00:00");
    });

    /* HIS EXAMPLE: "if you enter 48 in frames, it'll resolve to 2:00
     * when you hit enter (if in 24fps mode, for instance)". */
    it("spills 48 frames over into two seconds at base 24", () => {
      expect(f("48")).toBe(48);
      expect(showPosition(f("48"), r24)).toBe("00:00:02:00");
    });

    it("still refuses what is not a number at all", () => {
      expect(f("123456789")).toBe(null); // more than eight digits
      expect(f("12:ab")).toBe(null);
    });

    it("still reads a leading minus", () => {
      expect(f("-115")).toBe(-(24 + 15));
    });
  });

  it("every rate can round-trip an hour", () => {
    for (const rate of RATES) {
      const hour = rate.base * 3600;
      expect(parseAny(showPosition(hour, rate), rate)).toBe(hour);
    }
  });
});
