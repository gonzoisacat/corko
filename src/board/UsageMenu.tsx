import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { storedKey } from "../state/access";
import { formatBytes } from "../state/stillPurge";
import type { PurgePlan } from "../state/stillPurge";
import { useProject } from "../state/useBoard";
import { reclaimable, runReclaim } from "./reclaimStills";
import { pendingUploads, retryUploads } from "../state/blobStore";
import { isSettled } from "../state/sync";

/* ------------------------------------------------------------------ *
 *  USAGE -- how close this deployment is to its Cloudflare limits,
 *  visible to the people who have no dashboard access, which is
 *  everyone but the owner. Lives beside Stats and Options at the
 *  owner's call (2026-08-28).
 *
 *  The numbers come from the Worker's /usage route (worker/usage.ts
 *  says where THOSE come from and why the Worker cannot know them
 *  itself). This component only fetches on OPEN -- the server caches
 *  five minutes, so an open-happy user cannot spend analytics quota.
 *
 *  WHAT THE SAME BAR MEANS DIFFERS BY PLAN, and the panel says so
 *  rather than leaving the reader to guess: on FREE the daily meters
 *  are cliffs -- at the limit Cloudflare stops serving until 00:00
 *  UTC -- while on PAID nothing stops and past an included amount the
 *  meter is cents. A bar without that sentence reads as a countdown to
 *  an outage on both plans, which is wrong on one of them.
 *
 *  IT ALSO CARRIES THE FRAME RECLAIM (owner, 2026-08-30), which is the
 *  one row here that is not a Cloudflare meter. It belongs because this
 *  is where somebody goes when they are worried about space, and the
 *  gauge alone could say how much is held but never that any of it was
 *  dead -- so frames accumulated with nothing in the app ever
 *  mentioning it. The pile is now visible where the pile is measured,
 *  with the button beside it.
 *
 *  It is deliberately INDEPENDENT of the meters: the store answers over
 *  /stills (or locally, with no Worker at all), so it renders on a
 *  deployment whose analytics token is unset and in dev, where the rest
 *  of this panel has nothing to say. */

interface Meter {
  id: string;
  label: string;
  group: string;
  used: number;
  limit: number;
  unit: "ops" | "bytes" | "gbs" | "ms";
  period: "day" | "month" | "standing";
  resetsAt: string | null;
}
interface Report {
  plan: "free" | "paid";
  asOf: string;
  meters: Meter[];
  note: string;
}

/* Compact but honest: exact under ten thousand, one decimal of k/M/B
 * above. The server's own note says the numbers are sampled anyway. */
function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1e3)}k`;
  return Math.round(n).toLocaleString();
}
function fmt(n: number, unit: Meter["unit"]): string {
  if (unit === "bytes") {
    const gb = 1024 ** 3;
    if (n >= gb) return `${(n / gb).toFixed(1)} GB`;
    if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(0, Math.round(n / 1024))} KB`;
  }
  if (unit === "gbs") return `${compact(n)} GB-s`;
  if (unit === "ms") return `${compact(n)} ms`;
  return compact(n);
}
const resetLine = (m: Meter): string =>
  m.period === "day" ? "resets 00:00 UTC" : m.period === "month" ? "resets on the 1st" : "stored total";

