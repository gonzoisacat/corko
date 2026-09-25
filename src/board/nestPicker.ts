import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  Choosing WHICH board a card stands in for, and renaming that board.
 *
 *  Two modes of one popover because they are two halves of one question
 *  the card raises -- a nesting card shows the TARGET'S live title, so
 *  the only honest way to change what the card says is to rename the
 *  board itself. Reached from the card menu; module state above the
 *  panes, like every other overlay that outlives the row it opened from.
 * ------------------------------------------------------------------ */

export type NestPickerMode = "pick" | "rename";

export interface NestPickerState {
  mode: NestPickerMode;
  nodeId: string;
  boardId: string; // the board the CARD lives on (the host, for the cycle check)
  /* How many children converting would delete. 0 for a relink, and for a
   * card that had none -- the confirm is skipped either way. */
  childCount: number;
  /* rename mode only: the board being renamed. */
  targetId: string;
  /* WHAT TO DO WITH THE ANSWER, when the default is not right.
   *
   * The picker's own question is "which board?", and normally the answer
   * is applied to `nodeId`. The Free Grid's bare-cork menu has no node
   * yet -- "Add nested board here" should create one only if you
   * actually choose -- so it passes this and mints the card itself.
   *
   * The alternative was to mint the card first and take it back on
   * cancel, and that cannot be made correct: `link` closes the picker
   * BEFORE it nests, and the "New board..." route goes on to open the
   * template picker, so any close-detection either fires too early or
   * has to know about two other stores' timing. Handing the caller the
   * answer removes the question -- the `templatePicker.open(onCreated)`
   * idiom, which this file already sits beside. */
  onPick?: (targetId: string) => void;
  x: number;
  y: number;
}

let state: NestPickerState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const nestPicker = {
  open(s: NestPickerState) {
    state = s;
    emit();
  },
  close() {
    if (state) {
      state = null;
      emit();
    }
  },
};

export function useNestPicker(): NestPickerState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => null,
  );
}
