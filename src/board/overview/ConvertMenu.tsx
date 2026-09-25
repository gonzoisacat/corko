import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { TypeIcon } from "../typeIcons";

/* CONVERT BOARD TYPE (owner, 2026-09-11): the Overview's conversion
 * door, at the RIGHT end of the toolbar and apart from the view
 * controls -- "right justified, away from the other stuff" -- as a
 * DROPDOWN rather than a button, because a Free Grid is the first
 * target and not the last ("we may add columns later as an option").
 * The helper text at the top is his sentence, verbatim, and it is the
 * promise every target has to keep: the OVERVIEW's current layout (its
 * column tier and detail level, which are this toolbar's own numbers)
 * becomes the board type picked, as a NEW board, and that board opens
 * IN A NEW PANE: the other pane of a split, or a split opened for it
 * with the copy on the right (App's nestActions.beside, the same rule a
 * nested board's "beside" answer uses).
 * The pop hangs from the right edge, since the control sits at the
 * toolbar's right and a left-anchored pop would run off the pane.
 * Same open/close shape as ProjectsMenu's fold menu: a click outside or
 * Escape closes it. */
export function ConvertMenu({ onFreeGrid }: { onFreeGrid: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="fold-menu ov-convert" ref={ref}>
      <button
        className={"ov-fit-btn fold-btn ov-convert-btn" + (open ? " active" : "")}
        aria-label="Convert board type"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Convert board type
        <ChevronDown size={12} className="fold-caret" />
      </button>
      {open && (
        <div className="fold-menu-pop ov-convert-pop">
          <div className="fold-menu-help">
            This will convert your current overview layout to the type of board selected and open that new
            board in a new pane
          </div>
          <div className="fold-menu-sep" />
          <button
            className="fold-menu-item"
            onClick={() => {
              setOpen(false);
              onFreeGrid();
            }}
          >
            <span className="fold-menu-icon">
              <TypeIcon id="freegrid" size={18} />
            </span>
            Free Grid
          </button>
        </div>
      )}
    </div>
  );
}
