import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { accessInfo, clearKey, storedKey } from "../state/access";
import { ops } from "../state/useBoard";
import { projectId, slugify, stashTitle, switchProject } from "../state/project";

/* ------------------------------------------------------------------ *
 *  THE PROJECT NAME IS THE SWITCHER (owner, 2026-09-02).
 *
 *  Topbar: [Corko] [PROJECT NAME:] [the current project's name v]. One
 *  dropdown, holding the projects this key opens (their names, the one
 *  you are in marked), a separator, then the project options. No icon;
 *  the slug in the URL is the room's id, the same kind of thing as a
 *  board id, and shows only for a project nobody has named yet.
 *
 *  A project is a room is a doc is a password scope (worker/access.ts).
 *  What the list holds is what /projects answered: for the deployer
 *  ("*"), every project the access map names plus every one set up from
 *  here; for anyone else, their own. Switching is a RELOAD with `?p=`
 *  set -- the doc, the undo manager and the sync provider are singletons
 *  built for one room -- and one project at a time is the shape chosen,
 *  two open at once deferred.
 *
 *  SETTING UP A PROJECT is the deployer's alone: the menu offers it only
 *  on a "*" key, the Worker refuses it on any other, and the app says
 *  out loud that a TEAM's way in is still the access map, which only the
 *  deployer can edit. The name typed here rides across the reload
 *  (state/project.ts stashTitle) and lands in the new, empty doc.
 * ------------------------------------------------------------------ */

interface Row {
  id: string;
  title: string;
  boards: number;
  touched: number | null;
}

