import { useSyncExternalStore } from "react";

/* The pinboard designer's door (ui/PinboardDesigner.tsx): opened by five
 * quick clicks on the mark (ui/CorkoMark.tsx), closed by Escape, the
 * backdrop or Done. A store rather than App state so the mark, which
 * has no line to App, can open it. */
let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const pinboardDesigner = {
  open() {
    if (open) return;
    open = true;
    emit();
  },
  close() {
    if (!open) return;
    open = false;
    emit();
  },
  isOpen: () => open,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function usePinboardDesignerOpen(): boolean {
  return useSyncExternalStore(pinboardDesigner.subscribe, pinboardDesigner.isOpen, () => false);
}
