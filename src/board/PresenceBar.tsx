import { useLocalUser, usePresence, useSyncStatus } from "../state/sync";

/* Who's here, as colored initial-chips (spec Sec 7). The local user comes
 * first with a "you" ring; remote peers follow. Sits in the top bar.
 *
 * THE PILE (owner, 2026-09-04): a narrow window collapses the peers'
 * chips into one stacked chip carrying their count -- the first thing
 * the topbar sheds, before Usage. Both forms are rendered and the media
 * query in index.css picks, so the swap costs no React work; the pile
 * carries every name as its tip. */
export function PresenceBar() {
  const me = useLocalUser();
  const peers = usePresence();
  if (peers.length === 0) {
    // Solo: a single quiet chip, no need to shout.
    return (
      <div className="presence" title={`${me.name} (you)`}>
        <span className="avatar self" style={{ background: me.color }}>
          {me.name[0]}
        </span>
      </div>
    );
  }
  const names = peers.map((p) => p.name).join(", ");
  return (
    <div className="presence">
      <span className="avatar self" style={{ background: me.color }} title={`${me.name} (you)`}>
        {me.name[0]}
      </span>
      {peers.map((p) => (
        <span
          key={p.clientId}
          className="avatar peer"
          style={{ background: p.color }}
          title={p.focusId ? `${p.name} -- editing` : p.name}
        >
          {p.name[0]}
        </span>
      ))}
      <span className="presence-pile" aria-label={names} data-tip={names}>
        {/* two ghost disks behind, in the last two peers' colors, so the
            stack reads as people rather than a counter */}
        {peers.slice(-2).map((p, i) => (
          <span key={p.clientId} className={"avatar ghost g" + i} style={{ background: p.color }} />
        ))}
        <span className="avatar count">+{peers.length}</span>
      </span>
    </div>
  );
}

/* Live sync state for the legend strip -- replaces the static
 * "saved to this browser" note. Offline still means fully usable
 * (IndexedDB); connection is an enhancement, not a requirement.
 * The count ("6 here") is its own span: the pile carries the number
 * once the window is narrow, so it goes with the chips it counts. */
export function SyncStatusNote() {
  const status = useSyncStatus();
  const peers = usePresence();
  const count =
    status === "connected" ? (peers.length > 0 ? `${peers.length + 1} here` : "just you") : null;
  const text =
    status === "connected" ? "synced" : status === "connecting" ? "connecting..." : "offline · saved to this browser";
  return (
    <span className={"legend-note mono sync-note " + status}>
      <span className="sync-dot" /> <span className="sync-text">{text}</span>
      {count && <span className="sync-count"> · {count}</span>}
    </span>
  );
}
