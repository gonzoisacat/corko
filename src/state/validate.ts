/* ------------------------------------------------------------------ *
 *  Board-file sanitizer. Anything that enters the shared doc wholesale
 *  (Load board / import) goes through here FIRST, so a malformed or
 *  hand-edited file can never throw mid-transaction and leave the doc
 *  half-cleared for every collaborator. The rules:
 *
 *   - returns null only when there is no usable board at all (levels or
 *     roots missing/not arrays, or zero valid levels);
 *   - everything else is coerced to a well-formed Board: wrong-typed
 *     fields dropped or defaulted, numeric knobs clamped to their UI
 *     ranges, duplicate level/node ids de-duplicated, and nodes deeper
 *     than the leaf tier dropped (they could never render -- a node's
 *     tier is its depth in the ladder, ADR 0001).
 * ------------------------------------------------------------------ */

import { defaultLegend, deriveBorder } from "../colors";
import { sanitizeMark } from "./mark";
import { uid } from "./ids";
import { MAX_GAMMA, MAX_IMAGE_GAP, MAX_IMAGE_ROOM, MIN_GAMMA, MIN_IMAGE_ROOM } from "./types";
import type {
  Board,
  BoardType,
  Edge,
  FieldDef,
  LegendEntry,
  LevelDef,
  Node,
  Note,
  Project,
  SlotId,
  TagDef,
  BoardLook,
} from "./types";
import { SLOT_IDS, TAG_OFFSET, TAG_REACH, TAG_SPAN } from "./types";
import { readNoteState } from "./noteStates";
import { clampCell, clampSpan, DEFAULT_YARN, nearestYarnWidth } from "./gridBoard";
import { ALIGNS } from "../board/cardImage";

/* Hard cap on ladder depth -- mirrored by the "Add parent category" UI. */
export const MAX_TIERS = 6;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const optStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean => v === true;
const optBool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

function clampNum(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(min, Math.min(max, v));
}

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const optHex = (v: unknown): string | undefined =>
  typeof v === "string" && HEX_RE.test(v.trim()) ? v : undefined;

function sanitizeLevel(raw: unknown, seenIds: Set<string>): LevelDef | null {
  if (!isObj(raw)) return null;
  let id = str(raw.id) || uid("lvl");
  if (seenIds.has(id)) return null; // duplicate ladder entry (e.g. a merged file) -- drop
  seenIds.add(id);
  const f = isObj(raw.fields) ? raw.fields : {};
  const variant = raw.variant === "reel" || raw.variant === "section" ? raw.variant : "scene";
  const level: LevelDef = {
    id,
    name: str(raw.name),
    variant,
    fields: {
      color: bool(f.color),
      notes: bool(f.notes),
    },
  };
  const descriptor = optStr(raw.descriptor);
  if (descriptor !== undefined) level.descriptor = descriptor;
  const defaultFont = optStr(raw.defaultFont);
  if (defaultFont !== undefined) level.defaultFont = defaultFont;
  const aspect = clampNum(raw.aspect, 0.2, 5);
  if (aspect !== undefined) level.aspect = aspect;
  const height = clampNum(raw.height, 24, 400);
  if (height !== undefined) level.height = height;
  const textSize = clampNum(raw.textSize, 6, 60);
  if (textSize !== undefined) level.textSize = textSize;
  const textColor = optHex(raw.textColor);
  if (textColor !== undefined) level.textColor = textColor;
  const expandText = optBool(raw.expandText);
  if (expandText !== undefined) level.expandText = expandText;
  const fullWidth = optBool(raw.fullWidth);
  if (fullWidth !== undefined) level.fullWidth = fullWidth;
  const bandHeight = clampNum(raw.bandHeight, 28, 200);
  if (bandHeight !== undefined) level.bandHeight = bandHeight;
  if (raw.imageEdge === "left" || raw.imageEdge === "right") {
    level.imageEdge = raw.imageEdge;
  }
  const imageRoom = clampNum(raw.imageRoom, MIN_IMAGE_ROOM, MAX_IMAGE_ROOM);
  if (imageRoom !== undefined) level.imageRoom = imageRoom;
  const imageGap = clampNum(raw.imageGap, 0, MAX_IMAGE_GAP);
  if (imageGap !== undefined) level.imageGap = imageGap;
  const imageCenter = optBool(raw.imageCenter);
  if (imageCenter !== undefined) level.imageCenter = imageCenter;
  return level;
}

