/* ------------------------------------------------------------------ *
 *  USAGE -- how close this deployment is to Cloudflare's limits.
 *
 *  THE WORKER CANNOT SEE ITS OWN USAGE. There is no runtime API that
 *  says "you have used 40k of today's 100k requests" -- the numbers
 *  live in Cloudflare's GraphQL Analytics API, an account-level
 *  service queried with a token. So the /usage route (index.ts) calls
 *  it server-side with CORKO_USAGE_TOKEN (a read-only Account
 *  Analytics token, set as a secret exactly like CORKO_PASSWORD) and
 *  hands the app a small digested report. The token never reaches the
 *  client; the route sits behind the same authState gate as everything
 *  else.
 *
 *  EVERY DATASET AND FIELD NAME HERE WAS INTROSPECTED FROM THE LIVE
 *  SCHEMA (2026-08-28), not recalled: workersInvocationsAdaptive
 *  (sum.requests, sum.cpuTimeUs), durableObjectsInvocationsAdaptiveGroups
 *  (sum.requests), durableObjectsPeriodicGroups (sum.activeTime,
 *  sum.rowsRead, sum.rowsWritten), durableObjectsSqlStorageGroups
 *  (max.storedBytes -- the SQLite-backed dataset, which is what
 *  CorkoRoom is), r2OperationsAdaptiveGroups (sum.requests by
 *  actionType), r2StorageAdaptiveGroups (max.payloadSize +
 *  metadataSize). The composed query was run against the real account
 *  before shipping.
 *
 *  WHY NOT METER OURSELVES: counting requests inside the Durable
 *  Object would spend the tightest meter (rows written) to measure it,
 *  and could not reproduce the platform's own accounting -- websocket
 *  messages bill 20:1, static assets bill zero. The bill's own
 *  analytics are the only honest source.
 *
 *  HONESTY LABELS ARE PART OF THE CONTRACT: analytics lag a few
 *  minutes and the adaptive datasets are sampled, so the report
 *  carries `asOf` and the client says "as of N min ago". A meter that
 *  looks exact and is not would be worse than none.
 * ------------------------------------------------------------------ */

export type Plan = "free" | "paid";

/* R2 billing classes, from the R2 pricing page. Class A is the
 * expensive verbs (writes and lists), Class B the cheap reads, and the
 * deletes are free. An UNKNOWN action counts as Class A on purpose:
 * over-counting toward the smaller allowance is the conservative
 * direction, and a new verb Cloudflare adds should not silently vanish
 * from the meter. */
const R2_CLASS_A = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);
const R2_CLASS_B = new Set([
  "HeadBucket",
  "HeadObject",
  "GetObject",
  "UsageSummary",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
]);
const R2_FREE = new Set(["DeleteObject", "DeleteBucket", "AbortMultipartUpload"]);

export function classifyR2Action(actionType: string): "A" | "B" | "free" {
  if (R2_FREE.has(actionType)) return "free";
  if (R2_CLASS_B.has(actionType)) return "B";
  if (R2_CLASS_A.has(actionType)) return "A";
  return "A"; // unknown verbs count toward the tighter allowance
}

export interface UsageMeter {
  id: string;
  label: string;
  group: "Workers" | "Durable Objects" | "R2";
  used: number;
  limit: number;
  /* How the client should print `used`/`limit`. */
  unit: "ops" | "bytes" | "gbs" | "ms";
  /* daily = a free-plan cliff that resets at 00:00 UTC; monthly = an
   * allowance that resets on the 1st; standing = a stored total with
   * no reset (storage). */
  period: "day" | "month" | "standing";
  resetsAt: string | null; // ISO, null for standing
}

export interface UsageReport {
  plan: Plan;
  asOf: string; // when the numbers were fetched from Cloudflare
  cached: boolean;
  meters: UsageMeter[];
  /* The reassuring fact that needs saying rather than metering. */
  note: string;
}

/* The windows the meters are counted over. FREE meters are daily
 * cliffs, PAID included allowances are monthly -- so the ops window
 * follows the plan, while R2's free tier is monthly on every plan and
 * the storage numbers are latest-datapoint reads. Month boundaries are
 * CALENDAR-month UTC: the free tier resets that way exactly; a paid
 * billing cycle can sit elsewhere in the month, which is accepted --
 * past the included amounts nothing stops on paid, so the meter is a
 * cost gauge rather than a countdown. */
export function usageWindows(plan: Plan, now: Date) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const nextDay = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    opsStart: plan === "free" ? dayStart : monthStart,
    opsReset: plan === "free" ? nextDay : nextMonth,
    monthStart,
    nextMonth,
  };
}

/* One round trip for everything. $opsStart follows the plan (see
 * usageWindows); $monthStart is R2's window and the lookback for the
 * two latest-datapoint storage reads. */
