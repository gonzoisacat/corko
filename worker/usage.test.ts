import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyR2Action,
  clearUsageCache,
  computeMeters,
  getUsage,
  usageWindows,
  type Plan,
} from "./usage";

/* ------------------------------------------------------------------ *
 *  The usage meters' pure halves. The GraphQL field names themselves
 *  were introspected from the live schema and the composed query run
 *  against the real account before shipping (2026-08-28); what these
 *  pin is OUR arithmetic on top -- the windows, the unit conversions,
 *  the R2 classification, and the cache -- which is where a wrong
 *  number would come from silently.
 * ------------------------------------------------------------------ */

const rawWith = (over: Record<string, unknown> = {}) => ({
  data: {
    viewer: {
      accounts: [
        {
          requests: [{ sum: { requests: 617, cpuTimeUs: 2_500_000 } }],
          doReq: [{ sum: { requests: 400 } }],
          doPeriodic: [{ sum: { activeTime: 1_567_007_083, rowsRead: 7873, rowsWritten: 12 } }],
          doStored: [{ max: { storedBytes: 6_860_800 } }],
          r2Ops: [
            { sum: { requests: 10 }, dimensions: { actionType: "HeadBucket" } },
            { sum: { requests: 3 }, dimensions: { actionType: "PutObject" } },
            { sum: { requests: 5 }, dimensions: { actionType: "DeleteObject" } },
          ],
          r2Stored: [{ max: { payloadSize: 40_000, metadataSize: 1_000 } }],
          ...over,
        },
      ],
    },
  },
  errors: null,
});

const NOW = new Date("2026-08-28T20:30:00Z");
const meter = (plan: Plan, id: string, raw = rawWith()) =>
  computeMeters(plan, raw, NOW).find((m) => m.id === id)!;

describe("classifyR2Action", () => {
  it("puts writes and lists in A, reads in B, deletes in free", () => {
    expect(classifyR2Action("PutObject")).toBe("A");
    expect(classifyR2Action("ListObjects")).toBe("A");
    expect(classifyR2Action("GetObject")).toBe("B");
    expect(classifyR2Action("HeadBucket")).toBe("B");
    expect(classifyR2Action("DeleteObject")).toBe("free");
  });

  it("counts an UNKNOWN verb as Class A -- toward the smaller allowance", () => {
    /* A verb Cloudflare adds later must not silently vanish from the
     * meter; over-counting against the tighter limit is the honest
     * direction to be wrong in. */
    expect(classifyR2Action("SomeFutureAction")).toBe("A");
  });
});

describe("usageWindows", () => {
  it("free counts over the UTC day and resets at the next midnight", () => {
    const w = usageWindows("free", NOW);
    expect(w.opsStart.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(w.opsReset.toISOString()).toBe("2026-08-29T00:00:00.000Z");
  });

  it("paid counts over the calendar month, and December rolls the year", () => {
    const w = usageWindows("paid", NOW);
    expect(w.opsStart.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(w.opsReset.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    const dec = usageWindows("paid", new Date("2026-12-31T23:00:00Z"));
    expect(dec.opsReset.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("computeMeters", () => {
  it("converts activeTime microseconds to GB-s at the flat 128 MB", () => {
    /* 1,567,007,083 us = 1567.007 s of wall clock * 0.125 GB. */
    expect(meter("paid", "do-duration").used).toBeCloseTo(195.876, 2);
  });

  it("converts DO invocations to BILLED requests at 20:1", () => {
    /* The allowance is denominated in billed requests; the analytics
     * metric counts every incoming websocket message as one. Skipping
     * this conversion showed a 95% red bar on an account at 5% -- the
     * bug this pins (2026-08-29). */
    expect(meter("paid", "do-requests").used).toBe(400 / 20);
  });

  it("classifies and sums the R2 ops, and deletes count nowhere", () => {
    expect(meter("paid", "r2-class-b").used).toBe(10);
    expect(meter("paid", "r2-class-a").used).toBe(3);
  });

  it("adds payload and metadata for R2 storage", () => {
    expect(meter("paid", "r2-storage").used).toBe(41_000);
  });

  it("free uses the daily cliffs, paid the monthly allowances", () => {
    expect(meter("free", "requests").limit).toBe(100_000);
    expect(meter("free", "requests").period).toBe("day");
    expect(meter("paid", "requests").limit).toBe(10_000_000);
    expect(meter("paid", "requests").period).toBe("month");
    /* CPU is a paid-only meter -- free has no monthly CPU allowance to
     * count against. */
    expect(computeMeters("free", rawWith(), NOW).find((m) => m.id === "cpu")).toBeUndefined();
    expect(meter("paid", "cpu").used).toBe(2500); // us -> ms
  });

  it("storage meters are standing -- no reset to promise", () => {
    expect(meter("paid", "do-storage").resetsAt).toBeNull();
    expect(meter("paid", "r2-storage").period).toBe("standing");
  });

  it("EVERY group may be empty -- a brand-new deployment reads as zeros", () => {
    const empty = {
      data: { viewer: { accounts: [{}] } },
      errors: null,
    };
    for (const m of computeMeters("free", empty, NOW)) {
      expect(m.used, m.id).toBe(0);
      expect(Number.isFinite(m.limit), m.id).toBe(true);
    }
  });
});

describe("getUsage", () => {
  afterEach(() => clearUsageCache());

  const env = {
    CORKO_USAGE_TOKEN: "tok",
    CORKO_ACCOUNT_ID: "acct",
    CORKO_PLAN: "paid",
  };
  const okFetch = () =>
    vi.fn(async () => new Response(JSON.stringify(rawWith()), { status: 200 })) as typeof fetch;

  it("fetches once and serves the cache for five minutes", async () => {
    const f = okFetch();
    const first = await getUsage(env, f);
    const second = await getUsage(env, f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.meters.length).toBe(first.meters.length);
  });

  it("throws on GraphQL errors instead of reporting zeros as truth", async () => {
    /* An auth failure comes back 200 with an errors array -- reading it
     * as "no usage" would render a reassuring row of empty bars over a
     * broken token. */
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: null, errors: [{ message: "not authorized" }] }), {
          status: 200,
        }),
    ) as typeof fetch;
    await expect(getUsage(env, f)).rejects.toThrow("not authorized");
  });
});