function sanitizeLegendEntry(raw: unknown, seenIds: Set<string>): LegendEntry | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id || seenIds.has(id)) return null;
  seenIds.add(id);
  const bg = optHex(raw.bg) ?? "#fcecad";
  const entry: LegendEntry = {
    id,
    label: str(raw.label),
    bg,
    border: optHex(raw.border) ?? deriveBorder(bg),
  };
  const tier = optStr(raw.tier);
  if (tier !== undefined) entry.tier = tier;
  // the only non-tier default so far: the fill for a nesting card
  if (raw.role === "nested") entry.role = "nested";
  return entry;
}

function sanitizeTag(raw: unknown, seenIds: Set<string>): TagDef | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id || seenIds.has(id)) return null;
  seenIds.add(id);
  return {
    id,
    name: str(raw.name),
    color: optHex(raw.color) ?? "#e5484d",
    // pos wraps rather than clamps -- it's a loop around the card
    pos: typeof raw.pos === "number" && Number.isFinite(raw.pos) ? ((raw.pos % 1) + 1) % 1 : 0,
    // reach/span were once length/width -- accept both so older files load
    reach: clampNum(raw.reach ?? raw.width, TAG_REACH.min, TAG_REACH.max) ?? TAG_REACH.default,
    span: clampNum(raw.span ?? raw.length, TAG_SPAN.min, TAG_SPAN.max) ?? TAG_SPAN.default,
    offset: clampNum(raw.offset, TAG_OFFSET.min, TAG_OFFSET.max) ?? 0,
    shape: raw.shape === "ribbon" ? "ribbon" : "flat",
    visible: raw.visible !== false,
    // absent (every file older than split tags) reads as the placed tab
    kind: raw.kind === "split" ? "split" : "tab",
  };
}

/* One note (or, one level down, one reply). `body` is the only thing worth
 * keeping a note for, so a note without one is dropped rather than
 * defaulted -- an empty note is a row of chrome nobody wrote. */
function sanitizeNote(raw: unknown, seenIds: Set<string>, top: boolean): Note | null {
  if (!isObj(raw)) return null;
  const body = str(raw.body);
  if (!body) return null;
  let id = str(raw.id) || uid("nt");
  if (seenIds.has(id)) id = uid("nt");
  seenIds.add(id);
  const note: Note = {
    id,
    body,
    author: str(raw.author),
    state: readNoteState(raw.state),
    createdAt:
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
  };
  // the implementation note is the top note's alone (state/types.ts Note)
  const impl = top ? optStr(raw.impl) : undefined;
  if (impl) {
    note.impl = impl;
    // its author and time ride only with the words (state/types.ts Note)
    const implBy = optStr(raw.implBy);
    if (implBy) note.implBy = implBy;
    if (typeof raw.implAt === "number" && Number.isFinite(raw.implAt)) note.implAt = raw.implAt;
  }
  // replies are one level deep by design (state/types.ts Note): a reply's
  // own `replies` is dropped rather than flattened, which would reorder a
  // conversation nobody can see any more anyway
  if (top && Array.isArray(raw.replies)) {
    const replies = raw.replies
      .map((r) => sanitizeNote(r, seenIds, false))
      .filter((r): r is Note => r !== null);
    if (replies.length) note.replies = replies;
  }
  return note;
}

