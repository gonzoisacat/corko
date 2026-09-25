import { useEffect, useRef } from "react";
import { useClampToViewport } from "../ui/useClampToViewport";
import { Plus, CornerDownLeft } from "lucide-react";
import { ops } from "../state/useBoard";
import { addCardAt } from "./autoEdit";
import { insertMenu, useInsertMenu } from "./insertMenu";

/* Right-click menu for the beat-strip "+" / "-" controls. Rendered once
 * (hoisted in App). "Add <leaf>" inserts at the control's position;
 * create/remove row break toggles breakAfter on the relevant beat. */
export function InsertMenuPopover() {
  const menu = useInsertMenu();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) insertMenu.close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && insertMenu.close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // measured, not guessed -- see ui/useClampToViewport
  const w = 172;
  const { left, top } = useClampToViewport(ref, menu?.x ?? 0, menu?.y ?? 0, { w, h: 76 });

  if (!menu) return null;
  const { parentId, index, childName, breakId, broken } = menu;

  return (
    <div ref={ref} className="ctx-menu insert-menu" style={{ left, top, width: w }}>
      <button
        className="ctx-item"
        onClick={() => {
          addCardAt(parentId, index);
          insertMenu.close();
        }}
      >
        <Plus size={14} /> Add {childName.toLowerCase()}
      </button>
      {breakId && (
        <button
          className="ctx-item"
          onClick={() => {
            ops.toggleBreak(breakId);
            insertMenu.close();
          }}
        >
          <CornerDownLeft size={14} /> {broken ? "Remove row break" : "Create row break"}
        </button>
      )}
    </div>
  );
}