export const USAGE_QUERY = `query($account: String!, $opsStart: Time!, $monthStart: Time!, $now: Time!) {
  viewer {
    accounts(filter: {accountTag: $account}) {
      requests: workersInvocationsAdaptive(filter: {datetime_geq: $opsStart, datetime_leq: $now}, limit: 10000) {
        sum { requests cpuTimeUs }
      }
      doReq: durableObjectsInvocationsAdaptiveGroups(filter: {datetime_geq: $opsStart, datetime_leq: $now}, limit: 10000) {
        sum { requests }
      }
      doPeriodic: durableObjectsPeriodicGroups(filter: {datetime_geq: $opsStart, datetime_leq: $now}, limit: 10000) {
        sum { activeTime rowsRead rowsWritten }
      }
      doStored: durableObjectsSqlStorageGroups(filter: {datetime_geq: $monthStart, datetime_leq: $now}, orderBy: [datetime_DESC], limit: 1) {
        max { storedBytes }
        dimensions { datetime }
      }
      r2Ops: r2OperationsAdaptiveGroups(filter: {datetime_geq: $monthStart, datetime_leq: $now}, limit: 100) {
        sum { requests }
        dimensions { actionType }
      }
      r2Stored: r2StorageAdaptiveGroups(filter: {datetime_geq: $monthStart, datetime_leq: $now}, orderBy: [datetime_DESC], limit: 1) {
        max { payloadSize metadataSize }
        dimensions { datetime }
      }
    }
  }
}`;

/* The allowances, per plan. FREE numbers are the daily cliffs (the
 * service STOPS at these until 00:00 UTC); PAID numbers are the
 * monthly included amounts ($5/mo -- past them the meter is cents, and
 * nothing stops). R2's free tier is the same monthly allowance on both
 * plans. Checked against the pricing pages 2026-08-28; when Cloudflare
 * moves them, this table is the one place to edit. */
const LIMITS = {
  free: {
    requests: 100_000, // per day
    doRequests: 100_000, // per day
    doGbs: 13_000, // duration GB-s per day
    rowsRead: 5_000_000, // per day
    rowsWritten: 100_000, // per day
    doStorage: 5 * 1024 ** 3, // 5 GB
  },
  paid: {
    requests: 10_000_000, // per month included
    cpuMs: 30_000_000, // per month included
    doRequests: 1_000_000, // per month included
    doGbs: 400_000, // per month included
    rowsRead: 25_000_000_000, // per month included
    rowsWritten: 50_000_000, // per month included
    doStorage: 5 * 1024 ** 3, // included
  },
  r2: {
    storage: 10 * 1024 ** 3, // 10 GB-month, free on every plan
    classA: 1_000_000, // per month
    classB: 10_000_000, // per month
  },
};

/* The GraphQL response, loosely -- every group can legitimately come
 * back EMPTY (a brand-new deployment, an idle month), so every read
 * below defaults to zero rather than trusting shape. */
interface RawUsage {
  data?: {
    viewer?: {
      accounts?: {
        requests?: { sum?: { requests?: number; cpuTimeUs?: number } }[];
        doReq?: { sum?: { requests?: number } }[];
        doPeriodic?: { sum?: { activeTime?: number; rowsRead?: number; rowsWritten?: number } }[];
        doStored?: { max?: { storedBytes?: number } }[];
        r2Ops?: { sum?: { requests?: number }; dimensions?: { actionType?: string } }[];
        r2Stored?: { max?: { payloadSize?: number; metadataSize?: number } }[];
      }[];
    };
  };
  errors?: { message?: string }[] | null;
}

