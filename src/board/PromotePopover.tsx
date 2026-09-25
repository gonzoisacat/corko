import { useEffect, useRef } from "react";
import { useClampToViewport } from "../ui/useClampToViewport";
import { ChevronsUp, SeparatorHorizontal } from "lucide-react";
import { ops } from "../state/useBoard";
import { promoteMenu, usePromoteMenu } from "./promoteMenu";

/* The Promotion choice popup (see promoteMenu.ts). Same overlay idiom as
 * the Demotion Resolution: rendered once, positioned at the click,
 * Escape or outside-mousedown cancels. */
export function PromotePopover() {
  const menu = usePromoteMenu();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) promoteMenu.close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && promoteMenu.close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // measured, not guessed -- see ui/useClampToViewport
  const w = 252;
  const { left, top } = useClampToViewport(ref, menu?.x ?? 0, menu?.y ?? 0, { w, h: 180 });

  if (!menu) return null;
  const kid = menu.childName.toLowerCase();
  const kids = (n: number) => `${n} ${kid}${n === 1 ? "" : "s"}`;
  const parent = menu.parentTitle ? `"${menu.parentTitle}"` : `this ${menu.parentTierName.toLowerCase()}`;

  return (
    <div ref={ref} className="ctx-menu demote-menu" style={{ left, top, width: w }}>
      <div className="demote-head">
        Promote {menu.title ? `"${menu.title}"` : "this"} to {menu.tierName}?
        <span className="demote-sub">
          It sits mid-{menu.parentTierName.toLowerCase()}: {kids(menu.before)} before it, {menu.after} after.
        </span>
      </div>
      <button
        className="ctx-item"
        onClick={() => {
          ops.promoteNode(menu.nodeId, "split");
          promoteMenu.close();
        }}
      >
        <SeparatorHorizontal size={14} /> Split {parent} -- keep story order
      </button>
      <button
        className="ctx-item"
        onClick={() => {
          ops.promoteNode(menu.nodeId, "after");
          promoteMenu.close();
        }}
      >
        <ChevronsUp size={14} /> Move it after {parent}
      </button>
      <button className="ctx-item" onClick={() => promoteMenu.close()}>
        Cancel
      </button>
    </div>
  );
}
