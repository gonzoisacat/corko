import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { accessInfo } from "../state/access";
import { CURRENT, RELEASE_NOTES_URL, releaseWatch } from "../state/releaseWatch";
import type { ReleaseStatus as Status } from "../state/releases";

/* ------------------------------------------------------------------ *
 *  THE ADMIN'S UPDATE LIGHT (owner, 2026-10-05: everyone keeps the
 *  deploy light; the admin gets "an additional light", and the usage
 *  panel made more visible). Left of the deploy light, in its idiom --
 *  the same 7px dot, the same mono label, its own divider -- because it
 *  is the same kind of thing answering a third question: is this
 *  INSTANCE on the newest Corko release?
 *
 *  NOT A LIGHT (his pick, 2026-10-05, after asking whether it was
 *  redundant with "latest"): the two answer different questions -- the
 *  deploy light is about YOUR TAB, this is about THIS CORKO -- and three
 *  dots in a row read as three of the same thing. So at rest it is a
 *  quiet "Corko 0.9.5" with no dot, and when a release is out it is a
 *  small BLUE PILL, "Update 0.9.6": news, not a status. Blue, never the
 *  deploy light's yellow or red, which mean a reload fixes things. The
 *  tips name the subject ("This Corko ..."); the deploy light's own
 *  tips are his words verbatim and were left alone. Silent (absent)
 *  while it does not know.
 *
 *  A click opens the panel: the two versions, whether the update asks
 *  everyone to reload together, what changed, how to update both ways a
 *  deployment can be updated, and the usage meters (Cmd+U), which is
 *  the "more visible" -- for the admin, and only from here.
 *
 *  NOBODY ELSE SEES ANY OF IT. A team password's holder has no use for
 *  the news and no way to act on it, and their browser never asks.
 * ------------------------------------------------------------------ */

const LABEL = (s: Status) => (s.kind === "available" ? `Update ${s.latest}` : s.kind === "current" ? `Corko ${s.current}` : "");

export function ReleaseStatus({ onUsage }: { onUsage: () => void }) {
  const admin = !!accessInfo()?.admin;
  const status = useSyncExternalStore(releaseWatch.subscribe, releaseWatch.get, releaseWatch.get);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (admin) releaseWatch.start();
  }, [admin]);

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

  if (!admin || status.kind === "unknown") return null;
  const tip =
    status.kind === "available"
      ? `Corko ${status.latest} is out. This Corko runs ${status.current}.`
      : `This Corko is on the newest release, ${status.current}`;

  return (
    <span className="release-status" ref={ref}>
      <button
        className={"release-note legend-note mono " + status.kind + (open ? " open" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-label={tip}
        aria-expanded={open}
        data-tip={open ? undefined : tip}
      >
        <span className="release-text">{LABEL(status)}</span>
      </button>
      {open && (
        <div className="fold-menu-pop release-pop" role="dialog" aria-label="Corko version">
          {status.kind === "available" ? (
            <>
              <div className="release-title">Corko {status.latest} is available</div>
              <div className="release-line">This instance runs {status.current}.</div>
              <div className={"release-kind" + (status.coordinated ? " coordinated" : "")}>
                {status.coordinated
                  ? "This update needs everyone to reload together once it is deployed."
                  : "An ordinary update: open tabs can reload when it suits them."}
              </div>
              <div className="release-head">What changed</div>
              <div className="release-notes">
                {status.entries.map((e) => (
                  <pre key={e.version} className="release-entry">
                    {e.text.replace(/^## /, "")}
                  </pre>
                ))}
              </div>
              <div className="release-head">How to update</div>
              <ul className="release-how">
                <li>
                  <b>Deployed with one click:</b> on GitHub, open your copy of Corko, then Actions, Update Corko,
                  Run workflow.
                </li>
                <li>
                  <b>From the command line:</b> <code>git pull</code>, <code>npm install</code>, <code>npm run deploy</code>.
                </li>
              </ul>
              <div className="release-line">Export your project first, from the Boards menu.</div>
            </>
          ) : (
            <>
              <div className="release-title">Corko {status.current}</div>
              <div className="release-line">This instance runs the newest release.</div>
            </>
          )}
          <div className="release-actions">
            <a className="pane-btn release-link" href={RELEASE_NOTES_URL} target="_blank" rel="noreferrer">
              Release notes
            </a>
            <button
              className="pane-btn"
              onClick={() => {
                setOpen(false);
                onUsage();
              }}
            >
              Usage meters
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

/* the build's own version, for anything that wants to say it */
export const corkoVersion = CURRENT;
