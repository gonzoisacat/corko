import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AccessGate, AdminSetup, ProjectChooser } from "./ui/AccessGate";
import { projectId, switchProject, takeSkipSplash } from "./state/project";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { SplashIntro } from "./ui/SplashIntro";
import { installLayoutDoctor } from "./ui/layoutDoctor";
import { checkAccess, setupSkipped, skipSetup, storedKey, type AccessState } from "./state/access";
import { chooseBlobStore } from "./state/blobStore";
import { settingsFor } from "./state/settings";
import "./index.css";

// dev-only console diagnostics (corko.doctor / corko.zoneAt); tree-shaken out
// of a production build by the constant condition
if (import.meta.env.DEV) installLayoutDoctor();

/* Ask the server about the access password BEFORE mounting the app.
 *
 * Order matters: App joins the sync room on mount, and a socket the server
 * refuses cannot say why -- it just retries, leaving the board stuck on
 * "Waiting for the shared board..." forever. So the gate resolves first and
 * the app only boots once the key is good (or none is needed).
 *
 * `null` = still asking. It is one round trip to our own origin, so this
 * renders nothing rather than flashing a spinner on every single load. */
function Root() {
  const [access, setAccess] = useState<AccessState | null>(null);
  /* The boot splash rides OVER whatever the boot is doing -- the /auth
   * round trip, the gate, the app joining its room -- so the load time
   * hides under the take instead of showing a blank frame. A click or
   * Escape skips it; prefers-reduced-motion never mounts it.
   *
   * "Boot animation: Off" (Options) never mounts it either -- read once,
   * since the setting can only matter at boot. */
  const [splash, setSplash] = useState(() => !takeSkipSplash() && settingsFor("").splash !== "off");
  /* THE PROJECT THIS TAB ASKED FOR MAY NOT BE ONE THE KEY OPENS: a
   * bookmark to a project the password has since lost, a team member's
   * first visit landing on `default`. One project the key does open
   * means go there; several means ask (ProjectChooser); the key opening
   * this one means carry on. Returns whether the boot may continue. */
  const [choose, setChoose] = useState<string[] | null>(null);
  /* The Admin setup card, skipped in this browser (state/access.ts). */
  const [skipped, setSkipped] = useState(setupSkipped);
  const settle = (a: AccessState): boolean => {
    /* A "*" key opens ANY project-shaped room -- including one set up
     * from the app a moment ago that the access map does not name yet --
     * so the deployer is never asked. */
    if (!a.ok || a.admin || !a.projects || a.projects.includes(projectId)) return true;
    if (a.projects.length === 1) {
      switchProject(a.projects[0]);
      return false;
    }
    setChoose(a.projects);
    return false;
  };
  useEffect(() => {
    void checkAccess().then((a) => {
      setAccess(a);
      if (!settle(a)) return;
      /* Shared stills, if this deployment has a bucket (Phase C). Asked
       * AFTER the gate resolves because the probe carries the same key,
       * and deliberately not awaited -- nothing about the boot waits for
       * a picture, and local is the safe answer to every failure.
       *
       * ONLY when this boot's key is already good: with the gate still
       * locked the probe is a guaranteed 401, and settling on "local"
       * then would stick for the whole session -- the unlock path below
       * re-asks once the person has typed the password, or every fresh
       * browser on a gated deployment would silently never share. */
      if (a.ok) void chooseBlobStore(storedKey);
    });
  }, []);

  /* `access.required` decides the gate; it just no longer draws anything
   * when it's false. There WAS an "Unprotected" badge here -- removed at
   * the owner's request. Worth knowing what that costs: the server fails
   * OPEN when no CORKO_PASSWORD is set (so that shipping the gate could
   * never lock someone out of their own instance), and nothing in the UI
   * says so any more. `GET /auth` reports it. */
  return (
    <>
      {access &&
        (access.required && !access.ok ? (
          <AccessGate
            onUnlocked={(a) => {
              setAccess(a);
              if (!settle(a)) return;
              /* The key only just became good, so the store choice runs
               * NOW rather than at boot (where it would have met a 401). */
              void chooseBlobStore(storedKey);
            }}
          />
        ) : access.setup && !skipped ? (
          <AdminSetup
            onDone={(a) => {
              setAccess(a);
              if (!settle(a)) return;
              void chooseBlobStore(storedKey);
            }}
            onSkip={() => {
              skipSetup();
              setSkipped(true);
            }}
          />
        ) : choose ? (
          <ProjectChooser projects={choose} />
        ) : (
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        ))}
      {splash && <SplashIntro onDone={() => setSplash(false)} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
