import { useState } from "react";
import { checkAccess, storeKey, type AccessState } from "../state/access";
import { switchProject } from "../state/project";
import { CorkoMark } from "./CorkoMark";

/* ------------------------------------------------------------------ *
 *  The password screen.
 *
 *  Shown INSTEAD of the app when the server says a password is required
 *  and the key this browser holds doesn't satisfy it. It gates the UI, but
 *  the real gate is the Worker refusing the sync socket -- so getting past
 *  this screen by other means would buy an empty board, not the project.
 *
 *  It deliberately renders before anything connects. The alternative --
 *  letting the app boot and fail to sync -- is exactly the failure that
 *  looked like a hang on 2026-08-01: a refused connection with no way to
 *  say why leaves you on "Waiting for the shared board..." forever.
 * ------------------------------------------------------------------ */

/* Which project to open, when the key opens several and none of them is
 * the one this tab was pointed at. Same card as the password, because it
 * is the same moment: you are at the door, and the door has more than one
 * room behind it. Picking is a reload with `?p=` set. */
export function ProjectChooser({ projects }: { projects: string[] }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">
          <CorkoMark size={34} egg={false} />
          <span className="gate-wordmark">Corko</span>
        </div>
        <h1 className="gate-title">Which project?</h1>
        <p className="gate-sub">Your password opens these</p>
        <div className="gate-projects">
          {projects.map((p) => (
            <button key={p} className="gate-btn" type="button" onClick={() => switchProject(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AccessGate({ onUnlocked }: { onUnlocked: (state: AccessState) => void }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "wrong">("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value || state === "checking") return;
    setState("checking");
    const res = await checkAccess(value);
    if (res.ok) {
      storeKey(value);
      onUnlocked(res);
    } else {
      setState("wrong");
    }
  };

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="gate-brand">
          {/* clickable for the color shuffle, but egg-less: the flyby is a
              joke for people who are IN, not a greeting at the door */}
          <CorkoMark size={34} egg={false} />
          <span className="gate-wordmark">Corko</span>
        </div>
        <h1 className="gate-title">Welcome to Corko!</h1>
        <p className="gate-sub">Please enter your access password</p>
        <input
          className={"gate-input" + (state === "wrong" ? " wrong" : "")}
          type="password"
          value={value}
          autoFocus
          aria-label="Access password"
          aria-invalid={state === "wrong"}
          placeholder="Password"
          onChange={(e) => {
            setValue(e.target.value);
            if (state === "wrong") setState("idle"); // clear the error as they retype
          }}
        />
        {state === "wrong" && (
          <div className="gate-error" role="alert">
            That password didn't work. Try again.
            {/* WHO CAN HELP, said at the moment it is needed (owner,
                2026-09-02). A team password is reissued by whoever runs
                the deployment; the deployer's own is reset from their
                Cloudflare account -- there is no email or question to
                fall back on, and that is by design. */}
            <span className="gate-help">
              Forgotten? Whoever runs this Corko can set a new one. If that is you, it is one command from
              your Cloudflare account -- see the deploy guide.
            </span>
          </div>
        )}
        <button className="gate-btn" type="submit" disabled={!value || state === "checking"}>
          {state === "checking" ? "Checking..." : "Enter"}
        </button>
      </form>
    </div>
  );
}
