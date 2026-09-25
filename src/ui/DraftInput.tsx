import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/* ------------------------------------------------------------------ *
 *  A text input over a shared-doc field that keeps a LOCAL draft while
 *  focused and commits once on blur/Enter (Escape reverts) -- the same
 *  contract as Editable, for plain always-visible inputs (board title,
 *  tier names, legend labels). These used to write to the Yjs doc on
 *  EVERY keystroke: each keypress was a transaction, a sync broadcast,
 *  an undo entry, and a snapshot rebuild.
 *
 *  Also commits from the unmount cleanup: closing a popover can unmount
 *  a focused input without any blur event, which would silently drop
 *  the edit.
 * ------------------------------------------------------------------ */

export function DraftInput({
  value,
  onCommit,
  className,
  placeholder,
  ariaLabel,
  style,
  multiline,
  rows,
  autoFocus,
  caretAtEnd,
  selectAll,
  onDone,
}: {
  value: string;
  onCommit: (v: string) => void;
  /* The edit ENDED, commit or not: called on every blur after any
   * commit. For a host that opened this field for one purpose (the
   * reply composer) and wants to put it away when you walk off without
   * typing -- which is the one blur the draft contract never reports,
   * since nothing changed. */
  onDone?: () => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  /* A textarea instead of an input: Enter inserts a newline rather than
   * committing (the note field wants paragraphs), so blur / unmount /
   * Escape are the only commits. Same draft contract otherwise. */
  multiline?: boolean;
  rows?: number;
  autoFocus?: boolean;
  /* Open with the caret after the last character instead of before the
   * first. For a field you opened to AMEND -- a note body -- where
   * autofocus's caret-at-zero silently puts what you type at the front of
   * somebody's sentence. Deliberately not Editable's select-all: that is
   * right for a title you are replacing and destructive for a paragraph. */
  caretAtEnd?: boolean;
  /* Open with the whole value SELECTED, so the first keystroke replaces
   * it. For a NAME you opened to change -- a board title -- which is what
   * Editable already does for a card title, and the reason neither of the
   * two above suits: caret-at-zero types at the front of the old name and
   * caret-at-end types onto the end of it. */
  selectAll?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null); // null = not editing
  // latest values for the unmount commit, without re-running the effect
  const live = useRef({ draft, value, onCommit, cancelled: false });
  live.current.draft = draft;
  live.current.value = value;
  live.current.onCommit = onCommit;

  useEffect(
    () => () => {
      const s = live.current;
      if (!s.cancelled && s.draft !== null && s.draft !== s.value) s.onCommit(s.draft);
    },
    [],
  );

  const el = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!caretAtEnd && !selectAll) return;
    const node = el.current;
    if (!node) return;
    node.focus();
    const end = node.value.length;
    node.setSelectionRange(selectAll ? 0 : end, end);
    // mount only: re-running would yank the caret mid-edit on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shared = {
    ref: el as never,
    className,
    style,
    value: draft ?? value,
    placeholder,
    "aria-label": ariaLabel,
    autoFocus,
    onFocus: () => {
      live.current.cancelled = false;
      setDraft(value);
    },
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => {
      if (draft !== null && draft !== value && !live.current.cancelled) onCommit(draft);
      /* Both of these are about a host that CLOSES ITS EDITOR ON BLUR (the
       * notes column), which makes this blur the cause of its own unmount
       * in the same tick -- React hasn't re-rendered, so the unmount effect
       * below still sees the pre-blur mirror.
       *
       * Clearing the mirrored draft by hand is what stops it committing
       * TWICE. It was invisible on the fields that edit in place (writing
       * the same body again is idempotent) and showed up as a duplicated
       * reply, because addReply appends.
       *
       * And `cancelled` is NOT cleared here -- onFocus does that. Clearing
       * it on blur re-opened the door it exists to shut: Escape blurs, and
       * the unmount that followed then committed the edit Escape had just
       * thrown away. */
      live.current.draft = null;
      setDraft(null);
      onDone?.();
    },
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !multiline) {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      live.current.cancelled = true;
      setDraft(null);
      e.currentTarget.blur();
    }
  };

  return multiline ? (
    <textarea {...shared} rows={rows} onKeyDown={onKeyDown} />
  ) : (
    <input {...shared} onKeyDown={onKeyDown} />
  );
}