export function UsageMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setOpen = (v: boolean) => {
    if (!v) onClose();
  };
  const [report, setReport] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unconfigured" | "unreachable">(
    "loading",
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    setState("loading");
    const key = storedKey();
    fetch(`/usage${key ? `?k=${encodeURIComponent(key)}` : ""}`, { cache: "no-store" })
      .then(async (r) => {
        if (dead) return;
        /* JSON or it is not the Worker -- a dev server's SPA fallback
         * answers 200 text/html here (the blobStore probe's lesson), and
         * that means the same thing 501 does: nothing is wired up at
         * this origin. */
        if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) {
          setReport((await r.json()) as Report);
          setState("ready");
        } else if (r.status === 501 || r.ok) {
          setState("unconfigured");
        } else {
          setState("unreachable");
        }
      })
      .catch(() => {
        if (!dead) setState("unreachable");
      });
    return () => {
      dead = true;
    };
  }, [open]);

  /* The frame store, read separately from the meters and for a
   * different reason -- see the header. Non-blocking on purpose: with no
   * bucket bound this falls back to the local store, which sizes every
   * blob by reading it, and no gauge should wait on that. */
  const project = useProject();
  const [frames, setFrames] = useState<PurgePlan | null>(null);
  /* Read on open, like the frames: what this browser still owes the
   * bucket, and whether its replica is settled enough to purge from. */
  const [waiting, setWaiting] = useState(0);
  const [settled, setSettled] = useState(true);
  const readFrames = useCallback(() => {
    reclaimable(project)
      .then(setFrames)
      .catch(() => setFrames(null));
  }, [project]);
  useEffect(() => {
    if (!open) return;
    setFrames(null);
    readFrames();
    setWaiting(pendingUploads().length);
    setSettled(isSettled());
    void retryUploads().then(setWaiting);
  }, [open, readFrames]);

  const groups: string[] = [];
  for (const m of report?.meters ?? []) if (!groups.includes(m.group)) groups.push(m.group);
  const ageMin = report ? Math.max(0, Math.round((Date.now() - Date.parse(report.asOf)) / 60000)) : 0;

  /* NO BUTTON OF ITS OWN (owner, 2026-09-10: "lets also hide the usage
   * meter. make it command+U"). It is a deployer's gauge, not a working
   * control, so it left the topbar for a key -- and with the button gone
   * the panel FLOATS rather than anchoring: its old wrapper is the very
   * element `topbarShed` hides when the bar is narrow
   * (`[data-shed~="usage"] .topbar-right .options`), which would have
   * made Cmd+U do nothing at small widths. */
  if (!open) return null;
  return (
    <div className="usage-float" ref={ref}>
      {true && (
        <div className="options-panel usage-panel">
          <div className="options-title mono">Usage</div>
          {state === "loading" && <div className="usage-note">Reading the meters...</div>}
          {state === "unconfigured" && (
            <div className="usage-note">
              Usage is not wired up on this deployment. It needs a read-only analytics token
              &mdash; see the deploy guide&apos;s usage step.
            </div>
          )}
          {state === "unreachable" && (
            <div className="usage-note">
              The usage numbers could not be read just now. The app itself is unaffected.
            </div>
          )}
          {state === "ready" && report && (
            <>
              {/* The sentence that tells you what a full bar MEANS. */}
              <div className="usage-plan">
                {report.plan === "paid"
                  ? "Workers Paid - past an included amount nothing stops; overage bills in cents."
                  : "Free plan - at a daily limit Cloudflare stops serving until 00:00 UTC."}
              </div>
              {groups.map((g) => (
                <div key={g}>
                  <div className="options-group mono">{g}</div>
                  {report.meters
                    .filter((m) => m.group === g)
                    .map((m) => {
                      const pct = m.limit > 0 ? Math.min(1, m.used / m.limit) : 0;
                      return (
                        <div className="usage-row" key={m.id}>
                          <div className="usage-row-head">
                            <span>{m.label}</span>
                            <span className="mono usage-vals">
                              {fmt(m.used, m.unit)} / {fmt(m.limit, m.unit)}
                            </span>
                          </div>
                          <div className="usage-bar">
                            <div
                              className={
                                "usage-fill" +
                                (pct >= 0.9 ? " hot" : pct >= 0.7 ? " warn" : "")
                              }
                              style={{ width: `${Math.max(pct * 100, pct > 0 ? 1.5 : 0)}%` }}
                            />
                          </div>
                          <div className="usage-reset">{resetLine(m)}</div>
                        </div>
                      );
                    })}
                </div>
              ))}
              <div className="usage-note">
                {report.note} As of {ageMin < 1 ? "just now" : `${ageMin} min ago`}.
              </div>
            </>
          )}
          {frames && (
            <>
              <div className="options-group mono">Card images</div>
              <div className="usage-note usage-frames">
                {frames.orphans.length
                  ? `${frames.orphans.length} stored image${
                      frames.orphans.length === 1 ? "" : "s"
                    } (${formatBytes(frames.bytes)}) ${
                      frames.orphans.length === 1 ? "is" : "are"
                    } not used by any card.`
                  : "Every stored image is still used by a card."}
                {waiting > 0 &&
                  ` ${waiting} image${waiting === 1 ? "" : "s"} from this browser ${
                    waiting === 1 ? "has" : "have"
                  } not reached the shared store yet; they are retried automatically.`}
                {!settled && " Waiting for the shared board before anything can be purged."}
              </div>
              {/* ALWAYS LIVE (owner, 2026-09-01). It was disabled when
                  there was nothing to purge, which read as broken rather
                  than as informative -- and this is now the ONLY door to
                  the sweep, the Boards menu's copy having been removed
                  at the same time. Pressing it with nothing to do says
                  so in the dialog, which is what the Boards menu's
                  button always did. */}
              <button
                className="options-structure-btn"
                onClick={async () => {
                  if (await runReclaim(project)) readFrames();
                }}
              >
                <Eraser size={13} /> Purge unused card images...
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
