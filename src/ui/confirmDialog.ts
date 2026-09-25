import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  The app's own confirm/alert, replacing window.confirm/alert.
 *
 *  WHY, and it is not only styling. A native dialog is browser-owned UI
 *  the app cannot theme (it stays light under dark chrome) -- the same
 *  complaint that retired native `title` tooltips for the beat-gap
 *  buttons, whose delay "belongs to the browser". But the sharper reason
 *  is a real failure mode: after a few dialogs in one session Chrome
 *  offers "Prevent this page from creating additional dialogs", and once
 *  that is ticked `window.confirm` returns FALSE for the rest of the
 *  tab's life. Every destructive action then silently does nothing --
 *  no error, no feedback, the click just stops working. For an app where
 *  people delete boards and notes in runs, that is reachable.
 *
 *  (It is also why no confirm-gated path could ever be verified from the
 *  browser tools: the automation layer auto-dismisses native dialogs, so
 *  they answer false in ~1ms and nothing is shown. Owner spotted that --
 *  "it's just not working at all in your sandbox".)
 *
 *  A PROMISE rather than a callback, so the call sites keep the shape
 *  they already had:
 *
 *      if (await confirmDialog.ask({ ... })) ops.delete(...)
 *
 *  which is `if (window.confirm(...))` with one word added, rather than
 *  an inversion into nested callbacks.
 * ------------------------------------------------------------------ */

export interface ConfirmRequest {
  /* One short line naming the thing, in the imperative -- "Delete this
   * note?". The BODY carries the consequence. */
  title: string;
  body?: string;
  confirmLabel?: string; // defaults to "Delete", the overwhelming case
  cancelLabel?: string;
  /* Destructive by default -- every current caller is a delete. Set
   * false for a plain question, and `alert` for a one-button notice. */
  danger?: boolean;
  alert?: boolean; // no cancel: an acknowledgement, not a decision
  /* A THIRD ANSWER (2026-09-06), between cancel and confirm: for the
   * question that has two ways forward and a way back -- the designer's
   * "Save to the pool" / "Close without saving" / "Go back". Only
   * `choose` tells the three apart; `ask` reads it as not-confirmed. */
  altLabel?: string;
}

export type ConfirmAnswer = "confirm" | "alt" | "cancel";

interface Live extends ConfirmRequest {
  resolve: (answer: ConfirmAnswer) => void;
}

let live: Live | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function settle(answer: ConfirmAnswer) {
  if (!live) return;
  const { resolve } = live;
  live = null;
  emit();
  resolve(answer);
}

export const confirmDialog = {
  /* The three-way form: which button was pressed. Escape and the
   * backdrop are "cancel", the way back. */
  choose(req: ConfirmRequest): Promise<ConfirmAnswer> {
    /* One at a time. A second ask while one is up would strand the first
     * promise forever, so the pending one is answered NO first -- the
     * safe reading for anything destructive. */
    if (live) settle("cancel");
    return new Promise<ConfirmAnswer>((resolve) => {
      live = { ...req, resolve };
      emit();
    });
  },
  ask(req: ConfirmRequest): Promise<boolean> {
    return this.choose(req).then((a) => a === "confirm");
  },
  /* window.alert's replacement: one button, nothing to decide. */
  tell(title: string, body?: string): Promise<boolean> {
    return this.ask({ title, body, alert: true, danger: false, confirmLabel: "OK" });
  },
  accept: () => settle("confirm"),
  alt: () => settle("alt"),
  cancel: () => settle("cancel"),
};

export function useConfirmDialog(): Live | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => live,
    () => null,
  );
}
