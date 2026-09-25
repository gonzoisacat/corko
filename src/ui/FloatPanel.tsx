import { useEffect, useRef, useState } from "react";
import { GripHorizontal, Pin, PinOff, X } from "lucide-react";
import { useClampToViewport } from "./useClampToViewport";

/* ------------------------------------------------------------------ *
 *  A floating, draggable panel.
 *
 *  The tag panel needed this first: anchored under the legend chip it sat
 *  right over the board you're watching while you drag a placement slider.
 *  So a panel you can shove aside by its header, rendered once above the
 *  panes (each caller keeps its open-state in a module store, so a
 *  virtualized row can scroll out from under an open panel).
 *
 *  Extracted at the THIRD user (tag / note / metadata) -- two only
 *  justified sharing the CSS.
 *
 *  Two behaviors worth knowing:
 *
 *  - Escape is swallowed while a text field has focus. The field's own
 *    Escape reverts it (DraftInput) and blurs; a SECOND Escape closes the
 *    panel. Otherwise one keypress both discards what you typed and takes
 *    the panel away, which is a bad trade in a note.
 *  - A mousedown inside ANY float panel counts as inside. Panels are
 *    siblings above the panes, so without this, opening the metadata panel
 *    next to the note panel would close the note the moment you clicked
 *    the other one.
 * ------------------------------------------------------------------ */

/* Types where a keystroke is text the user is editing. Everything else
 * -- checkbox, radio, color, range, button -- has no use for Escape. */
const TEXT_TYPES = new Set(["", "text", "search", "url", "tel", "email", "password", "number"]);
const isTextEntry = (t: EventTarget | null): boolean =>
  t instanceof HTMLTextAreaElement ||
  (t instanceof HTMLInputElement && TEXT_TYPES.has(t.type)) ||
  (t instanceof HTMLElement && t.isContentEditable);

export function FloatPanel({
  title,
  x,
  y,
  width,
  onMove,
  onClose,
  className,
  done,
  sticky,
  passive,
  pin,
  headTool,
  children,
}: {
  title: string;
  x: number;
  y: number;
  width: number;
  onMove: (x: number, y: number) => void;
  onClose: () => void;
  className?: string;
  /* Show a "Done" button at the foot. It IS the close button -- every
   * edit in these panels commits live (DraftInput on blur, ops as you
   * click), so there is nothing to save -- but a panel that only offers
   * an X reads as "abandon", and people hunt for the OK that doesn't
   * exist. Opt-in: the tag panel deliberately ends in its diorama. */
  done?: boolean;
  /* A panel you PARK: no click-outside close, no Escape close -- only its
   * X/Done or its own toggle take it down. The shortcut legend is the
   * user: reference material meant to sit open while you work under it. */
  sticky?: boolean;
  /* A panel that does NOT OWN THE BOARD'S KEYS (2026-09-12, owner-
   * reported: "when the calculator is open, it feels like the m shortcut
   * key to open metadata window stops working"). keyNav stands aside
   * while a float panel is up because a PER-CARD panel and a keyboard
   * walking the board under it would desync -- but reference material
   * that sits open beside the board (the shortcut legend, the timecode
   * calculator) is about no card, and its own fields already take the
   * keystrokes typed into them. Stamped as `data-passive` so keyNav and
   * the player ask the PANEL rather than each keeping a list of class
   * names. Escape is unchanged by this: an unpinned passive panel still
   * closes on it, and the selection still survives the same press. */
  passive?: boolean;
  /* THE PIN (2026-09-11): the switch that decides whether the panel is
   * parked, drawn beside the close button. It has to live ON the panel
   * -- a switch that pins a panel cannot be somewhere the pinning makes
   * hard to reach -- and the metadata panel and the calculator each
   * built the same button into `headTool` until the audit caught the
   * two copies. The caller keeps the setting and its own tip sentence
   * (the owner's words, one per panel: it names what the control is
   * FOR, which does not change when it is on); the aria-label says
   * what a press will DO, since that is the sentence a screen reader
   * announces about this press. */
  pin?: { on: boolean; toggle: () => void; tip: string };
  /* Anything else of the panel's own in the header beside the close
   * button. */
  headTool?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  /* Once you've DRAGGED it, the position is yours: the drag deliberately
   * lets you fling a panel most of the way off screen so long as a grab
   * strip stays reachable. Until then the opening position is clamped to
   * the window by MEASURING the panel -- callers used to guess their own
   * height and a panel that grew (a card with a dozen notes, a project
   * with a dozen categories) opened with its foot off the bottom. */
  const [freed, setFreed] = useState(false);
  const clamped = useClampToViewport(ref, x, y, { w: width, h: 320 });
  const pos = freed ? { left: x, top: y } : clamped;

  useEffect(() => {
    if (sticky) return; // parked panels only close from their own controls
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (ref.current?.contains(t)) return;
      if (t?.closest(".float-panel")) return; // another panel, not the board
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      /* Escape belongs to a TEXT field first -- one press reverts the
       * edit, a second closes the panel. Two things this has to get
       * right, and the old check got both wrong:
       *
       *  - it tested every <input>, so a CHECKBOX (the metadata panel's
       *    apply-to-others ticks) or a color swatch blocked Escape
       *    outright and the panel could never be closed from the
       *    keyboard once you'd touched one;
       *  - it read document.activeElement, but DraftInput's own Escape
       *    BLURS the field, so by the time this ran focus was already
       *    gone and the "second" press was really the first. The
       *    EVENT TARGET is the field that had focus when the key went
       *    down, which is the thing we actually mean. */
      if (isTextEntry(e.target)) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, sticky]);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    setDragging(true);
    setFreed(true);
    const move = (ev: MouseEvent) => {
      // keep a grabbable strip on screen no matter how far you fling it
      onMove(
        Math.max(8 - width + 40, Math.min(window.innerWidth - 40, ev.clientX - dx)),
        Math.max(4, Math.min(window.innerHeight - 30, ev.clientY - dy)),
      );
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      ref={ref}
      className={
        "options-panel float-panel" + (className ? " " + className : "") + (dragging ? " dragging" : "")
      }
      style={{ left: pos.left, top: pos.top, width }}
      data-passive={passive ? "on" : undefined}
    >
      <div className="float-panel-head" onMouseDown={startDrag}>
        <GripHorizontal size={13} className="float-panel-grip" />
        <span className="options-title mono">{title}</span>
        {/* tip-left (owner-reported 2026-09-04: "unnecessary horizontal
            scroll bars" on the metadata and color-override panels): a
            centered tip box on this 17px button reaches past the
            panel's right edge even at opacity 0, and a panel that
            scrolls vertically scrolls horizontally too, so the phantom
            overhang grew a scrollbar. Anchored right, the tip hangs
            inward and nothing overflows. */}
        {headTool}
        {pin && (
          <button
            className="float-panel-close tip-left"
            aria-label={pin.on ? "Unpin this panel" : "Pin this panel on top"}
            data-tip={pin.tip}
            onClick={pin.toggle}
          >
            {pin.on ? <Pin size={13} /> : <PinOff size={13} />}
          </button>
        )}
        <button className="float-panel-close tip-left" aria-label="Close" data-tip="Close" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      {children}
      {done && (
        <div className="float-panel-foot">
          <button className="float-done" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
