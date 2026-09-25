import { defaultLegend } from "../colors";
import { eventFrames, eventTitle, isRealReel, type EdlEvent, type EdlParse } from "./edl";
import { uid } from "./ids";
import { DOC_SHOTLIST_LEVELS } from "./landingTemplates";
import { formatDuration, type Rate } from "./timecode";
import type { Board, FieldDef, Node } from "./types";

/* ------------------------------------------------------------------ *
 *  A PARSED EDL -> A BOARD.
 *
 *  Pure: it returns a `Board` object and writes nothing. The caller
 *  hands that to `ops.importBoard`, which already mints fresh node ids
 *  and -- the part that matters -- lands the field definitions in the
 *  SAME transaction as the cards that reference them. That rule has been
 *  learned the hard way three times in this repo (import, project
 *  import, template): split them and a peer can receive the board alone,
 *  treat it as a remote transaction, and have `repairNodeVocab` strip
 *  every value off every card. Attaching `fields` to the Board is how
 *  this path inherits the fix rather than re-earning it.
 *
 *  IT IMPORTS EVERYTHING AND PLACES NOTHING (owner, 2026-08-27).
 *
 *  Every scrap the list carries about a shot arrives as a metadata
 *  VALUE, so it is all sitting in the More metadata panel with the
 *  categories already defined. NO display slots are written at all.
 *
 *  The first cut of this guessed a layout -- record-in top-left,
 *  duration top-right -- and an options step was designed to let you
 *  pick which fields went where. The owner cut both, and the reasoning
 *  is better than what it replaced: the app ALREADY has a layout editor
 *  (the metadata panel's slot preview) and a way to push one layout onto
 *  every card at a tier (`ops.applyLayout`). So the importer's job is to
 *  get the DATA in with nothing arranged; arranging it is a job the
 *  existing tools do better, once, on one card, propagated to the rest.
 *
 *  That also leaves the card face clear for the thing Phase B puts
 *  there, which is the picture.
 *
 *  THE SHAPE: Scene > Shot, every shot in ONE scene.
 *
 *  An EDL has no hierarchy in it -- events are a flat run -- so any
 *  grouping this produced (by source reel, by contiguous run, by every
 *  N) would be a guess dressed as data. Corko already has the right tool
 *  for a human to say where the scenes are: the seam's `+Scene` disc,
 *  which runs `ops.insertTierAt`, whose whole rule is "a card of tier T
 *  pinned at a point absorbs everything below it down to the next card
 *  of tier T or shallower". That IS carving a flat run into scenes, it
 *  is already tested, and it does it in one undo step.
 * ------------------------------------------------------------------ */

/* STABLE FIELD IDS, deliberately not minted per import.
 *
 * `mergeFields` adds definitions it does not already have and leaves
 * same-id ones alone, so fixed ids mean a second EDL imported into this
 * project files its values into the SAME categories rather than making
 * another set. That is what makes two reels of the same show comparable
 * -- and it is why these read `edl-*` rather than being uid()s, which
 * would be unique per import by construction. */
export const EDL_FIELDS = {
  shotNo: "edl-shot-no",
  clip: "edl-clip",
  reel: "edl-reel",
  srcIn: "edl-src-in",
  srcOut: "edl-src-out",
  recIn: "edl-rec-in",
  recOut: "edl-rec-out",
  duration: "edl-dur",
  transition: "edl-transition",
} as const;

/* Every category an imported shot can carry, in the order they are worth
 * reading. This IS the list the metadata panel shows, so the order is
 * the panel's reading order.
 *
 * SOURCE AND RECORD ARE FOUR SEPARATE FIELDS, not two (owner's
 * correction, 2026-08-27). On a single-source cut-down they happen to
 * hold the same values, which is a fact about that list rather than
 * about the format: source timecode is where a shot sits in the RUSHES
 * and record is where it sits in the CUT, and collapsing them would
 * throw away the distinction on every multi-source list.
 *
 * `showLabel` is on wherever the value alone could be anything -- a
 * timecode reads fine bare (ADR 0003's own example), a bare "3" or a
 * bare reel name does not. */