function sanitizeField(raw: unknown, seenIds: Set<string>): FieldDef | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id || seenIds.has(id)) return null;
  seenIds.add(id);
  const field: FieldDef = { id, name: str(raw.name) };
  if (raw.showLabel === true) field.showLabel = true;
  return field;
}

function sanitizeNode(raw: unknown, depth: number, leaf: number, seenIds: Set<string>): Node | null {
  if (!isObj(raw)) return null;
  let id = str(raw.id) || uid("n" + depth);
  if (seenIds.has(id)) id = uid("n" + depth); // duplicate id in the file -> fresh id
  seenIds.add(id);
  const node: Node = {
    id,
    title: str(raw.title),
    collapsed: bool(raw.collapsed),
    children: [],
  };
  const subtitle = optStr(raw.subtitle);
  if (subtitle !== undefined) node.subtitle = subtitle;
  const tag = optStr(raw.tag);
  if (tag !== undefined) node.tag = tag;
  const color = optStr(raw.color);
  if (color !== undefined) node.color = color;
  // Notes: a list now, but a file written before the notes system carries a
  // single string -- normalize it to the one note it was (with the same
  // derived id the doc migration uses, so a file and a doc agree).
  if (Array.isArray(raw.notes)) {
    const noteIds = new Set<string>();
    const notes = raw.notes
      .map((n) => sanitizeNote(n, noteIds, true))
      .filter((n): n is Note => n !== null);
    if (notes.length) node.notes = notes;
  } else if (typeof raw.notes === "string" && raw.notes) {
    node.notes = [
      { id: "nt-" + id + "-0", body: raw.notes, author: "", state: "open", createdAt: 0 },
    ];
  }
  const font = optStr(raw.font);
  if (font !== undefined) node.font = font;
  const hidden = optBool(raw.hidden);
  if (hidden !== undefined) node.hidden = hidden;
  const breakAfter = optBool(raw.breakAfter);
  if (breakAfter !== undefined) node.breakAfter = breakAfter;
  /* A nested-board reference. The target board id is taken ON TRUST --
   * whether it RESOLVES is not this layer's question, exactly as a tag id
   * isn't: a single board FILE cannot carry the board it points at, and a
   * project file's ids are remapped at import (ops.importProject). An
   * unresolvable ref draws a tombstone rather than being scrubbed, so a
   * board that merely has not arrived yet keeps its link.
   *
   * The children of a nested node are dropped here, not just at the ops
   * layer: a hand-edited or older file could carry both, and the renderer
   * would then draw a card that silently hides content. */
  /* Free-grid geometry. Numbers only, and CLAMPED at load rather than
   * trusted: a hand-edited file could put a card at a negative cell or
   * give it a span the surface cannot draw. */
  const cell = raw.cell;
  if (isObj(cell) && typeof cell.x === "number" && typeof cell.y === "number") {
    node.cell = clampCell({ x: cell.x, y: cell.y });
  }
  const span = raw.span;
  if (isObj(span) && typeof span.w === "number" && typeof span.h === "number") {
    node.span = clampSpan({ w: span.w, h: span.h });
  }
  /* A picture, as a data URI. Only `data:image/...` is accepted: an
   * arbitrary URL in a shared board is a request the viewer's browser
   * would make to somebody else's server on open, which is a tracking
   * pixel with extra steps, and `javascript:` would be worse. */
  const image = optStr(raw.image);
  if (image && /^data:image\/(png|jpeg|webp|gif);base64,/.test(image)) node.image = image;
  /* A grabbed still is a KEY, not bytes -- so it is validated as a key
   * and nothing else. Narrow on purpose: it is used to build a
   * same-origin blob lookup, and anything that is not one of our own
   * minted keys has no business reaching that. */
  const still = optStr(raw.still);
  if (still && /^st-[A-Za-z0-9_-]{1,40}$/.test(still)) node.still = still;
  /* Only meaningful alongside an image, and only the non-default values
   * are kept -- the absence IS "fill", so a file cannot smuggle in a
   * third mode or a tile flag on a card with nothing to tile. */
  if (node.image || node.still) {
    // "corner" is RETIRED (types.ts) and falls through to Fill, its absence
    if (raw.imageFit === "fit" || raw.imageFit === "side") node.imageFit = raw.imageFit;
    if (raw.imageTile === true) node.imageTile = true;
    if (raw.imageMirror === true) node.imageMirror = true;
    if (raw.imageCorner === "tl" || raw.imageCorner === "tr" || raw.imageCorner === "bl") {
      node.imageCorner = raw.imageCorner; // "br" is the absence
    }
    /* Only one of the nine offered anchors survives -- an arbitrary
       object-position from a hand-edited file would be a crop the picker
       could never set back. */
    if (typeof raw.imageAlign === "string" && ALIGNS.includes(raw.imageAlign as never)) {
      node.imageAlign = raw.imageAlign;
    }
  }
  /* An OVERRIDE: anything but "top"/"bottom" -- absent included -- means
   * centered, so there is only ever one spelling of the default. Read
   * outside the image block on purpose: a card can be given a title
   * position and its picture removed, and the two are separate facts. */
  if (raw.titleAlign === "top" || raw.titleAlign === "bottom") {
    node.titleAlign = raw.titleAlign;
  }
  /* The other text overrides, same rule: absent means the tier decides. */
  if (typeof raw.textColor === "string" && raw.textColor.trim()) {
    node.textColor = raw.textColor.trim().slice(0, 32);
  }
  const tsz = clampNum(raw.textSize, 6, 200);
  if (tsz !== undefined) node.textSize = Math.round(tsz);
  if (raw.textShadow === true) node.textShadow = true;
  const boardRef = optStr(raw.boardRef);
  if (boardRef) {
    node.boardRef = boardRef;
    const refTitle = optStr(raw.boardRefTitle);
    if (refTitle !== undefined) node.boardRefTitle = refTitle;
  }
  if (Array.isArray(raw.tags)) {
    // ids only; whether they RESOLVE is settled at import time, where the
    // file's own tag definitions get merged into the project (ADR 0002)
    const tags = [...new Set(raw.tags.filter((t): t is string => typeof t === "string" && !!t))];
    if (tags.length) node.tags = tags;
  }
  if (isObj(raw.values)) {
    // category id -> value. Same deal as tags: keys are taken on trust here
    // and reconciled at import (the file's own categories get merged), but a
    // blank or non-string value is dropped -- it would be indistinguishable
    // from an unfilled category anyway.
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.values)) {
      if (k && typeof v === "string" && v !== "") values[k] = v;
    }
    if (Object.keys(values).length) node.values = values;
  }
  if (isObj(raw.slots)) {
    // slot -> category id. Unknown slot names are dropped (a card can only
    // show a value in one of the six places there are).
    const slots: Partial<Record<SlotId, string>> = {};
    for (const [k, v] of Object.entries(raw.slots)) {
      if ((SLOT_IDS as string[]).includes(k) && typeof v === "string" && v) {
        slots[k as SlotId] = v;
      }
    }
    if (Object.keys(slots).length) node.slots = slots;
  }
  /* Children BELOW the leaf tier are kept now (2026-08-02): they're
   * STOWED content -- a demoted lane's beats riding dormant on their
   * card, surfaced again by promoting it. They used to be dropped as
   * garbage; a file must not lose a stow. Depth still caps (a hostile
   * file can't recurse forever): the leaf plus one full ladder of
   * dormancy is more nesting than any real demotion produces. */
  if (!node.boardRef && depth < leaf + MAX_TIERS && Array.isArray(raw.children)) {
    node.children = raw.children
      .map((c) => sanitizeNode(c, depth + 1, leaf, seenIds))
      .filter((c): c is Node => c !== null);
  }
  return node;
}

