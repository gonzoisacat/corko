import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  Which card each per-card panel is open on, and where it sits. Two
 *  panels, same state with a different body:
 *
 *    notePanel -- the card's note, on its own.
 *    metaPanel -- "More metadata...": its tags and its metadata categories.
 *
 *  They are deliberately separate doors, and separate stores so both can be
 *  open at once. Notes are getting their own SYSTEM later -- tracking them,
 *  treating them differently from short values -- and a note field buried
 *  among a dozen timecode boxes is exactly what that can't be.
 *
 *  ONE CARD AT A TIME, THOUGH (owner-reported 2026-09-10: "if i have one
 *  open and then right click to open another card's metadata menu before
 *  closing, the old one pops up when i close the new one"). Opening any
 *  of these on a card CLOSES every one standing on a DIFFERENT card, so
 *  what is on screen is always about one card and closing the top panel
 *  can never reveal another card's underneath it.
 *
 *  Deliberately NOT one panel at a time, which would undo the paragraph
 *  above: a card's note beside that same card's metadata is the pair
 *  those separate doors exist for. It is the second CARD that was never
 *  intended, and that is the only thing this forbids.
 *
 *  Module state (same pattern as cardMenu.ts / tagPanel.ts) because the
 *  panels render once above the panes: they float anywhere on screen, and a
 *  virtualized row can scroll out from under an open one without closing
 *  it.
 *
 *  `depth` is the node's tier, carried from the opener the way cardMenu
 *  does -- it names the tier in the header. Tier is depth and drag is
 *  tier-invariant, so it can't go stale while the panel is open.
 * ------------------------------------------------------------------ */

export interface CardPanelState {
  /* THE ANCHOR: the card the panel was opened from -- what the preview
   * draws, where a layout is copied from, the one card when `ids` is one */
  nodeId: string;
  /* THE SUBJECT (2026-09-12, his "mixed panel"): every card the panel is
   * about. `[nodeId]` for a single card, the selection when the card it
   * was opened from is part of one, `[]` for the empty summon. The
   * metadata and text panels read and write the whole list; the note and
   * image panels stay about the anchor, being per-card by nature. */
  ids: string[];
  boardId: string;
  depth: number;
  x: number;
  y: number;
}

export interface OpenOpts {
  ids?: string[];
  /* A FOLLOW, not an opening (2026-09-12): the pinned metadata panel
   * re-opening on whatever you select. It must never close another
   * card's door -- a note popover you are typing into on card A was
   * closed by a click, an arrow, a chevron or a frame CAPTURE selecting
   * card B, because the follow went through the same open that enforces
   * the one-subject rule below. Only a deliberate open does that. */
  follow?: boolean;
}

/* Every per-card panel, so each one can shut the others standing on
 * another card. A registry rather than each store naming its siblings:
 * they are created below in one place, and a fifth door should join this
 * by existing, not by being remembered. `on()` is the panel's SUBJECT:
 * every card it is about, or null when closed. */
const cardPanels: { on(): string[] | null; shut(): void }[] = [];

function makeCardPanelStore() {
  let state: CardPanelState | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const store = {
    open(nodeId: string, boardId: string, depth: number, x: number, y: number, opts: OpenOpts = {}) {
      const ids = opts.ids ?? (nodeId ? [nodeId] : []);
      /* Clear the other subjects' doors FIRST, so one render shows the
       * new panel alone rather than a frame with both. ONE SUBJECT AT A
       * TIME: a door standing on a card that is not in this subject
       * shuts; one on a card that is stays (a note on card B beside the
       * metadata of A, B and C is the pair the separate doors exist for).
       * NOT for an EMPTY open (no ids): that is a panel with no card to
       * be about yet, and it has no business closing a note somebody has
       * open. And NOT for a FOLLOW (see OpenOpts). */
      if (ids.length && !opts.follow) {
        for (const p of cardPanels) {
          const on = p.on();
          if (on !== null && !on.some((id) => ids.includes(id))) p.shut();
        }
      }
      state = { nodeId, ids, boardId, depth, x, y };
      emit();
    },
    /* Dragging the panel by its header. */
    moveTo(x: number, y: number) {
      if (!state) return;
      state = { ...state, x, y };
      emit();
    },
    close() {
      if (!state) return;
      state = null;
      emit();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get: () => state,
  };
  cardPanels.push({ on: () => state?.ids ?? null, shut: () => store.close() });
  return store;
}

/* Panel widths live here so either panel can position the other.
 *
 * META_W went 356 -> 404 so "Apply selected VALUES to every <TIER> in
 * this [scope]" fits on ONE line (owner, 2026-08-05) -- "selected" is
 * load-bearing, it is what says the checkboxes decide what travels -- and
 * then back to 380, because 404 left ~50px of dead air between the words
 * and the scope menu. 380 is measured: the values sentence runs ~219px at
 * a five-letter tier, and the text box is ~244 here, so ordinary tier
 * names sit comfortably and only a long one ellipses -- which is now
 * safe, since the ellipsis eats the TIER and leaves "in this" against the
 * menu it introduces.
 *
 * META_W went 300 -> 356 when the metadata panel grew a second apply
 * sentence ("selected value(s) to every BEAT in this"), which is about
 * 40px longer than the layout one. At 300 it wrapped to two lines while
 * its twin sat on one, which read as a mistake rather than a pair. The
 * width is the honest fix -- the alternative was shrinking the type on
 * both, or abbreviating a sentence that says exactly what it does. The
 * card preview inside scales off this, so it gets a little bigger too,
 * which only helps when you are aiming a category at a slot. */
export const NOTE_W = 264;
export const META_W = 380;

const NONE = () => null;

export const notePanel = makeCardPanelStore();
export const useNotePanel = (): CardPanelState | null =>
  useSyncExternalStore(notePanel.subscribe, notePanel.get, NONE);

export const metaPanel = makeCardPanelStore();
export const useMetaPanel = (): CardPanelState | null =>
  useSyncExternalStore(metaPanel.subscribe, metaPanel.get, NONE);

/* "Image..." -- the third door on a card, beside its two neighbors
 * (owner, 2026-08-26). A PANEL rather than a hover submenu because it is
 * panel-shaped work: a preview of the card, add / replace / remove, and
 * how the image sits on it. A flyout list could hold the verbs but not
 * the preview, and the fit modes are the kind of choice you want to SEE
 * rather than read. */
export const imagePanel = makeCardPanelStore();
export const useImagePanel = (): CardPanelState | null =>
  useSyncExternalStore(imagePanel.subscribe, imagePanel.get, NONE);

/* TEXT OVERRIDES -- color, size, typeface, shadow and position for one
 * card's words. Its own door rather than a section of the Image panel:
 * these are properties of the TEXT, true whether or not the card carries
 * a picture, and burying them under "Image" would mean you had to add a
 * photo to reach them. */
export const textPanel = makeCardPanelStore();
export const useTextPanel = (): CardPanelState | null =>
  useSyncExternalStore(textPanel.subscribe, textPanel.get, NONE);

/* "Paste metadata values..." -- not a per-card panel but a per-SELECTION
 * one, so it holds a list of target ids rather than one node. Same
 * floating shell and the same module-store reasoning. */
export interface PasteValuesState {
  ids: string[];
  x: number;
  y: number;
}

let pasteState: PasteValuesState | null = null;
const pasteListeners = new Set<() => void>();

export const pasteValues = {
  open(ids: string[], x: number, y: number) {
    pasteState = { ids, x, y };
    pasteListeners.forEach((l) => l());
  },
  moveTo(x: number, y: number) {
    if (!pasteState) return;
    pasteState = { ...pasteState, x, y };
    pasteListeners.forEach((l) => l());
  },
  close() {
    if (!pasteState) return;
    pasteState = null;
    pasteListeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    pasteListeners.add(l);
    return () => pasteListeners.delete(l);
  },
  get: () => pasteState,
};

export const usePasteValues = (): PasteValuesState | null =>
  useSyncExternalStore(pasteValues.subscribe, pasteValues.get, () => null);

/* The two panels briefly linked to each other, so both could be open at
 * once. Removed at the owner's call: they are separate doors precisely so
 * the note surface stays uncluttered, and a link at the foot of each is
 * clutter that also implies they belong together. Reach either from the
 * card menu; the note you want to read next to your values is what Notes
 * view is for. */

/* ------------------------------------------------------------------ *
 *  THE NOTES COLUMN AND THE CARD MENU (owner, 2026-09-08): "when Notes
 *  mode is open and you right click to leave a note, it should take
 *  place over in the notes column instead of in the pop-up." Three tiny
 *  stores, one fact each, so the menu and keyNav can ask without
 *  knowing App's layout:
 *
 *  notesColumn -- which board the Notes column is showing, or null. The
 *    panel sets it while mounted. The menu's "Notes..." and keyNav's `n`
 *    open the popover unless this is their board, in which case they
 *    start a DRAFT instead.
 *  noteDraft -- a new parent note being written in the column, for a
 *    card: the panel renders it at the card's place in cut order, open
 *    for writing. Always a NEW note (never the newest one edited), so a
 *    second person can leave their own on the same card. Cleared on
 *    commit, or on walking off it empty.
 *  notesDrive -- whether the column holds the arrow keys ("if you click
 *    on the notes pane, the arrow keys should now be driving that"): on
 *    at a mousedown inside the panel, off at one anywhere else; keyNav's
 *    arrows stand aside while it is on.
 * ------------------------------------------------------------------ */
function makeValueStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(value, next)) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export const notesColumn = makeValueStore<string | null>(null);
export const useNotesColumn = (): string | null =>
  useSyncExternalStore(notesColumn.subscribe, notesColumn.get, () => null);

export interface NoteDraft {
  nodeId: string;
  boardId: string;
}
export const noteDraft = makeValueStore<NoteDraft | null>(null);
export const useNoteDraft = (): NoteDraft | null =>
  useSyncExternalStore(noteDraft.subscribe, noteDraft.get, () => null);

export const notesDrive = makeValueStore<boolean>(false);
export const useNotesDrive = (): boolean =>
  useSyncExternalStore(notesDrive.subscribe, notesDrive.get, () => false);

/* The one decision both doors make: the column, when it shows this
 * board, else the popover. */
export function openNoteFor(nodeId: string, boardId: string, depth: number, x: number, y: number) {
  if (notesColumn.get() === boardId) noteDraft.set({ nodeId, boardId });
  else notePanel.open(nodeId, boardId, depth, x, y);
}

/* THE NOTE BEING WRITTEN (owner, 2026-09-08: "when i'm actively editing
 * a note with the notes field open, the green dot should be pulsing in
 * size slightly and slowly to indicate it's in progress ... and to make
 * it easy to get your eye back to where the card you're editing the note
 * for is"): the card whose note is under edit right now -- a draft in
 * the column, a note body or reply being edited, a reply being composed,
 * or the popover open on it. board/noteMarks.ts paints the pulse on that
 * card's dot by one injected rule; the column's own row pulses its
 * swatch dot from its local state. */
export const noteEditing = makeValueStore<string | null>(null);
/* clear only if it is still ours: two editors' cleanups must not fight */
export function releaseEditing(nodeId: string) {
  if (noteEditing.get() === nodeId) noteEditing.set(null);
}

/* THE PLAYER HOLDS SPACE (owner, 2026-09-08: "when focused on the Player
 * pane in the video player, space bar should start and stop the video
 * playback"). On at a mousedown inside the player panel, off at one
 * anywhere else -- the notesDrive pattern. While on, Space is play /
 * pause, and the two other owners of that key (the card menu's tap in
 * keyNav, the hold-to-pan in spacePan) stand aside. */
export const playerDrive = makeValueStore<boolean>(false);