export const edlFieldDefs = (): FieldDef[] => [
  { id: EDL_FIELDS.shotNo, name: "Shot", showLabel: true },
  { id: EDL_FIELDS.clip, name: "Clip name" },
  { id: EDL_FIELDS.reel, name: "Source Reel", showLabel: true },
  { id: EDL_FIELDS.srcIn, name: "Source In" },
  { id: EDL_FIELDS.srcOut, name: "Source Out" },
  { id: EDL_FIELDS.recIn, name: "Record In" },
  { id: EDL_FIELDS.recOut, name: "Record Out" },
  { id: EDL_FIELDS.duration, name: "Duration" },
  { id: EDL_FIELDS.transition, name: "Transition", showLabel: true },
];

/* 16:9, because that is what the overwhelming majority of cut footage
 * is and a shot card should read as a frame. Overridden by the proxy's
 * own aspect whenever one is given. */
export const DEFAULT_SHOT_ASPECT = 16 / 9;

/* Anything outside this is a measurement gone wrong rather than a real
 * frame -- a zero-height video, a corrupt header -- and an aspect of 0
 * or 400 would produce a card that cannot be seen or cannot be escaped.
 * The tier's own slider is 0.5..4 in the Options menu. */
const clampAspect = (a: number): number =>
  !Number.isFinite(a) || a <= 0 ? DEFAULT_SHOT_ASPECT : Math.min(Math.max(a, 0.5), 4);

export interface EdlBoardOptions {
  /* The rate to read the timecodes at. The EDL does not state it (a real
   * gap in CMX3600), so the caller supplies one -- `parse.suggestedRate`
   * is the default the import dialog offers. */
  rate: Rate;
  /* Board title. Falls back to the EDL's own TITLE line, then to a
   * generic, so a list with no title still lands somewhere named. */
  title?: string;
  /* Which categories to bring in. Omitted = all of them, which is what
   * every test and any non-UI caller wants; the dialog passes the ticked
   * set. Categories left out are not defined AND not valued, so nothing
   * arrives that has to be tidied away afterwards. */
  fields?: ReadonlySet<string>;
  /* The proxy's aspect (width / height), so the cards are the shape of
   * the footage. Absent = 16:9. */
  aspect?: number;
  /* Grabbed frames, keyed by the event's INDEX in `parse.events`.
   *
   * By index and not by shot number, because a list can skip and repeat
   * event numbers -- the index is the only thing guaranteed to match one
   * card. The value is a BlobStore key; the bytes never come near here
   * or the doc (state/blobStore.ts says why at length). */
  stills?: ReadonlyMap<number, string>;
}

/* ------------------------------------------------------------------ *
 *  WHICH CATEGORIES A GIVEN LIST CAN ACTUALLY FILL.
 *
 *  The owner's question, and it has two halves with different answers
 *  (2026-08-28): "is that right? or just reading the EDL and then
 *  selecting from what's included".
 *
 *  THE SET IS FIXED BY THE FORMAT. CMX3600 carries exactly these nine
 *  things about an event and no more, so the list of categories on offer
 *  is knowable before any file is opened -- it does not have to be
 *  discovered.
 *
 *  WHICH OF THEM HOLD ANYTHING IS PER FILE, and varies a lot. His first
 *  export filled seven of nine: every event read `AX` (no reel) and every
 *  edit was a plain cut (no transition). A tape-based multi-camera list
 *  would fill all nine.
 *
 *  So the dialog offers the fixed nine and says how many shots each one
 *  would actually populate. Both halves of the question answered at once,
 *  and the count is what makes the choice informed rather than a guess --
 *  a category reading 0 is one you can see is pointless before you import
 *  it rather than after.
 * ------------------------------------------------------------------ */