/* Coerce an untrusted parsed JSON value into a well-formed Board, or null
 * if it isn't a board at all. Never throws. */
export function sanitizeBoard(raw: unknown): Board | null {
  if (!isObj(raw) || !Array.isArray(raw.levels) || !Array.isArray(raw.roots)) return null;
  const levelIds = new Set<string>();
  const levels = raw.levels
    .slice(0, MAX_TIERS)
    .map((l) => sanitizeLevel(l, levelIds))
    .filter((l): l is LevelDef => l !== null);
  if (levels.length === 0) return null;
  const leaf = levels.length - 1;

  const nodeIds = new Set<string>();
  const roots = raw.roots
    .map((r) => sanitizeNode(r, 0, leaf, nodeIds))
    .filter((r): r is Node => r !== null);

  const legendIds = new Set<string>();
  const legend = (Array.isArray(raw.legend) ? raw.legend : [])
    .map((e) => sanitizeLegendEntry(e, legendIds))
    // a tier-bound entry pointing at a level this file doesn't have is noise
    .filter((e): e is LegendEntry => e !== null && (!e.tier || levelIds.has(e.tier)));

  const board: Board = {
    id: str(raw.id) || uid("bd"),
    title: str(raw.title, "Untitled board"),
    levels,
    legend: legend.length ? legend : defaultLegend(levels),
    roots,
  };
  /* An unknown type is dropped rather than kept: absent reads as "cut",
   * which every renderer can draw, where a type this build has no
   * renderer for would leave the board blank. A file from a NEWER build
   * therefore degrades to a stacked board instead of to nothing -- the
   * same bargain the doc-level default makes for an older client. */
  const ty = str(raw.type);
  if (ty === "cut" || ty === "kanban" || ty === "grid") board.type = ty as BoardType;
  /* Yarn, kept only where BOTH ends are cards in this file -- an edge
   * pointing at a node the file does not carry can never be drawn. */
  if (Array.isArray(raw.edges)) {
    const ids = new Set<string>();
    const collect = (n: Node) => {
      ids.add(n.id);
      n.children.forEach(collect);
    };
    roots.forEach(collect);
    const edgeIds = new Set<string>();
    const edges: Edge[] = [];
    for (const e of raw.edges) {
      if (!isObj(e)) continue;
      const id = str(e.id) || uid("yn");
      const from = str(e.from);
      const to = str(e.to);
      if (edgeIds.has(id) || !from || !to || from === to) continue;
      if (!ids.has(from) || !ids.has(to)) continue;
      edgeIds.add(id);
      const edge: Edge = { id, from, to, color: optHex(e.color) ?? DEFAULT_YARN };
      /* SNAPPED to an offered width rather than dropped: a number from a
         hand-edited file, or a preset this build has retired, is usually
         one somebody chose -- so keep the intent and give it the closest
         thing this build can both draw and set back. The doc therefore
         only ever holds offered values. */
      if (typeof e.width === "number" && Number.isFinite(e.width)) {
        edge.width = nearestYarnWidth(e.width);
      }
      edges.push(edge);
    }
    if (edges.length) board.edges = edges;
  }
  /* Trimmed, and a blank is no folder at all -- the same rule metadata
   * values keep, so nothing carries a key meaning "filed under nothing
   * in particular". Capped so a hand-edited file cannot put a paragraph
   * in the shelf's heading row. */
  const folder = cleanFolder(raw.folder);
  if (folder.length) board.folder = folder;
  const mrb = clampNum(raw.maxRowBeats, 1, 10);
  if (mrb !== undefined) board.maxRowBeats = Math.round(mrb);
  const cs = clampNum(raw.cardSpacing, 8, 20);
  if (cs !== undefined) board.cardSpacing = Math.round(cs);
  const look = sanitizeLook(raw.look);
  if (look) board.look = look;
  const gamma = clampNum(raw.gamma, MIN_GAMMA, MAX_GAMMA);
  if (gamma !== undefined && gamma !== 1) board.gamma = gamma;
  // a board file carries the tag + metadata-category definitions its cards
  // reference, so it can be loaded into a project that has never seen them
  // (ADR 0002)
  const tagIds = new Set<string>();
  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((t) => sanitizeTag(t, tagIds))
    .filter((t): t is TagDef => t !== null);
  if (tags.length) board.tags = tags;
  const fieldIds = new Set<string>();
  const fields = (Array.isArray(raw.fields) ? raw.fields : [])
    .map((f) => sanitizeField(f, fieldIds))
    .filter((f): f is FieldDef => f !== null);
  if (fields.length) board.fields = fields;
  return board;
}

