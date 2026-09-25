import { Component, type ReactNode } from "react";

/* ------------------------------------------------------------------ *
 *  Last-resort crash screen. Without it, a render crash on bad data is
 *  a white page that PERSISTS across reloads (the offending state lives
 *  in IndexedDB and re-syncs from peers), with no way out short of
 *  clearing site data by hand. Two escape hatches:
 *
 *   - Reload: for transient crashes.
 *   - Reset this browser's copy: deletes the local IndexedDB doc and
 *     reloads. If a sync server is reachable the board comes back from
 *     there (or from any peer); only the local replica is dropped.
 * ------------------------------------------------------------------ */

const DB_NAME = "corko-board-v2"; // keep in sync with ydoc.ts

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private reset = () => {
    try {
      indexedDB.deleteDatabase(DB_NAME);
    } catch {
      /* proceed to reload regardless */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ maxWidth: 560, margin: "80px auto", fontFamily: "system-ui, sans-serif", color: "#2a2d33" }}>
        <h1 style={{ fontSize: 20 }}>Corko hit an error it couldn't recover from.</h1>
        <p style={{ lineHeight: 1.5 }}>
          Reloading usually fixes it. If the crash comes right back, the board data saved in this
          browser may be damaged -- resetting drops only this browser's copy; a synced board
          reloads from the server or your collaborators.
        </p>
        <pre
          style={{
            background: "#f4f3ef",
            border: "1px solid #ddd",
            borderRadius: 6,
            padding: 10,
            fontSize: 12,
            overflowX: "auto",
          }}
        >
          {String(this.state.error?.stack ?? this.state.error)}
        </pre>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.location.reload()} style={{ padding: "6px 14px" }}>
            Reload
          </button>
          <button onClick={this.reset} style={{ padding: "6px 14px" }}>
            Reset this browser's copy...
          </button>
        </div>
      </div>
    );
  }
}
