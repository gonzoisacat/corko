import { useEffect, useRef } from "react";
import { confirmDialog, useConfirmDialog } from "./confirmDialog";

/* ------------------------------------------------------------------ *
 *  The app's confirm/alert dialog -- see confirmDialog.ts for why this
 *  exists rather than window.confirm.
 *
 *  Named for the store it renders, like TagPanelPopover /
 *  LegendPanelPopover / KeysPanelPopover -- and it CANNOT be
 *  `ConfirmDialog.tsx` beside `confirmDialog.ts`: the two differ only in
 *  case, which collides on a case-insensitive filesystem.
 *
 *  Rendered ONCE, by App, above the panes: it is modal, so it must not
 *  live inside a pane's look scope or it would inherit one board's
 *  backdrop attributes. It carries no board color of its own.
 *
 *  Keyboard: Escape cancels, Enter confirms, and the confirm button is
 *  focused on open so both work without a click. The backdrop counts as
 *  a cancel (the safe answer), the panel itself does not.
 * ------------------------------------------------------------------ */
export function ConfirmDialogPopover() {
  const req = useConfirmDialog();
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    /* Focus the confirm button so Enter answers it. `.keyed` is not used
     * here -- unlike the card menu this is always opened deliberately, so
     * a visible ring is wanted every time. */
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      /* Captured, and stopped: this is modal, so nothing behind it --
       * keyNav's cursor, a card's Escape-to-revert -- may also act on
       * these keys. keyNav's own overlayOpen() guard covers it too
       * (.confirm-backdrop is in that list), but a dialog should not
       * depend on someone else's guard staying correct. */
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        confirmDialog.cancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        confirmDialog.accept();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req]);

  if (!req) return null;
  const danger = req.danger !== false && !req.alert;

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(e) => {
        // only the backdrop itself, not a click that started in the panel
        if (e.target === e.currentTarget) confirmDialog.cancel();
      }}
    >
      <div className="confirm-panel" role="alertdialog" aria-modal="true" aria-label={req.title}>
        <div className="confirm-title">{req.title}</div>
        {req.body && <div className="confirm-body">{req.body}</div>}
        <div className="confirm-actions">
          {!req.alert && (
            <button className="confirm-btn" onClick={() => confirmDialog.cancel()}>
              {req.cancelLabel ?? "Cancel"}
            </button>
          )}
          {req.altLabel && (
            <button className="confirm-btn" onClick={() => confirmDialog.alt()}>
              {req.altLabel}
            </button>
          )}
          <button
            ref={okRef}
            className={"confirm-btn confirm-go" + (danger ? " danger" : "")}
            onClick={() => confirmDialog.accept()}
          >
            {req.confirmLabel ?? "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