function ago(t: number | null): string {
  if (t === null) return "never saved";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const keyed = (path: string) => {
  const k = storedKey();
  return `${path}${k ? `?k=${encodeURIComponent(k)}` : ""}`;
};

export function ProjectsMenu({ title }: { title: string }) {
  const info = accessInfo();
  const admin = !!info?.admin;
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [setup, setSetup] = useState(false);
  const [settings, setSettings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const names = info?.projects ?? [projectId];

  useEffect(() => {
    if (!open) return;
    setRows(null);
    let dead = false;
    fetch(keyed("/projects"), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((v: { projects: Row[] }) => {
        if (!dead) setRows(v.projects);
      })
      .catch(() => {
        /* the names from /auth stand in; stats are a nicety */
      });
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      dead = true;
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const listed: Row[] =
    rows ?? names.map((id) => ({ id, title: id === projectId ? title : "", boards: 0, touched: null }));
  const current: Row = listed.find((p) => p.id === projectId) ?? { id: projectId, title, boards: 0, touched: null };
  const others = listed.filter((p) => p.id !== projectId);
  const [picked, setPicked] = useState<string | null>(null);
  /* An unnamed project shows its slug, as its row does -- the one moment
   * the slug is the only handle there is (a team landing in a fresh
   * project read "Untitled project" and could not tell where they were;
   * owner, 2026-09-02). */
  const label = title || projectId;

  return (
    <div className="fold-menu project-switch" ref={ref}>
      <button
        className={"pane-btn fold-btn project-switch-btn" + (open ? " active" : "")}
        aria-label="Project"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={title ? "" : "projects-id"}>{label}</span>
        <ChevronDown size={12} className="fold-caret" />
      </button>
      {open && (
        <div className="fold-menu-pop projects-pop">
          {/* CURRENT PROJECT, then OTHER PROJECTS (owner, 2026-09-04):
              the one you are in and its settings, a rule, then the ones
              you could be in -- double-click opens, as a board on the
              shelf does. Set up and Sign out close the list. */}
          <div className="options-group mono">Current project</div>
          <div className="fold-menu-item projects-row active">
            <span className={current.title ? "projects-title" : "projects-id"}>{current.title || current.id}</span>
            {rows && (
              <span className="projects-meta">
                {current.boards} board{current.boards === 1 ? "" : "s"} · {ago(current.touched)}
              </span>
            )}
          </div>
          <button
            className="fold-menu-item"
            onClick={() => {
              setOpen(false);
              setSettings(true);
            }}
          >
            Project/Share settings...
          </button>
          {others.length > 0 && (
            <>
              <div className="fold-menu-sep" />
              <div className="options-group mono">Other projects</div>
              {others.map((p) => (
                <button
                  key={p.id}
                  className={"fold-menu-item projects-row" + (picked === p.id ? " picked" : "")}
                  aria-label={`Open ${p.title || p.id} (double-click)`}
                  onClick={() => setPicked(p.id)}
                  onDoubleClick={() => {
                    setOpen(false);
                    switchProject(p.id, { splash: false });
                  }}
                >
                  <span className={p.title ? "projects-title" : "projects-id"}>{p.title || p.id}</span>
                  {rows && (
                    <span className="projects-meta">
                      {p.boards} board{p.boards === 1 ? "" : "s"} · {ago(p.touched)}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}
          {(admin || info?.required) && <div className="fold-menu-sep" />}
          {admin && (
            <button
              className="fold-menu-item"
              onClick={() => {
                setOpen(false);
                setSetup(true);
              }}
            >
              Set up new project...
            </button>
          )}
          {info?.required && (
            <button
              className="fold-menu-item"
              onClick={() => {
                clearKey();
                location.reload();
              }}
            >
              Sign out
            </button>
          )}
        </div>
      )}
      {setup && <NewProjectDialog onClose={() => setSetup(false)} />}
      {settings && <ProjectSettingsDialog title={title} admin={admin} onClose={() => setSettings(false)} />}
    </div>
  );
}

/* SET UP A NEW PROJECT, in the settings dialog's own shape (owner,
 * 2026-09-04): PROJECT NAME, then SHARING SETTINGS always open, holding
 * a LINK PREVIEW of what the address will be for the name as typed, and
 * the "Password protected?" switch with the password field (eye, no Set
 * -- the password rides with the creation). Registers the id with the
 * Worker (deployer only), stashes the name for the empty room to take,
 * and switches straight there, splash and all -- a first arrival. */
function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [protectedOn, setProtectedOn] = useState(false);
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const slug = slugify(name);
  const taken = slug === projectId || slug === "default";
  const preview = (() => {
    const u = new URL(location.href);
    u.search = slug ? `?p=${slug}` : "";
    u.hash = "";
    return u.toString();
  })();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const create = async () => {
    if (!slug || taken || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(keyed("/projects"), {
        method: "POST",
        body: JSON.stringify({ id: slug, password: protectedOn ? password.trim() : "" }),
      });
      if (!r.ok) throw new Error(String(r.status));
      stashTitle(slug, name.trim());
      onClose();
      switchProject(slug);
    } catch {
      setError("The server did not register it. Check your connection and that this key is the deployer's.");
      setBusy(false);
    }
  };

  return (
    <div
      className="confirm-backdrop project-settings-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="confirm-panel project-settings" role="dialog" aria-modal="true" aria-label="Set up a new project">
        <div className="confirm-title">Set up a new project</div>
        <div className="confirm-body">
          <div className="options-group mono">Project name</div>
          <input
            className="gate-input project-name-input"
            value={name}
            autoFocus
            placeholder="Project name"
            aria-label="Project name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
          />

          <div className="options-group mono project-section-head">Sharing settings</div>
          <div className="project-sharing">
            <div className="options-row project-protect-row">
              <span>Link preview</span>
            </div>
            <div className="project-address">
              <span className="project-address-url mono">
                {slug ? preview : taken ? "That name is already a project." : "Type a name to see its address."}
              </span>
            </div>
            <div className="options-row project-protect-row">
              <span>Password protected?</span>
              <button
                className={"switch" + (protectedOn ? " on" : "")}
                role="switch"
                aria-checked={protectedOn}
                aria-label="Password protected"
                onClick={() => setProtectedOn((v) => !v)}
              >
                <span className="switch-knob" />
              </button>
            </div>
            {protectedOn && (
              <div className="project-password-row">
                <span className="project-password-field">
                  <input
                    className="gate-input project-name-input"
                    type={shown ? "text" : "password"}
                    value={password}
                    placeholder="Password"
                    aria-label="Team password"
                    autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void create();
                      }
                    }}
                  />
                  <button
                    className="project-eye"
                    aria-label={shown ? "Hide password" : "Show password"}
                    data-tip={shown ? "Hide" : "Show"}
                    onClick={() => setShown((v) => !v)}
                  >
                    {shown ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </span>
              </div>
            )}
            <div className="project-slug-line">
              {protectedOn
                ? "Anyone with both this link and password can view and edit the boards in this project."
                : "Anyone with this sharing link can view and edit the boards in this project."}
            </div>
            {error && <div className="gate-error" role="alert">{error}</div>}
          </div>
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="confirm-btn confirm-go"
            disabled={!slug || taken || busy || (protectedOn && !password.trim())}
            onClick={() => void create()}
          >
            {busy ? "Setting up..." : "Set up"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  PROJECT / SHARE SETTINGS -- the room's own door (owner's spec,
 *  2026-09-02). PROJECT NAME first; then SHARING SETTINGS, collapsed
 *  every time the dialog opens, holding the SHARABLE LINK and a
 *  "Password protected?" switch. Off: just the switch and a line saying
 *  the link alone is enough. On: the password field (obscured by
 *  default, an eye to show it), Set, and Copy -- which copies the
 *  password even while obscured, once one is set. The switch turning
 *  OFF clears the password on the server, since that is what "not
 *  protected" means. Everyone sees the name and the link; the switch
 *  and the password are the deployer's.
 * ------------------------------------------------------------------ */
function ProjectSettingsDialog({ title, admin, onClose }: { title: string; admin: boolean; onClose: () => void }) {
  const [name, setName] = useState(title);
  const [sharing, setSharing] = useState(false); // collapsed on every open
  const [has, setHas] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [protectedOn, setProtectedOn] = useState(false);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState<"link" | "password" | null>(null);
  const address = (() => {
    const u = new URL(location.href);
    u.search = projectId === "default" ? "" : `?p=${projectId}`;
    u.hash = "";
    return u.toString();
  })();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    if (!admin) return;
    let dead = false;
    fetch(keyed(`/projects/${encodeURIComponent(projectId)}/password`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((v: { hasPassword: boolean; password: string }) => {
        if (dead) return;
        setHas(v.hasPassword);
        setProtectedOn(v.hasPassword);
        setPassword(v.password ?? "");
      })
      .catch(() => {
        if (!dead) setHas(null);
      });
    return () => {
      dead = true;
    };
  }, [admin]);

  const write = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setNote("");
    try {
      const r = await fetch(keyed(`/projects/${encodeURIComponent(projectId)}/password`), {
        method: "PUT",
        body: JSON.stringify({ password: value }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setHas(!!value);
      if (!value) setPassword("");
      setNote(value ? "Password set." : "Password cleared.");
    } catch {
      setNote("The server did not take it. Check your connection and that this key is the deployer's.");
    } finally {
      setBusy(false);
    }
  };

  const copy = (what: "link" | "password", text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(what));
  };

  const save = () => {
    if (name.trim() !== title) ops.setProjectTitle(name.trim());
    onClose();
  };

  return (
    <div
      className="confirm-backdrop project-settings-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="confirm-panel project-settings" role="dialog" aria-modal="true" aria-label="Project settings">
        <div className="confirm-title">Project settings</div>
        <div className="confirm-body">
          <div className="options-group mono">Project name</div>
          <input
            className="gate-input project-name-input"
            value={name}
            autoFocus
            placeholder="Project name"
            aria-label="Project name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
          />

          <button
            className="options-group mono project-section-toggle"
            aria-expanded={sharing}
            onClick={() => setSharing((o) => !o)}
          >
            {sharing ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Sharing settings
          </button>

          {sharing && (
            <div className="project-sharing">
              {/* Same row idiom as "Password protected?" below (owner,
                  2026-09-02): the label at 13px with its control at the
                  right, the link itself on the line under. */}
              <div className="options-row project-protect-row">
                <span>Sharable link</span>
                <button className="confirm-btn" onClick={() => copy("link", address)}>
                  {copied === "link" ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="project-address">
                <span className="project-address-url mono">{address}</span>
              </div>

              {admin ? (
                <>
                  <div className="options-row project-protect-row">
                    <span>Password protected?</span>
                    <button
                      className={"switch" + (protectedOn ? " on" : "")}
                      role="switch"
                      aria-checked={protectedOn}
                      aria-label="Password protected"
                      disabled={busy || has === null}
                      onClick={() => {
                        if (protectedOn) {
                          setProtectedOn(false);
                          setShown(false);
                          if (has) void write("");
                        } else {
                          setProtectedOn(true);
                        }
                      }}
                    >
                      <span className="switch-knob" />
                    </button>
                  </div>
                  {protectedOn && (
                    <div className="project-password-row">
                      <span className="project-password-field">
                        <input
                          className="gate-input project-name-input"
                          type={shown ? "text" : "password"}
                          value={password}
                          placeholder="Password"
                          aria-label="Team password"
                          autoComplete="new-password"
                          onChange={(e) => setPassword(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && password.trim()) {
                              e.preventDefault();
                              void write(password.trim());
                            }
                          }}
                        />
                        <button
                          className="project-eye"
                          aria-label={shown ? "Hide password" : "Show password"}
                          data-tip={shown ? "Hide" : "Show"}
                          onClick={() => setShown((v) => !v)}
                        >
                          {shown ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </span>
                      <button
                        className="confirm-btn"
                        disabled={busy || !password.trim()}
                        onClick={() => void write(password.trim())}
                      >
                        Set
                      </button>
                      <button
                        className="confirm-btn"
                        disabled={!has || !password}
                        onClick={() => copy("password", password)}
                      >
                        {copied === "password" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  )}
                  <div className="project-slug-line">
                    {protectedOn
                      ? "Anyone with both this link and password can view and edit the boards in this project."
                      : "Anyone with this sharing link can view and edit the boards in this project."}
                    {protectedOn && has && !password && " A password is set that this deployment cannot show; set a new one to be able to copy it."}
                  </div>
                  {note && <div className="project-slug-line">{note}</div>}
                </>
              ) : (
                <div className="project-slug-line">Sharing is set by whoever runs this Corko.</div>
              )}
            </div>
          )}
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="confirm-btn confirm-go" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
