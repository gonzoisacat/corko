import { useEffect, useRef, useState } from "react";
import { useClampToViewport } from "../ui/useClampToViewport";
import { ops } from "../state/useBoard";
import { editCard } from "./autoEdit";
import { demoteMenu, useDemoteMenu } from "./demoteMenu";

/* The Demotion dialog (see demoteMenu.ts): every choice in one place,
 * because the card menu carries a single "Demote to <tier>..." entry.
 * Two small radio groups -- WHERE it lands, and (when leaf content is
 * displaced) what happens to it -- then one Demote button. Same overlay
 * idiom as the card menu: Escape or outside-mousedown cancels. */
export function DemotePopover() {
  const menu = useDemoteMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [into, setInto] = useState<"neighbor" | "wrap">("neighbor");
  const [leaves, setLeaves] = useState<"stow" | "delete">("stow");

  // defaults re-arm per opening: neighbour when there is one, stow always
  const openedFor = menu?.nodeId ?? null;
  useEffect(() => {
    if (!openedFor) return;
    setInto(demoteMenu.get()?.neighborTitle != null ? "neighbor" : "wrap");
    setLeaves("stow");
  }, [openedFor]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) demoteMenu.close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && demoteMenu.close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // measured, not guessed -- see ui/useClampToViewport
  const w = 248;
  const { left, top } = useClampToViewport(ref, menu?.x ?? 0, menu?.y ?? 0, { w, h: 230 });

  if (!menu) return null;
  const noun = (menu.leafName || "card").toLowerCase() + (menu.count === 1 ? "" : "s");

  const go = () => {
    const r = ops.demoteNode(menu.nodeId, leaves, into);
    if (r.wrapper) editCard(r.wrapper); // a minted container needs a name
    demoteMenu.close();
  };

  return (
    <div ref={ref} className="ctx-menu demote-menu" style={{ left, top, width: w }}>
      <div className="demote-head">
        Demote {menu.title ? `"${menu.title}"` : "this"} to {menu.tierName}?
      </div>

      {menu.neighborTitle != null ? (
        <div className="demote-group">
          <label className="demote-opt">
            <input
              type="radio"
              name="demote-into"
              checked={into === "neighbor"}
              onChange={() => setInto("neighbor")}
            />
            Into {menu.neighborTitle ? `"${menu.neighborTitle}"` : `the ${menu.neighborDir} one`}
          </label>
          <label className="demote-opt">
            <input
              type="radio"
              name="demote-into"
              checked={into === "wrap"}
              onChange={() => setInto("wrap")}
            />
            Into a new {menu.childName}
          </label>
        </div>
      ) : (
        <div className="demote-note">
          A new untitled {menu.childName} will hold it, right where it is.
        </div>
      )}

      {menu.count > 0 && (
        <div className="demote-group">
          <div className="demote-note">
            {menu.count} {noun} can't stay at their tier:
          </div>
          <label className="demote-opt">
            <input
              type="radio"
              name="demote-leaves"
              checked={leaves === "stow"}
              onChange={() => setLeaves("stow")}
            />
            Stow them (promote brings them back)
          </label>
          <label className="demote-opt">
            <input
              type="radio"
              name="demote-leaves"
              checked={leaves === "delete"}
              onChange={() => setLeaves("delete")}
            />
            Delete them
          </label>
        </div>
      )}

      <div className="demote-actions">
        <button className="ctx-item demote-go" onClick={go}>
          Demote
        </button>
        <button className="ctx-item" onClick={() => demoteMenu.close()}>
          Cancel
        </button>
      </div>
    </div>
  );
}