/* Coerce an untrusted parsed JSON value into a Project (the whole-project
 * export: every board in one file -- the durable backup). Boards that
 * don't survive sanitizeBoard are dropped rather than failing the file;
 * null only when there is no usable board at all. Never throws. */
/* A folder, normalized: its list of names with each one trimmed and the
 * blanks dropped.
 *
 * NO CHARACTER IS FORBIDDEN. That is the point of storing a list rather
 * than a joined path -- "Interviews / B-roll" is one perfectly ordinary
 * folder name, and nothing anybody types is silently turned into
 * something else. The only limits are size ones: a name long enough to
 * wreck a heading, and a nest deep enough to wreck the indent. */
export function cleanFolder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((seg): seg is string => typeof seg === "string")
    .map((seg) => seg.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 8);
}

/* The board's shared backdrop (state/types.ts BoardLook): a known kind,
 * a hex color, a boolean -- anything else is dropped (a `corkTint` from
 * the one-day dye is dropped too). */
export function sanitizeLook(raw: unknown): BoardLook | null {
  if (!isObj(raw)) return null;
  const bg = raw.bg;
  if (bg !== "default" && bg !== "slate" && bg !== "cork" && bg !== "custom") return null;
  const look: BoardLook = { bg };
  const custom = optHex(raw.custom);
  if (custom !== undefined) look.custom = custom;
  if (raw.grain === true) look.grain = true;
  return look;
}