export function computeMeters(plan: Plan, raw: RawUsage, now: Date): UsageMeter[] {
  const acc = raw.data?.viewer?.accounts?.[0] ?? {};
  const w = usageWindows(plan, now);
  const opsReset = w.opsReset.toISOString();
  const monthReset = w.nextMonth.toISOString();
  const opsPeriod: "day" | "month" = plan === "free" ? "day" : "month";

  const reqSum = acc.requests?.[0]?.sum ?? {};
  /* THE 20:1 CONVERSION, and it is the difference between a red bar and
   * a 5% one. The analytics `requests` metric counts ACTUAL invocations
   * -- with the hibernation API, every incoming WebSocket message is
   * one -- while BILLING (which is what the 1M allowance and the free
   * 100k/day cliff are denominated in) counts incoming messages at
   * 20:1. Cloudflare's own pricing doc: "the 20:1 ratio does not
   * affect Durable Object metrics and analytics, which reflect actual
   * usage." Verified against the real account 2026-08-29: 948k
   * analytics requests were ~950k messages, i.e. ~47k billed.
   *
   * Dividing EVERYTHING by 20 slightly under-counts the plain HTTP
   * upgrades (billed 1:1), but those are dozens a day against tens of
   * thousands of messages and the dataset cannot split them --
   * under-counting by at most a few hundred a month is the honest
   * approximation, and the panel already says the numbers are
   * sampled. */
  const doReq = (acc.doReq?.[0]?.sum?.requests ?? 0) / 20;
  const doP = acc.doPeriodic?.[0]?.sum ?? {};
  /* activeTime is MICROSECONDS of wall clock; billing charges it at a
   * flat 128 MB, so GB-s = seconds * 0.125 = microseconds / 8e6. */
  const doGbs = (doP.activeTime ?? 0) / 8_000_000;
  const doStored = acc.doStored?.[0]?.max?.storedBytes ?? 0;
  let r2A = 0;
  let r2B = 0;
  for (const g of acc.r2Ops ?? []) {
    const n = g.sum?.requests ?? 0;
    const cls = classifyR2Action(g.dimensions?.actionType ?? "");
    if (cls === "A") r2A += n;
    else if (cls === "B") r2B += n;
  }
  const r2S = acc.r2Stored?.[0]?.max ?? {};
  const r2Stored = (r2S.payloadSize ?? 0) + (r2S.metadataSize ?? 0);

  const L = plan === "free" ? LIMITS.free : LIMITS.paid;
  const meters: UsageMeter[] = [
    {
      id: "requests",
      label: "Requests",
      group: "Workers",
      used: reqSum.requests ?? 0,
      limit: L.requests,
      unit: "ops",
      period: opsPeriod,
      resetsAt: opsReset,
    },
  ];
  if (plan === "paid") {
    meters.push({
      id: "cpu",
      label: "CPU time",
      group: "Workers",
      used: (reqSum.cpuTimeUs ?? 0) / 1000,
      limit: LIMITS.paid.cpuMs,
      unit: "ms",
      period: "month",
      resetsAt: monthReset,
    });
  }
  meters.push(
    {
      id: "do-requests",
      label: "Requests",
      group: "Durable Objects",
      used: doReq,
      limit: L.doRequests,
      unit: "ops",
      period: opsPeriod,
      resetsAt: opsReset,
    },
    {
      id: "do-duration",
      label: "Duration",
      group: "Durable Objects",
      used: doGbs,
      limit: L.doGbs,
      unit: "gbs",
      period: opsPeriod,
      resetsAt: opsReset,
    },
    {
      id: "rows-read",
      label: "Rows read",
      group: "Durable Objects",
      used: doP.rowsRead ?? 0,
      limit: L.rowsRead,
      unit: "ops",
      period: opsPeriod,
      resetsAt: opsReset,
    },
    {
      id: "rows-written",
      label: "Rows written",
      group: "Durable Objects",
      used: doP.rowsWritten ?? 0,
      limit: L.rowsWritten,
      unit: "ops",
      period: opsPeriod,
      resetsAt: opsReset,
    },
    {
      id: "do-storage",
      label: "Stored",
      group: "Durable Objects",
      used: doStored,
      limit: L.doStorage,
      unit: "bytes",
      period: "standing",
      resetsAt: null,
    },
    {
      id: "r2-storage",
      label: "Stored frames",
      group: "R2",
      used: r2Stored,
      limit: LIMITS.r2.storage,
      unit: "bytes",
      period: "standing",
      resetsAt: null,
    },
    {
      id: "r2-class-a",
      label: "Writes + lists",
      group: "R2",
      used: r2A,
      limit: LIMITS.r2.classA,
      unit: "ops",
      period: "month",
      resetsAt: monthReset,
    },
    {
      id: "r2-class-b",
      label: "Reads",
      group: "R2",
      used: r2B,
      limit: LIMITS.r2.classB,
      unit: "ops",
      period: "month",
      resetsAt: monthReset,
    },
  );
  return meters;
}

const NOTE =
  "Serving the app itself (pages, scripts, textures) is free and unmetered. " +
  "Numbers lag a few minutes and are sampled.";

/* One fetch per five minutes, whoever asks. Module-level on purpose: an
 * isolate recycle just means one extra API call, and anything sturdier
 * (Durable Object storage) would spend a metered write to cache a
 * meter. */
const CACHE_MS = 5 * 60_000;
let cache: { at: number; report: UsageReport } | null = null;
export const clearUsageCache = () => {
  cache = null;
};

export interface UsageEnv {
  CORKO_USAGE_TOKEN?: string;
  CORKO_ACCOUNT_ID?: string;
  CORKO_PLAN?: string;
}

export async function getUsage(
  env: UsageEnv,
  fetcher: typeof fetch = fetch,
): Promise<UsageReport> {
  if (cache && Date.now() - cache.at < CACHE_MS) return { ...cache.report, cached: true };
  const plan: Plan = env.CORKO_PLAN === "paid" ? "paid" : "free";
  const now = new Date();
  const w = usageWindows(plan, now);
  const r = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CORKO_USAGE_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: USAGE_QUERY,
      variables: {
        account: env.CORKO_ACCOUNT_ID,
        opsStart: w.opsStart.toISOString(),
        monthStart: w.monthStart.toISOString(),
        now: now.toISOString(),
      },
    }),
  });
  const raw = (await r.json()) as RawUsage;
  if (!r.ok || (raw.errors && raw.errors.length)) {
    throw new Error(raw.errors?.[0]?.message ?? `analytics API answered ${r.status}`);
  }
  const report: UsageReport = {
    plan,
    asOf: now.toISOString(),
    cached: false,
    meters: computeMeters(plan, raw, now),
    note: NOTE,
  };
  cache = { at: Date.now(), report };
  return report;
}
