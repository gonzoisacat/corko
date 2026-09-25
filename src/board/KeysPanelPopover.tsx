import { FloatPanel } from "../ui/FloatPanel";
import { KEYS_W, keysPanel, useKeysPanel } from "./keysPanel";

/* ------------------------------------------------------------------ *
 *  The keyboard-shortcut legend: a floating panel you PARK. Toggled with
 *  `?` (and closed by it, or the X/Done). Deliberately sticky -- it
 *  ignores the usual click-outside close, and keyNav's overlay guard
 *  excludes it -- because its whole point is to sit open while you try
 *  the keys it lists. Content is static markup: the source of truth is
 *  keyNav.ts, and this panel must be updated with it (grep: keys-panel).
 * ------------------------------------------------------------------ */

/* `does` takes a LIST when one key does different things in the two board
 * views (Enter): one line each, rather than a sentence with a comma in
 * it that the reader has to unpack. */
function Row({ k, does }: { k: string; does: string | string[] }) {
  return (
    <div className="keys-row">
      <span className="keys-keys">
        {k.split(" / ").map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="keys-or">/</span>}
            <kbd>{part}</kbd>
          </span>
        ))}
      </span>
      <span className="keys-does">
        {(Array.isArray(does) ? does : [does]).map((line, i) => (
          <span key={i} className="keys-line">
            {line}
          </span>
        ))}
      </span>
    </div>
  );
}

export function KeysPanelPopover() {
  const open = useKeysPanel();
  if (!open) return null;
  return (
    <FloatPanel
      title="Keyboard"
      className="keys-panel"
      x={open.x}
      y={open.y}
      width={KEYS_W}
      onMove={keysPanel.moveTo}
      onClose={keysPanel.close}
      sticky
      passive
      done
    >
      {/* Only the keys you drive the BOARD with (owner's edit, 2026-08-02).
          Home/End, Escape, the card menu's own walk, the in-place editing
          keys and the undo pair all still work -- they are either muscle
          memory everyone already has or covered by a hover tooltip, and
          listing them buried the seven that aren't. */}
      <div className="options-group mono">Board</div>
      <Row k="Arrows" does="Select surrounding cards" />
      <Row k="Shift + Arrows" does="Extend selection (same tier only)" />
      <Row k="Enter" does={["Edit text (Detail mode)", "Jump to Detail (Overview mode)"]} />
      <Row k="Space" does="Open card menu" />
      <Row k="Delete" does="Delete selected card" />
      <Row k="N" does="Open Notes panel on card" />
      <Row k="M" does="Open Metadata panel on card(s)" />
      <Row k="Cmd/Ctrl + C / X / V" does="Copy, cut, paste cards" />
      {/* Not keyboard shortcuts, but they are modifiers nobody would find
          on their own, and this is the panel people open to look. */}
      <Row k="Hold Space + drag" does="Pan the board" />
      <Row k="Ctrl + wheel" does="Zoom, centered on the pointer" />
      <Row k="Option + drag" does="Duplicate instead of move" />
      <Row k="Option + Arrows" does="Nudge grid cards a cell" />
      <Row k="Esc (mid-drag)" does="Abandon the drag" />
    </FloatPanel>
  );
}