export function sanitizeProject(raw: unknown): Project | null {
  if (!isObj(raw) || !Array.isArray(raw.boards)) return null;
  const boards = raw.boards
    .map((b) => sanitizeBoard(b))
    .filter((b): b is Board => b !== null);
  if (boards.length === 0) return null;
  const tagIds = new Set<string>();
  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((t) => sanitizeTag(t, tagIds))
    .filter((t): t is TagDef => t !== null);
  const fieldIds = new Set<string>();
  const fields = (Array.isArray(raw.fields) ? raw.fields : [])
    .map((f) => sanitizeField(f, fieldIds))
    .filter((f): f is FieldDef => f !== null);
  /* Folders, deduped. Two spellings of one name would be two folders
   * that look identical, so they are trimmed the same way a board's is
   * -- a file is just another peer's word for what exists. */
  const seen = new Set<string>();
  const folders: string[][] = [];
  for (const raw2 of Array.isArray(raw.folders) ? raw.folders : []) {
    const f = cleanFolder(raw2);
    if (!f.length) continue;
    const k = JSON.stringify(f);
    if (seen.has(k)) continue;
    seen.add(k);
    folders.push(f);
  }
  const project: Project = { title: str(raw.title, "Untitled project"), boards, tags, fields };
  if (folders.length) project.folders = folders;
  /* the project's color overrides (ADR 0006): options only -- a tier-bound
   * or role entry in a palette is a file lying about what it is */
  const paletteIds = new Set<string>();
  const palette = (Array.isArray(raw.palette) ? raw.palette : [])
    .map((e) => sanitizeLegendEntry(e, paletteIds))
    .filter((e): e is LegendEntry => e !== null && !e.tier && !e.role);
  if (palette.length) project.palette = palette;
  const mark = sanitizeMark(raw.mark);
  if (mark) project.mark = mark;
  return project;
}
