import { useEffect, useSyncExternalStore } from "react";
import { RotateCw } from "lucide-react";
import { buildWatch, type BuildState } from "../state/buildWatch";

/* ------------------------------------------------------------------ *
 *  WHETHER THIS TAB IS RUNNING THE DEPLOYED BUILD, in the topbar beside
 *  the sync note (owner, 2026-09-10, and the arrangement is his): the
 *  theme switch, then a RELOAD BUTTON, then the light, then the label,
 *  then a divider, then the sync light and label that were already
 *  there. Two lights side by side answering two different questions --
 *  is my work reaching everyone, and am I running what everyone else
 *  is -- which is why they share an idiom and a divider rather than
 *  being folded into one pill.
 *
 *  THE LIGHT IS GREEN AT REST (his call, over an indicator that appears
 *  only when something is wrong). A light that is always lit is also a
 *  claim: it says "you are on the latest version", which is worth
 *  seeing before a demo, and it means a yellow one is a CHANGE in
 *  something already on screen rather than a new object appearing in
 *  the corner where nobody looks.
 *
 *  THE RELOAD BUTTON IS SEPARATE FROM THE LIGHT, also his. The light is
 *  a sign and the button is the control; a stray click on a sign should
 *  never throw away an edit in flight, and the button says what it is
 *  for in its own tip rather than making you guess that the sign is
 *  pressable.
 *
 *  Its words are his, verbatim.
 * ------------------------------------------------------------------ */

const LIGHT_TIP: Record<BuildState, string> = {
  latest: "Latest build loaded",
  update: "Minor update available (reload)",
  critical: "Critical update available (reload ASAP)",
};

/* The label is the state in a word, in the sync note's register --
 * lowercase, mono, the same size as "synced" beside it. */
const LABEL: Record<BuildState, string> = {
  latest: "latest",
  update: "update",
  critical: "reload now",
};

export function BuildStatus() {
  const state = useSyncExternalStore(buildWatch.subscribe, buildWatch.get, () => "latest" as BuildState);
  /* One watch for the tab, started here because this is the only thing
   * that reads it -- and stopped with it, so a hot reload in dev does
   * not leave a second interval behind. */
  useEffect(() => buildWatch.start(), []);

  return (
    <span className="build-status">
      <button
        className="build-reload"
        onClick={() => window.location.reload()}
        aria-label="Reload to update to the latest deployment"
        data-tip="Reload when yellow or red to update to latest deployment"
      >
        <RotateCw size={13} />
      </button>
      {/* The light carries the tip that says what the color MEANS, so
          the two tips divide the same way the controls do: what is
          true, and what you can do about it. */}
      <span
        className={"legend-note mono build-note " + state}
        data-tip={LIGHT_TIP[state]}
        aria-label={LIGHT_TIP[state]}
      >
        <span className="build-dot" /> <span className="build-text">{LABEL[state]}</span>
      </span>
    </span>
  );
}
