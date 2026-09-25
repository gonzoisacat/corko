import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useBoardUI } from "../board/context";
import { setFocus } from "../state/sync";
import { renderHighlight } from "./highlight";

interface Props {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoEdit?: boolean;
  style?: CSSProperties;
  className?: string;
  /* When set, focusing this field broadcasts presence (spec Sec 7) so
   * peers see a ring on this node; blur clears it. `focusId` is the owning
   * node's id. */
  focusId?: string;
  focusField?: string;
  /* Told whenever this field opens or closes. The host card needs it for
   * two things a text field can't do for itself: turn OFF its own
   * `draggable` (an HTML5 drag starts from the nearest draggable
   * ANCESTOR, so click-dragging to select a few words was grabbing the
   * card instead), and give the field room while it's open. */
  onEditing?: (editing: boolean) => void;
}

/* In-place editable text. Commits on blur or Enter (Shift+Enter inserts
 * a newline in multiline mode); Escape cancels. Entering edit is the
 * CARD's job now, not the text's (owner's call, 2026-08-02): a single
 * click anywhere on a card -- text included -- selects it, so this span
 * deliberately owns no click handlers and lets everything bubble. The
 * card's double-click calls autoEdit's editCard, which flips this
 * component's `autoEdit` prop; Enter on the tab-focused span still works
 * for keyboard users. Opening always pre-selects the whole text (the
 * focus effect below). */
export function Editable({
  value,
  onCommit,
  placeholder,
  multiline,
  autoEdit,
  style,
  className,
  focusId,
  focusField,
  onEditing,
}: Props) {
  const { query } = useBoardUI();
  const [editing, setEditing] = useState(!!autoEdit);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  /* A CLICK MUST NOT LEAVE FOCUS ON THE DISPLAY SPAN (owner-reported
   * 2026-09-12: "when i do open the metadata menu, i get these odd
   * highlights around my words on the card"). The span is tab-focusable
   * so a keyboard user can reach the words and press Enter, and its ring
   * (`.editable:focus-visible`) is drawn for THAT. But a mouse click on
   * the words focuses it too, silently, and Chrome turns :focus-visible
   * on for whatever is focused the moment a key is pressed -- so click a
   * card, press `m`, and the ring appeared on an inline span, one bracket
   * per line box. The span hands back any focus a pointer gave it; Tab
   * focus is untouched, and Enter on a selected card still edits through
   * keyNav. Not `preventDefault` on mousedown, which is the usual way to
   * refuse click focus: Firefox will not start a drag from a mousedown
   * whose default was prevented, and the card above is draggable. */
  const byPointer = useRef(false);

  // read through a ref so a fresh callback identity can't re-fire this
  const report = useRef(onEditing);
  report.current = onEditing;
  useEffect(() => {
    report.current?.(editing);
    // and on unmount (a virtualized row scrolling away mid-edit), so the
    // host isn't left thinking a field is still open
    return () => report.current?.(false);
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // The initial useState covers the just-added card (mounted already in
  // edit mode); this covers a card ALREADY on screen being sent into edit
  // (keyboard nav's Enter flips its autoEdit flag -- board/autoEdit.ts
  // editCard). Opens only; closing stays with commit/cancel.
  useEffect(() => {
    if (autoEdit) setEditing(true);
  }, [autoEdit]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select?.();
    }
  }, [editing]);

  // Grow a multiline field to its content so it stays centered in the card
  // (rather than a fixed-height box) -- part of the seamless in-card edit.
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || !multiline) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [multiline]);
  useEffect(() => {
    if (editing) fit();
  }, [editing, draft, fit]);

  /* ...and re-fit when the field's WIDTH changes, which on a full-width
   * band happens one render AFTER it appears: `onEditing` reaches the
   * host, the host adds .editing, and only then does the field get the
   * rest of the row. The first fit measured the old narrow box, so a long
   * title wrapped to three lines and the field stayed that tall -- text
   * parked at the top of an over-tall box until the next keystroke
   * re-fitted it. (Which is exactly what it looked like: top-justified on
   * double-click, snapping to center as soon as you typed.)
   *
   * Width only: a height change is our own, and re-firing on it is how a
   * ResizeObserver loop starts. */
  useEffect(() => {
    const el = ref.current;
    if (!editing || !multiline || !el) return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing, multiline, fit]);

  const commit = () => {
    setEditing(false);
    if (focusId) setFocus(null, null);
    if (draft !== value) onCommit(draft);
  };
  const cancel = () => {
    setEditing(false);
    if (focusId) setFocus(null, null);
    setDraft(value);
  };

  if (editing) {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
      if (e.key === "Enter" && !(multiline && e.shiftKey)) {
        e.preventDefault();
        commit();
      }
    };
    const common = {
      ref,
      value: draft,
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onFocus: () => {
        if (focusId) setFocus(focusId, focusField ?? null);
      },
      onBlur: commit,
      onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
      onKeyDown,
      className: "edit-field",
      style,
    };
    return multiline ? <textarea {...common} rows={1} /> : <input {...common} />;
  }

  return (
    <span
      className={"editable " + (className || "")}
      style={style}
      tabIndex={0}
      onMouseDown={() => {
        byPointer.current = true;
        // focus, if it comes, comes synchronously with this mousedown's
        // default action; a mousedown that focused nothing must not leave
        // the flag armed for a later Tab
        setTimeout(() => (byPointer.current = false), 0);
      }}
      onFocus={(e) => {
        if (!byPointer.current) return;
        byPointer.current = false;
        e.currentTarget.blur();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          setEditing(true);
        }
      }}
    >
      {value ? renderHighlight(value, query) : <span style={{ opacity: 0.4 }}>{placeholder}</span>}
    </span>
  );
}