export function edlFieldCounts(parse: EdlParse, rate: Rate): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of edlFieldDefs()) counts[f.id] = 0;
  for (const e of parse.events) {
    for (const k of Object.keys(shotValues(e, rate))) counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/* Every value this event can supply, before any picking. Shared with
 * `edlFieldCounts` so the number the dialog SHOWS and the value the
 * import WRITES come from one place -- if those drifted, the dialog
 * would promise data it does not deliver. */
function shotValues(e: EdlEvent, rate: Rate): Record<string, string> {
  const frames = eventFrames(e, rate);
  /* A BLANK IS NOT A VALUE (ADR 0003, and the ops enforce it): only
   * write keys that have something in them, or every card in a 500-shot
   * board carries a map of empty strings. Which is also why a plain cut
   * writes no Transition and a placeholder reel writes no Source Reel --
   * "C" on every card and "AX" on every card are noise, not data. */
  const values: Record<string, string> = {
    [EDL_FIELDS.shotNo]: String(e.num),
    [EDL_FIELDS.srcIn]: e.srcIn,
    [EDL_FIELDS.srcOut]: e.srcOut,
    [EDL_FIELDS.recIn]: e.recIn,
    [EDL_FIELDS.recOut]: e.recOut,
  };
  if (e.clipName) values[EDL_FIELDS.clip] = e.clipName;
  else if (e.sourceFile) values[EDL_FIELDS.clip] = e.sourceFile;
  if (isRealReel(e.reel)) values[EDL_FIELDS.reel] = e.reel;
  if (frames !== null && frames > 0) values[EDL_FIELDS.duration] = formatDuration(frames, rate);
  if (e.transition && e.transition.toUpperCase() !== "C") {
    values[EDL_FIELDS.transition] =
      e.transition + (e.transitionFrames !== null ? ` ${e.transitionFrames}` : "");
  }
  return values;
}

function shotNode(
  e: EdlEvent,
  rate: Rate,
  pick?: ReadonlySet<string>,
  still?: string,
): Node {
  const all = shotValues(e, rate);
  const values = pick
    ? Object.fromEntries(Object.entries(all).filter(([k]) => pick.has(k)))
    : all;
  return {
    id: uid("b"),
    title: eventTitle(e),
    collapsed: false,
    values,
    ...(still ? { still } : {}),
    /* NO `slots`. See the header -- the importer places nothing. The
     * still fills the face; arranging values on top of it is the
     * metadata panel's job. */
    children: [],
  };
}

/* Build the board. `fields` rides ON the board, which is what routes the
 * definitions through `importBoard`'s `withVocabulary` -- see the header. */
export function edlToBoard(parse: EdlParse, opts: EdlBoardOptions): Board {
  const { rate } = opts;
  const title = opts.title?.trim() || parse.title.trim() || "Imported shots";
  const scene: Node = {
    id: uid("g"),
    /* The one scene wears the SEQUENCE's name rather than being blank.
     * A nameless band reads as something that failed to load, and this
     * is the only lane on the board until it gets carved up -- at which
     * point renaming it is the first thing you would do anyway. */
    title,
    collapsed: false,
    children: parse.events.map((e, i) =>
      shotNode(e, rate, opts.fields, opts.stills?.get(i)),
    ),
  };
  /* A SHOT CARD IS THE SHAPE OF THE FOOTAGE (owner, 2026-08-28). 16:9 by
   * default, and the PROXY's real aspect when there is one -- which is
   * the same amount of code and is what makes 4:3 archival or a 2.39
   * scope master come out right rather than letterboxed into a shape
   * nothing in the cut has.
   *
   * The ladder is CLONED rather than handed over: `DOC_SHOTLIST_LEVELS`
   * is a module constant shared with the landing picker, so writing an
   * aspect onto it would silently re-shape every future shot-list board
   * made in this session. */
  const levels = DOC_SHOTLIST_LEVELS.map((l, i) =>
    i === DOC_SHOTLIST_LEVELS.length - 1
      ? { ...l, aspect: clampAspect(opts.aspect ?? DEFAULT_SHOT_ASPECT) }
      : { ...l },
  );
  return {
    id: uid("bd"),
    title,
    levels,
    legend: defaultLegend(levels),
    roots: [scene],
    /* Only the DEFINITIONS for what was actually brought in. A category
     * defined with nothing filed under it is a row in everyone's
     * metadata panel forever, on every card, for a column this import
     * decided not to carry. */
    fields: opts.fields ? edlFieldDefs().filter((f) => opts.fields!.has(f.id)) : edlFieldDefs(),
  };
}

/* The one-line count for the import dialog's head. The rate is NOT in
 * here -- the dialog has a picker for it, so stating it in prose as well
 * would be saying the same thing twice in one box. */
export function edlSummary(parse: EdlParse): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const bits = [plural(parse.events.length, "shot", "shots")];
  if (parse.audioOnlyEvents) {
    bits.push(plural(parse.audioOnlyEvents, "audio-only event", "audio-only events") + " ignored");
  }
  if (parse.unparsedLines) {
    bits.push(plural(parse.unparsedLines, "line", "lines") + " not understood");
  }
  return bits.join(" - ");
}
