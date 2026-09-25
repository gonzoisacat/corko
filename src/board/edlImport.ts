import { useSyncExternalStore } from "react";
import { parseEdl, type EdlParse } from "../state/edl";
import { edlToBoard } from "../state/edlBoard";
import { sanitizeBoard } from "../state/validate";
import { blobs, localBlobs, whenBlobStoreChosen } from "../state/blobStore";
import { ops } from "../state/useBoard";
import { confirmDialog } from "../ui/confirmDialog";
import type { Rate } from "../state/timecode";
import type { GrabResult } from "./stills";

/* ------------------------------------------------------------------ *
 *  THE EDL IMPORT STEP -- what you are asked before anything is written.
 *
 *  A promise-returning store, exactly like ui/confirmDialog.ts, so the
 *  call site reads as one `await` rather than inverting into callbacks.
 *  It resolves the chosen options, or null for a cancel.
 *
 *  WHY IT IS ITS OWN DIALOG RATHER THAN A CONFIRM. It has a CHOICE in
 *  it -- the frame rate -- and `confirmDialog` is deliberately yes/no.
 *  The rate has to be asked because CMX3600 never states it (see
 *  timecode.ts `guessBase`): the only evidence in the file is the
 *  largest frame field used, so a 25 fps list that happens never to use
 *  frame 24 guesses as 24 with nothing on screen to correct it.
 *
 *  AND IT IS THE SHELL PHASE B NEEDS. The plan's contact-sheet offset
 *  check -- twelve grabbed frames and a nudge, so a wrong head offset is
 *  two seconds of work rather than a re-import -- belongs in exactly this
 *  box, after exactly this question. Building it now means Phase B slots
 *  into something that exists instead of replacing a throwaway.
 * ------------------------------------------------------------------ */

export interface EdlImportChoice {
  rate: Rate;
  /* The grabbed frames, one per event that could be seeked, ALREADY
   * grabbed -- the dialog runs the full grab before it closes, so the
   * job with progress worth showing happens where there is a surface to
   * show it on (and the proxy is decoded once, not re-opened by the
   * caller). Absent = no video was picked, which is a perfectly good
   * import; the text board is useful on its own. Nothing is in any
   * store yet: the CALLER writes them, so a cancelled dialog leaves no
   * orphans. */
  stills?: GrabResult[];
  /* The proxy's own aspect, measured when it loaded, so the cards come
   * out the shape of the footage. */
  aspect?: number;
  /* The categories to bring in. The dialog offers the format's fixed
   * nine and ticks the ones this file can actually fill -- see
   * edlBoard.ts `edlFieldCounts` for why that is both halves of the
   * owner's question. */
  fields: ReadonlySet<string>;
}

interface Live {
  parse: EdlParse;
  fileName: string;
  /* A proxy already open somewhere -- the player's video (2026-09-06:
   * the EDL import's front door in Player mode hands the loaded file
   * over, so the stills come from what is already playing). The dialog
   * picks it on open; a different one can still be chosen. */
  proxy?: File;
  resolve: (choice: EdlImportChoice | null) => void;
}

let live: Live | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function settle(choice: EdlImportChoice | null) {
  if (!live) return;
  const { resolve } = live;
  live = null;
  emit();
  resolve(choice);
}

export const edlImport = {
  /* One at a time. A second ask while one is up answers the pending one
   * with a CANCEL first, so no promise is stranded and nothing is
   * imported by a dialog nobody is looking at. */
  ask(parse: EdlParse, fileName: string, proxy?: File): Promise<EdlImportChoice | null> {
    if (live) settle(null);
    return new Promise((resolve) => {
      live = { parse, fileName, proxy, resolve };
      emit();
    });
  },
  accept: (choice: EdlImportChoice) => settle(choice),
  cancel: () => settle(null),
};

export function useEdlImport(): Live | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => live,
    () => null,
  );
}

/* ------------------------------------------------------------------ *
 *  THE WHOLE IMPORT, from a File to a board on the shelf. Lived in the
 *  Boards menu until 2026-09-02, when the owner moved "Import EDL..."
 *  into the New Board flow (step 2 of a Beat Map, after Custom): an EDL
 *  is a way of STARTING a board, so it belongs with the other ways.
 *
 *  AN EDL BUILDS A SHOT BOARD -- one card per event, clip name as the
 *  title, and every scrap the list carries about a shot as a metadata
 *  VALUE (state/edl.ts + state/edlBoard.ts). Nothing is placed on the
 *  card face: the layout tools already in the app do that better, once,
 *  on one card, propagated with `ops.applyLayout`.
 *
 *  It goes through `sanitizeBoard` like a loaded FILE, even though this
 *  board was built in-process a line earlier: the EDL text is untrusted
 *  input and its clip names become card titles, so the same
 *  normalize-before-any-doc-write rule applies.
 *
 *  The dialog is an HONESTY step rather than a safety one -- the whole
 *  import is one undoable transaction. It exists because two numbers
 *  decide whether a list parsed properly (events out, lines not
 *  understood) and because the FRAME RATE has to be asked: an EDL never
 *  states it.
 *
 *  LOCAL FIRST, DOC SECOND, UPLOAD LAST (2026-09-01). The bytes go into
 *  this browser's own store before the board exists, so its cards paint
 *  at once; the board is written next, so the doc references every key
 *  BEFORE any of them is in the bucket; and only then do the uploads go
 *  out, in the background, with failures remembered and retried. The
 *  Worker also refuses to purge anything younger than a day.
 *
 *  `onDone` gets the new board's id; it is not called when the person
 *  cancelled or the list held nothing. */
export async function importEdlFile(file: File, onDone: (boardId: string) => void, proxy?: File): Promise<void> {
  try {
    const txt = await file.text();
    const parsed = parseEdl(txt);
    if (!parsed.events.length) {
      confirmDialog.tell(
        "Nothing to import",
        "No shot events found. This may not be a CMX3600 EDL, or it may hold only audio tracks.",
      );
      return;
    }
    const choice = await edlImport.ask(parsed, file.name, proxy);
    if (!choice) return;
    const stills = new Map<number, string>();
    for (const g of choice.stills ?? []) {
      await localBlobs.put(g.key, g.blob);
      stills.set(g.index, g.key);
    }
    const built = edlToBoard(parsed, {
      rate: choice.rate,
      title: parsed.title || file.name,
      fields: choice.fields,
      aspect: choice.aspect,
      stills,
    });
    const b = sanitizeBoard(JSON.parse(JSON.stringify(built)));
    if (!b) throw new Error("bad");
    const id = ops.importBoard(b);
    onDone(id);
    void whenBlobStoreChosen().then(async () => {
      for (const g of choice.stills ?? []) await blobs.put(g.key, g.blob);
    });
  } catch {
    confirmDialog.tell("That file could not be read as an EDL.");
  }
}
