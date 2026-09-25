/* ------------------------------------------------------------------ *
 *  Corko state layer -- one PROJECT per Yjs doc (Phase 4; spec Sec 6).
 *
 *    project (Y.Map)
 *      title:  string                  // the project (the film)
 *      tags:   Y.Array<Y.Map>          // tag vocabulary (ADR 0002)
 *      fields: Y.Array<Y.Map>          // metadata categories (spec Sec 7)
 *      boards: Y.Array<Y.Map>          // versions of the cut
 *        board (Y.Map): id, title
 *          levels: Y.Array<Y.Map>      // the tier ladder (per board)
 *          legend: Y.Array<Y.Map>      // color legend (per board)
 *          roots:  Y.Array<Y.Map>      // top-tier nodes
 *            node (Y.Map): id,title[,subtitle,tag,color,notes,...]
 *              tags:     Y.Array<string>  // applied tag ids
 *              values:   Y.Map<string>    // field id -> this card's value
 *              children: Y.Array<Y.Map>
 *
 *  A node's tier is its depth in ITS board's `levels`; node ids are
 *  unique across the whole doc (uid + repair), so node ops stay id-based
 *  and only root-level ops need an explicit board. Pre-Phase-4 docs kept
 *  the single board in a root "board" map; migrateLegacyBoard wraps that
 *  content as the project's first board (deterministically, so two peers
 *  migrating concurrently converge via the repair pass).
 *
 *  The render layer never touches Yjs directly -- it reads immutable
 *  snapshots (getSnapshot) and calls ops.*, each one transaction.
 * ------------------------------------------------------------------ */

import { IntentJournal, diffNode, localStorageIntent, same as sameValue, type IntentEntry } from "./intent";
import { scoped } from "./project";
import { hoistNeeded, planHoist } from "./palette";
import { MAX_POOL, sameDesign, sanitizeDesign, sanitizeMark } from "./mark";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { defaultLegend, deriveBorder, nestedDefault, tierDefaultFor, tierLabel, TAG_COLORS } from "../colors";
import { uid } from "./ids";
import { MAX_TIERS, cleanFolder, sanitizeLook } from "./validate";
import type { BoardTemplate } from "./template";
import { withTierDefaults, tierDefault } from "./tierDefaults";
import type {
  MarkDesign,
  MarkState,
  Board,
  BoardType,
  Cell,
  Edge,
  FieldDef,
  LegendEntry,
  LevelDef,
  Node,
  NodeField,
  Note,
  Project,
  SlotId,
  TagDef,
  Span,
  SplitAxis, BoardLook, ImageEdge } from "./types";
import { readNoteState } from "./noteStates";
import { MAX_GAMMA, MAX_IMAGE_GAP, MAX_IMAGE_ROOM, MIN_GAMMA, MIN_IMAGE_ROOM, SLOT_IDS, TAG_REACH, TAG_SPAN } from "./types";
import { clampCell, clampSpan, DEFAULT_YARN, DEFAULT_YARN_WIDTH, edgeBetween } from "./gridBoard";
import { gridFromBoard } from "./gridFrom";

type YMap = Y.Map<unknown>;
type YArr = Y.Array<YMap>;
/* The folder list holds one list of NAMES per folder, not maps -- the
 * names ARE the identity, so there is nothing else to store per entry. */
type YStrArr = Y.Array<string[]>;

export const doc = new Y.Doc();
export const projectMap = doc.getMap("project") as YMap;
/* Pre-Phase-4 shape: the whole board lived here. Kept only as the
 * migration source; cleared once wrapped into the project. */
export const legacyBoardMap = doc.getMap("board") as YMap;

/* Same DB as before the project migration -- the doc is the same doc,
 * only its internal shape changed; existing local data must survive. */
/* Per project (state/project.ts): the default project keeps the name it
 * has always had; any other gets its own database, or a client would
 * load project A off disk and push it into project B's room. */
const DB_NAME = scoped("corko-board-v2");
export const provider = new IndexeddbPersistence(DB_NAME, doc);

/* The migrated legacy board gets this id on EVERY peer, so concurrent
 * migrations produce boards the repair pass can converge. */
export const LEGACY_BOARD_ID = "board-legacy";

/* ---- accessors ---------------------------------------------------- */

const asArr = (v: unknown): YArr | null => (v instanceof Y.Array ? (v as YArr) : null);

const boardsArr = (): YArr | null => asArr(projectMap.get("boards"));
const tagsArr = (): YArr | null => asArr(projectMap.get("tags"));
const ensureTagsArr = (): YArr => {
  const cur = tagsArr();
  if (cur) return cur;
  const a = new Y.Array() as YArr;
  projectMap.set("tags", a);
  return a;
};
const fieldsArr = (): YArr | null => asArr(projectMap.get("fields"));
const ensureFieldsArr = (): YArr => {
  const cur = fieldsArr();
  if (cur) return cur;
  const a = new Y.Array() as YArr;
  projectMap.set("fields", a);
  return a;
};
/* THE PROJECT PALETTE (ADR 0006): the color overrides, project-level like
 * the tags above. state/palette.ts says why and what moves up here. */
const paletteArr = (): YArr | null => asArr(projectMap.get("palette"));
const ensurePaletteArr = (): YArr => {
  const cur = paletteArr();
  if (cur) return cur;
  const a = new Y.Array() as YArr;
  projectMap.set("palette", a);
  return a;
};
/* stable identity for the (common) no-tags / no-fields case, so snapshots
 * that share structure keep sharing it */
const EMPTY_TAGS: TagDef[] = [];
const EMPTY_FIELDS: FieldDef[] = [];
const EMPTY_PALETTE: LegendEntry[] = [];
const EMPTY_EDGES: Edge[] = [];
const ensureBoardsArr = (): YArr => {
  let a = boardsArr();
  if (!a) {
    a = new Y.Array() as YArr;
    projectMap.set("boards", a);
  }
  return a;
};

const foldersArr = (): YStrArr | null =>
  (asArr(projectMap.get("folders")) as unknown as YStrArr | null);
const ensureFolders = (): YStrArr => {
  let a = foldersArr();
  if (!a) {
    a = new Y.Array() as YStrArr;
    projectMap.set("folders", a);
  }
  return a;
};
/* Walk every board map. Folder ops are prefix rewrites over the whole
 * shelf rather than a lookup by id, so they all need this. */
function eachBoard(fn: (m: YMap) => void) {
  const boards = boardsArr();
  if (!boards) return;
  for (let i = 0; i < boards.length; i++) fn(boards.get(i));
}
/* Folder arithmetic on LISTS of names. A subfolder IS its parent's list
 * plus one more name, so "is A inside B" is an array prefix test and
 * re-parenting is a prefix swap -- the same cheap operations a joined
 * path gave, without making any character special. */
const sameFolder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((seg, i) => seg === b[i]);
const isUnder = (f: readonly string[], root: readonly string[]): boolean =>
  f.length > root.length && root.every((seg, i) => seg === f[i]);
const rebase = (f: readonly string[], from: readonly string[], to: readonly string[]): string[] => [
  ...to,
  ...f.slice(from.length),
];

function boardMapById(id: string): YMap | null {
  const boards = boardsArr();
  if (!boards) return null;
  for (let i = 0; i < boards.length; i++) {
    const m = boards.get(i);
    if (m.get("id") === id) return m;
  }
  return null;
}

type BoardPart = "levels" | "legend" | "roots" | "edges";
const partArr = (board: YMap, key: BoardPart): YArr | null => asArr(board.get(key));
const ensurePart = (board: YMap, key: BoardPart): YArr => {
  let a = partArr(board, key);
  if (!a) {
    a = new Y.Array() as YArr;
    board.set(key, a);
  }
  return a;
};

/* The tier map at `depth` of a board, or null. */
function levelAt(boardId: string, depth: number): YMap | null {
  const b = boardMapById(boardId);
  const arr = b && partArr(b, "levels");
  return arr && depth >= 0 && depth < arr.length ? arr.get(depth) : null;
}

/* ---- builders: plain object -> Y type ----------------------------- */

function buildNodeY(n: Node): YMap {
  const m = new Y.Map() as YMap;
  m.set("id", n.id);
  m.set("title", n.title);
  m.set("collapsed", n.collapsed);
  if (n.subtitle !== undefined) m.set("subtitle", n.subtitle);
  if (n.tag !== undefined) m.set("tag", n.tag);
  if (n.color !== undefined) m.set("color", n.color);
  if (n.notes?.length) {
    const notes = new Y.Array() as YArr;
    notes.push(n.notes.map(buildNoteY));
    m.set("notes", notes);
  }
  if (n.font !== undefined) m.set("font", n.font);
  if (n.hidden !== undefined) m.set("hidden", n.hidden);
  if (n.breakAfter !== undefined) m.set("breakAfter", n.breakAfter);
  if (n.boardRef !== undefined) m.set("boardRef", n.boardRef);
  if (n.boardRefTitle !== undefined) m.set("boardRefTitle", n.boardRefTitle);
  /* Free-grid fields. `cell` and `span` are stored as ONE value each --
   * see types.ts: a position that could merge half from one peer and
   * half from another would land the card where neither person put it. */
  if (n.cell) m.set("cell", { x: n.cell.x, y: n.cell.y });
  if (n.span) m.set("span", { w: n.span.w, h: n.span.h });
  if (n.image) m.set("image", n.image);
  /* A grabbed still: the KEY only. The bytes live in the BlobStore
   * (state/blobStore.ts) precisely so they never reach here -- a still
   * per shot in the doc is 7.5 MB for 500 shots against a 740 KB
   * project, rewritten whole on every save and unreclaimable. */
  if (n.still) m.set("still", n.still);
  if (n.imageFit === "fit" || n.imageFit === "side") m.set("imageFit", n.imageFit); // "corner" is retired -> Fill
  if (n.imageCorner && n.imageCorner !== "br") m.set("imageCorner", n.imageCorner);
  if (n.imageTile) m.set("imageTile", true);
  if (n.imageMirror) m.set("imageMirror", true);
  if (n.imageAlign) m.set("imageAlign", n.imageAlign);
  if (n.titleAlign) m.set("titleAlign", n.titleAlign);
  if (n.textColor) m.set("textColor", n.textColor);
  if (n.textSize !== undefined) m.set("textSize", n.textSize);
  if (n.textShadow) m.set("textShadow", true);
  if (n.tags?.length) {
    const tags = new Y.Array<string>();
    tags.push([...n.tags]);
    m.set("tags", tags);
  }
  if (n.slots) {
    const entries = Object.entries(n.slots).filter(([, v]) => typeof v === "string" && v !== "");
    if (entries.length) {
      const slots = new Y.Map<string>();
      for (const [k, v] of entries) slots.set(k, v as string);
      m.set("slots", slots);
    }
  }
  if (n.values) {
    // a blank value is the same as no value -- never store one, so a card
    // with nothing filled in carries no `values` map at all
    const entries = Object.entries(n.values).filter(([, v]) => typeof v === "string" && v !== "");
    if (entries.length) {
      const values = new Y.Map<string>();
      for (const [k, v] of entries) values.set(k, v);
      m.set("values", values);
    }
  }
  const children = new Y.Array() as YArr;
  children.push(n.children.map(buildNodeY));
  m.set("children", children);
  return m;
}

function buildLevelY(l: LevelDef): YMap {
  const m = new Y.Map() as YMap;
  m.set("id", l.id);
  m.set("name", l.name);
  m.set("variant", l.variant);
  if (l.descriptor !== undefined) m.set("descriptor", l.descriptor);
  if (l.defaultFont !== undefined) m.set("defaultFont", l.defaultFont);
  if (l.aspect !== undefined) m.set("aspect", l.aspect);
  if (l.height !== undefined) m.set("height", l.height);
  if (l.textSize !== undefined) m.set("textSize", l.textSize);
  if (l.textColor !== undefined) m.set("textColor", l.textColor);
  if (l.expandText !== undefined) m.set("expandText", l.expandText);
  if (l.fullWidth !== undefined) m.set("fullWidth", l.fullWidth);
  if (l.bandHeight !== undefined) m.set("bandHeight", l.bandHeight);
  if (l.imageEdge !== undefined) m.set("imageEdge", l.imageEdge);
  if (l.imageRoom !== undefined) m.set("imageRoom", l.imageRoom);
  if (l.imageGap !== undefined) m.set("imageGap", l.imageGap);
  if (l.imageCenter !== undefined) m.set("imageCenter", l.imageCenter);
  const f = new Y.Map() as YMap;
  f.set("color", l.fields.color);
  f.set("notes", l.fields.notes);
  m.set("fields", f);
  return m;
}

function buildTagY(t: TagDef): YMap {
  const m = new Y.Map() as YMap;
  m.set("id", t.id);
  m.set("name", t.name);
  m.set("color", t.color);
  m.set("pos", t.pos);
  m.set("reach", t.reach);
  m.set("span", t.span);
  m.set("offset", t.offset);
  m.set("shape", t.shape);
  m.set("visible", t.visible);
  m.set("kind", t.kind ?? "tab");
  return m;
}

function buildNoteY(n: Note): YMap {
  const m = new Y.Map() as YMap;
  m.set("id", n.id);
  m.set("body", n.body);
  m.set("author", n.author);
  m.set("state", n.state);
  m.set("createdAt", n.createdAt);
  if (n.impl) {
    m.set("impl", n.impl);
    if (n.implBy) m.set("implBy", n.implBy);
    if (typeof n.implAt === "number") m.set("implAt", n.implAt);
  }
  if (n.replies?.length) {
    const replies = new Y.Array() as YArr;
    replies.push(n.replies.map(buildNoteY));
    m.set("replies", replies);
  }
  return m;
}

function noteToPlain(m: YMap): Note {
  const n: Note = {
    id: m.get("id") as string,
    body: (m.get("body") as string) ?? "",
    author: (m.get("author") as string) ?? "",
    state: readNoteState(m.get("state")),
    createdAt: typeof m.get("createdAt") === "number" ? (m.get("createdAt") as number) : 0,
  };
  const impl = m.get("impl");
  if (typeof impl === "string" && impl) {
    n.impl = impl;
    const implBy = m.get("implBy");
    if (typeof implBy === "string" && implBy) n.implBy = implBy;
    const implAt = m.get("implAt");
    if (typeof implAt === "number") n.implAt = implAt;
  }
  const replies = m.get("replies");
  if (replies instanceof Y.Array && replies.length) {
    n.replies = (replies as YArr).toArray().map(noteToPlain);
  }
  return n;
}

/* The single note a pre-notes-system card carried, as a Note. Its id is
 * DERIVED from the node's, never minted: two peers migrating the same doc
 * concurrently then produce the identical note, so the merge has nothing to
 * reconcile (the same trick as LEGACY_BOARD_ID). createdAt 0 = unknown, it
 * predates the system. */
const legacyNote = (nodeId: string, body: string): Note => ({
  id: "nt-" + nodeId + "-0",
  body,
  author: "",
  state: "open",
  createdAt: 0,
});

function buildFieldY(f: FieldDef): YMap {
  const m = new Y.Map() as YMap;
  m.set("id", f.id);
  m.set("name", f.name);
  if (f.showLabel) m.set("showLabel", true);
  return m;
}

function fieldToPlain(m: YMap): FieldDef {
  const f: FieldDef = { id: m.get("id") as string, name: (m.get("name") as string) ?? "" };
  if (m.get("showLabel") === true) f.showLabel = true;
  return f;
}

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function tagToPlain(m: YMap): TagDef {
  return {
    id: m.get("id") as string,
    name: (m.get("name") as string) ?? "",
    color: (m.get("color") as string) ?? "#e0b3ff",
    pos: typeof m.get("pos") === "number" ? (m.get("pos") as number) : 0,
    // `length`/`width` are the pre-rename keys: same geometry, clearer names
    // (docs/adr/0002). Read them so tags made before the rename keep their look.
    reach: num(m.get("reach") ?? m.get("width"), TAG_REACH.default),
    span: num(m.get("span") ?? m.get("length"), TAG_SPAN.default),
    offset: num(m.get("offset"), 0),
    shape: m.get("shape") === "ribbon" ? "ribbon" : "flat",
    // a doc written before split tags has no `kind`; it means "tab"
    kind: m.get("kind") === "split" ? "split" : "tab",
    visible: m.get("visible") !== false,
  };
}

function buildLegendY(e: LegendEntry): YMap {
  const m = new Y.Map() as YMap;
  m.set("id", e.id);
  m.set("label", e.label);
  m.set("bg", e.bg);
  m.set("border", e.border);
  if (e.tier !== undefined) m.set("tier", e.tier);
  if (e.role !== undefined) m.set("role", e.role);
  return m;
}

/* Yarn. A Y.Map per string rather than one opaque array value, so
 * recoloring one does not rewrite them all -- the same shape the legend
 * uses, for the same reason. */
function buildEdgeY(e: Edge): YMap {
  const m = new Y.Map() as YMap;
  m.set("id", e.id);
  m.set("from", e.from);
  m.set("to", e.to);
  m.set("color", e.color);
  if (e.width !== undefined) m.set("width", e.width);
  return m;
}

function edgeToPlain(m: YMap): Edge {
  return {
    id: (m.get("id") as string) ?? "",
    from: (m.get("from") as string) ?? "",
    to: (m.get("to") as string) ?? "",
    color: (m.get("color") as string) ?? DEFAULT_YARN,
    /* Absent stays absent rather than defaulting here, so `yarnWidth`
       stays the ONE place that decides what an unset width draws at. */
    ...(typeof m.get("width") === "number" ? { width: m.get("width") as number } : {}),
  };
}

function buildBoardY(b: Board): YMap {
  const m = new Y.Map() as YMap;
  m.set("id", b.id);
  m.set("title", b.title);
  // absent = "cut", so a cut board writes nothing and an older client
  // reads every board it already understood (state/types.ts BoardType)
  if (b.type !== undefined && b.type !== "cut") m.set("type", b.type);
  // absent = filed nowhere; never store an empty list
  if (b.folder?.length) m.set("folder", [...b.folder]);
  if (b.maxRowBeats !== undefined) m.set("maxRowBeats", b.maxRowBeats);
  if (b.cardSpacing !== undefined) m.set("cardSpacing", b.cardSpacing);
  if (b.look) m.set("look", { ...b.look }); // one plain value, like the mark
  if (b.gamma !== undefined && b.gamma !== 1) m.set("gamma", b.gamma);
  const levels = new Y.Array() as YArr;
  levels.push(b.levels.map(buildLevelY));
  m.set("levels", levels);
  const legend = new Y.Array() as YArr;
  // never store an empty legend: peers would each materialize + push a
  // default copy, duplicating it
  const leg = b.legend && b.legend.length ? b.legend : defaultLegend(b.levels);
  legend.push(leg.map(buildLegendY));
  m.set("legend", legend);
  const roots = new Y.Array() as YArr;
  roots.push(b.roots.map(buildNodeY));
  m.set("roots", roots);
  if (b.edges?.length) {
    const edges = new Y.Array() as YArr;
    edges.push(b.edges.map(buildEdgeY));
    m.set("edges", edges);
  }
  return m;
}

/* ---- readers: Y type -> plain object (snapshot) ------------------- */

function nodeToPlainWith(m: YMap, mapChild: (c: YMap) => Node): Node {
  const children = (m.get("children") as YArr | undefined)?.toArray() ?? [];
  const n: Node = {
    id: m.get("id") as string,
    title: (m.get("title") as string) ?? "",
    collapsed: Boolean(m.get("collapsed")),
    children: children.map(mapChild),
  };
  const sub = m.get("subtitle");
  const tag = m.get("tag");
  const color = m.get("color");
  const font = m.get("font");
  const hidden = m.get("hidden");
  if (sub !== undefined) n.subtitle = sub as string;
  if (tag !== undefined) n.tag = tag as string;
  if (color !== undefined) n.color = color as string;
  if (font !== undefined) n.font = font as string;
  const notes = m.get("notes");
  if (notes instanceof Y.Array && notes.length) {
    n.notes = (notes as YArr).toArray().map(noteToPlain);
  } else if (typeof notes === "string" && notes) {
    // A pre-notes-system doc: one anonymous note as a plain string. The
    // repair pass rewrites these in the doc (migrateLegacyNotes), but read
    // tolerantly too -- a peer can project the doc in the window before its
    // migration runs, and a note must never vanish from the UI meanwhile.
    n.notes = [legacyNote(n.id, notes)];
  }
  if (hidden !== undefined) n.hidden = Boolean(hidden);
  const brk = m.get("breakAfter");
  if (brk !== undefined) n.breakAfter = Boolean(brk);
  const ref = m.get("boardRef");
  if (typeof ref === "string" && ref) {
    n.boardRef = ref;
    const refTitle = m.get("boardRefTitle");
    if (typeof refTitle === "string") n.boardRefTitle = refTitle;
  }
  const cell = m.get("cell") as { x?: unknown; y?: unknown } | undefined;
  if (cell && typeof cell.x === "number" && typeof cell.y === "number") {
    n.cell = { x: cell.x, y: cell.y };
  }
  const span = m.get("span") as { w?: unknown; h?: unknown } | undefined;
  if (span && typeof span.w === "number" && typeof span.h === "number") {
    n.span = { w: span.w, h: span.h };
  }
  const image = m.get("image");
  if (typeof image === "string" && image) n.image = image;
  const still = m.get("still");
  if (typeof still === "string" && still) n.still = still;
  /* Both are stored as an ABSENCE when they hold the default, so a card
   * set back to Fill is indistinguishable from one nobody touched. */
  const fitV = m.get("imageFit");
  if (fitV === "fit" || fitV === "side") n.imageFit = fitV; // a stored "corner" is retired -> Fill
  const cornerV = m.get("imageCorner");
  if (cornerV === "tl" || cornerV === "tr" || cornerV === "bl") n.imageCorner = cornerV;
  if (m.get("imageTile") === true) n.imageTile = true;
  if (m.get("imageMirror") === true) n.imageMirror = true;
  const align = m.get("imageAlign");
  if (typeof align === "string" && align) n.imageAlign = align;
  const ta = m.get("titleAlign");
  if (ta === "top" || ta === "bottom") n.titleAlign = ta;
  const tc = m.get("textColor");
  if (typeof tc === "string" && tc) n.textColor = tc;
  const ts = m.get("textSize");
  if (typeof ts === "number") n.textSize = ts;
  if (m.get("textShadow") === true) n.textShadow = true;
  const tags = m.get("tags");
  if (tags instanceof Y.Array && tags.length) n.tags = tags.toArray() as string[];
  const values = m.get("values");
  if (values instanceof Y.Map && values.size) {
    const out: Record<string, string> = {};
    for (const [k, v] of values.entries()) if (typeof v === "string" && v !== "") out[k] = v;
    if (Object.keys(out).length) n.values = out;
  }
  const slots = m.get("slots");
  if (slots instanceof Y.Map && slots.size) {
    const out: Partial<Record<SlotId, string>> = {};
    for (const [k, v] of slots.entries()) {
      if (typeof v === "string" && v !== "" && (SLOT_IDS as string[]).includes(k)) {
        out[k as SlotId] = v;
      }
    }
    if (Object.keys(out).length) n.slots = out;
  }
  return n;
}

/* Uncached projection -- used by ops that snapshot a subtree mid-mutation
 * (relocate/duplicate/extract), where the cache could be stale within the
 * transaction. */
const nodeToPlain = (m: YMap): Node => nodeToPlainWith(m, nodeToPlain);

function levelToPlain(m: YMap): LevelDef {
  const f = m.get("fields") as YMap | undefined;
  const level: LevelDef = {
    id: m.get("id") as string,
    name: (m.get("name") as string) ?? "",
    variant: (m.get("variant") as LevelDef["variant"]) ?? "scene",
    fields: {
      color: Boolean(f?.get("color")),
      notes: Boolean(f?.get("notes")),
    },
  };
  const desc = m.get("descriptor");
  if (desc !== undefined) level.descriptor = desc as string;
  const df = m.get("defaultFont");
  if (df !== undefined) level.defaultFont = df as string;
  const asp = m.get("aspect");
  if (asp !== undefined) level.aspect = asp as number;
  const h = m.get("height");
  if (h !== undefined) level.height = h as number;
  const ts = m.get("textSize");
  if (ts !== undefined) level.textSize = ts as number;
  const tc = m.get("textColor");
  if (tc !== undefined) level.textColor = tc as string;
  const ex = m.get("expandText");
  if (ex !== undefined) level.expandText = ex as boolean;
  const fw = m.get("fullWidth");
  if (fw !== undefined) level.fullWidth = fw as boolean;
  const bh = m.get("bandHeight");
  if (bh !== undefined) level.bandHeight = bh as number;
  const ie = m.get("imageEdge");
  if (ie === "left" || ie === "right") level.imageEdge = ie; // above/below not offered yet
  const ir = m.get("imageRoom");
  if (ir !== undefined) level.imageRoom = ir as number;
  const ig = m.get("imageGap");
  if (ig !== undefined) level.imageGap = ig as number;
  const ic = m.get("imageCenter");
  if (ic !== undefined) level.imageCenter = ic as boolean;
  return level;
}

/* Point a tier's default-color legend entry at the level's current
 * label (name + descriptor). Caller is inside a transaction. */
function relabelTierEntry(board: YMap, level: YMap) {
  const levelId = level.get("id");
  const label = tierLabel(level.get("name") as string, level.get("descriptor") as string | undefined);
  const legend = ensureLegend(board);
  for (let i = 0; i < legend.length; i++) {
    const e = legend.get(i);
    if (e.get("tier") === levelId) {
      e.set("label", label);
      return;
    }
  }
}

function legendToPlain(m: YMap): LegendEntry {
  const entry: LegendEntry = {
    id: m.get("id") as string,
    label: (m.get("label") as string) ?? "",
    bg: (m.get("bg") as string) ?? "#fcecad",
    border: (m.get("border") as string) ?? "#efd98a",
  };
  const tier = m.get("tier");
  if (tier !== undefined) entry.tier = tier as string;
  if (m.get("role") === "nested") entry.role = "nested";
  return entry;
}

/* Full uncached board projection (duplicateBoard, migration). */
function boardToPlain(m: YMap): Board {
  const levels = partArr(m, "levels")?.toArray().map(levelToPlain) ?? [];
  const legend = partArr(m, "legend")?.toArray().map(legendToPlain) ?? [];
  const b: Board = {
    id: (m.get("id") as string) ?? uid("bd"),
    title: (m.get("title") as string) ?? "",
    levels,
    legend,
    roots: partArr(m, "roots")?.toArray().map(nodeToPlain) ?? [],
  };
  const ty = m.get("type");
  if (ty !== undefined) b.type = ty as BoardType;
  const fol = cleanFolder(m.get("folder"));
  if (fol.length) b.folder = fol;
  const mrb = m.get("maxRowBeats");
  if (mrb !== undefined) b.maxRowBeats = mrb as number;
  const cs = m.get("cardSpacing");
  if (cs !== undefined) b.cardSpacing = cs as number;
  const look = sanitizeLook(m.get("look"));
  if (look) b.look = look;
  const gm = m.get("gamma");
  if (typeof gm === "number" && gm !== 1) b.gamma = gm;
  const eg = partArr(m, "edges");
  if (eg?.length) b.edges = eg.toArray().map(edgeToPlain);
  return b;
}

/* ---- structural-sharing snapshot ---------------------------------- *
 * Plain nodes are cached per Y.Map and each board caches its three
 * projected parts; observeDeep invalidates only the changed subtree's
 * ancestor chain. Untouched boards/subtrees keep exact object identity
 * across snapshots, so per-pane useBoard(id) slices bail out and
 * memoized rows/proxies skip re-render. */

const nodeCache = new WeakMap<YMap, Node>();
function nodeToPlainCached(m: YMap): Node {
  const hit = nodeCache.get(m);
  if (hit) return hit;
  const n = nodeToPlainWith(m, nodeToPlainCached);
  nodeCache.set(m, n);
  return n;
}

interface BoardCache {
  snap: Board | null;
  levels: LevelDef[] | null;
  legend: LegendEntry[] | null;
  legendFallback: boolean; // legend derived from levels -> recouple
  paletteV: number; // the palette version the legend was derived against
  roots: Node[] | null;
  edges: Edge[] | null; // free-grid yarn
}
const boardCaches = new WeakMap<YMap, BoardCache>();
function boardCacheFor(m: YMap): BoardCache {
  let c = boardCaches.get(m);
  if (!c) {
    c = { snap: null, levels: null, legend: null, legendFallback: false, paletteV: -1, roots: null, edges: null };
    boardCaches.set(m, c);
  }
  return c;
}

/* The project-level vocabularies are projected once and cached too, so the
 * many cards that subscribe to them (useTags) keep an identity-stable array
 * across unrelated edits -- a fresh array per snapshot would re-render every
 * mounted card on every keystroke elsewhere. */
let tagsSnap: TagDef[] | null = null;
let fieldsSnap: FieldDef[] | null = null;
let paletteSnap: LegendEntry[] | null = null;
/* The palette is appended to EVERY board's projected legend, so a change
 * to it is a change to every board's legend part (and snapshot). */
let paletteVersion = 0;
function paletteChanged(): void {
  paletteSnap = null;
  paletteVersion++; // every board cache re-derives its legend on next read
}

projectMap.observeDeep((events) => {
  // also re-mark dirty here: deep observers and the doc "update" event fire
  // in the same transaction cleanup, and we don't want to depend on order
  dirty = true;
  /* The intent journal (state/intent.ts) wants, per NODE map this
   * transaction touched, the plain node from BEFORE it -- which is
   * exactly what the cache holds until the loop below clears it. */
  const touched = new Map<YMap, Node>();
  const origin = events[0]?.transaction.origin;
  for (const e of events) {
    if (e.target === projectMap) {
      // the project map's own keys. title / boards are rebuilt per snapshot,
      // but a vocabulary can be REPLACED wholesale (first write, import) and
      // its cache has to notice.
      const keys = (e as Y.YMapEvent<unknown>).keysChanged;
      if (keys.has("tags")) tagsSnap = null;
      if (keys.has("fields")) fieldsSnap = null;
      if (keys.has("palette")) paletteChanged();
      continue;
    }
    // climb to the project map, clearing cached plain nodes along the way
    const chain: unknown[] = [];
    let t: unknown = e.target;
    while (t && t !== projectMap) {
      chain.push(t);
      if (t instanceof Y.Map) {
        const was = nodeCache.get(t as YMap);
        if (was && !touched.has(t as YMap) && (t as YMap).has("children")) touched.set(t as YMap, was);
        nodeCache.delete(t as YMap);
      }
      t = (t as Y.AbstractType<Y.YEvent<Y.Map<unknown>>>).parent;
    }
    if (!t) continue; // never reached the project map: not projected
    // a vocabulary array, or one definition inside it
    const top = chain[chain.length - 1];
    if (top === projectMap.get("tags")) {
      tagsSnap = null;
      continue;
    }
    if (top === projectMap.get("fields")) {
      fieldsSnap = null;
      continue;
    }
    if (top === projectMap.get("palette")) {
      paletteChanged();
      continue;
    }
    // chain ends [..., boardMap, boardsArr]; length 1 = the boards array itself
    if (chain.length < 2) continue;
    const boardMap = chain[chain.length - 2] as unknown as YMap;
    const bc = boardCaches.get(boardMap);
    if (!bc) continue; // never projected yet
    bc.snap = null;
    const part = chain.length >= 3 ? (chain[chain.length - 3] as unknown) : null;
    if (part === null) {
      // the board map's own keys changed (title, or a part array replaced)
      const keys = (e as Y.YMapEvent<unknown>).keysChanged;
      if (keys.has("levels")) bc.levels = null;
      if (keys.has("legend")) bc.legend = null;
      if (keys.has("roots")) bc.roots = null;
      if (keys.has("edges")) bc.edges = null;
    } else if (part === boardMap.get("levels")) {
      bc.levels = null;
    } else if (part === boardMap.get("legend")) {
      bc.legend = null;
    } else if (part === boardMap.get("edges")) {
      bc.edges = null;
    } else {
      bc.roots = null;
    }
  }
  noteIntent(origin, touched);
});

/* The palette, projected once per change (the tags reason: many cards
 * subscribe through their board's legend). Only options are honored --
 * a tier-bound or role entry that somehow lands here is ignored, so the
 * per-board defaults stay the board's. */
function projectPalette(): LegendEntry[] {
  if (!paletteSnap) {
    const raw = paletteArr()?.toArray().map(legendToPlain) ?? [];
    const opts = raw.filter((e) => !e.tier && !e.role);
    paletteSnap = opts.length ? opts : EMPTY_PALETTE;
  }
  return paletteSnap;
}

function projectBoard(m: YMap): Board {
  const bc = boardCacheFor(m);
  if (bc.legend && bc.paletteV !== paletteVersion) {
    // the palette moved under this board (a WeakMap of caches cannot be walked)
    bc.legend = null;
    bc.snap = null;
  }
  if (bc.snap) return bc.snap;
  if (!bc.levels) {
    bc.levels = partArr(m, "levels")?.toArray().map(levelToPlain) ?? [];
    if (bc.legendFallback) bc.legend = null; // fallback derives from levels
  }
  if (!bc.legend) {
    const legend = partArr(m, "legend")?.toArray();
    bc.legendFallback = !(legend && legend.length);
    bc.paletteV = paletteVersion;
    const own = bc.legendFallback ? defaultLegend(bc.levels) : legend!.map(legendToPlain);
    /* ...PLUS THE PROJECT'S PALETTE (ADR 0006): the board's own entries
     * (tier defaults, the nesting fill, and any option not hoisted yet)
     * followed by every project-level override, so `resolveNodeEntry`
     * finds a card's color on whichever board the card is on. Identity
     * stable while neither changes. */
    const pal = projectPalette();
    bc.legend = pal.length ? [...own, ...pal] : own;
  }
  if (!bc.roots) {
    bc.roots = partArr(m, "roots")?.toArray().map(nodeToPlainCached) ?? [];
  }
  if (!bc.edges) {
    const eg = partArr(m, "edges");
    // EMPTY_EDGES, not a fresh [], so a board with no yarn keeps a stable
    // identity across snapshots (the useTags reason)
    bc.edges = eg?.length ? eg.toArray().map(edgeToPlain) : EMPTY_EDGES;
  }
  bc.snap = {
    id: m.get("id") as string,
    title: (m.get("title") as string) ?? "",
    levels: bc.levels,
    legend: bc.legend,
    roots: bc.roots,
  };
  const ty = m.get("type");
  if (ty !== undefined) bc.snap.type = ty as BoardType;
  const fol = cleanFolder(m.get("folder"));
  if (fol.length) bc.snap.folder = fol;
  const mrb = m.get("maxRowBeats");
  if (mrb !== undefined) bc.snap.maxRowBeats = mrb as number;
  const cs = m.get("cardSpacing");
  if (cs !== undefined) bc.snap.cardSpacing = cs as number;
  const look = sanitizeLook(m.get("look"));
  if (look) bc.snap.look = look;
  const gm = m.get("gamma");
  if (typeof gm === "number" && gm !== 1) bc.snap.gamma = gm;
  if (bc.edges.length) bc.snap.edges = bc.edges;
  return bc.snap;
}

function buildSnapshot(): Project {
/* The folders a project has made, deduped and in a stable order. Two
 * peers creating the same folder is an ordinary merge rather than a
 * conflict -- the name IS the identity, so the duplicate is simply
 * dropped on read and nothing has to be repaired in the doc. */
function foldersSnap(): string[][] | undefined {
  const a = asArr(projectMap.get("folders")) as unknown as Y.Array<unknown> | null;
  if (!a || !a.length) return undefined;
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const v of a.toArray()) {
    const f = cleanFolder(v);
    if (!f.length) continue;
    const k = JSON.stringify(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  /* Stable order so the snapshot does not churn: by name, level by
   * level, which is also the order the shelf draws them in. */
  out.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  return out.length ? out : undefined;
}

  if (!tagsSnap) tagsSnap = tagsArr()?.toArray().map(tagToPlain) ?? EMPTY_TAGS;
  if (!fieldsSnap) fieldsSnap = fieldsArr()?.toArray().map(fieldToPlain) ?? EMPTY_FIELDS;
  const palette = projectPalette();
  return {
    title: (projectMap.get("title") as string) ?? "",
    boards: boardsArr()?.toArray().map(projectBoard) ?? [],
    tags: tagsSnap,
    fields: fieldsSnap,
    palette,
    // absent in every doc older than split tags, and "vertical" there
    splitAxis: (projectMap.get("splitAxis") as Project["splitAxis"]) ?? "vertical",
    folders: foldersSnap(),
    // the mark's design, a plain value on the project map (state/mark.ts)
    mark: sanitizeMark(projectMap.get("mark")),
  };
}

/* ---- snapshot cache + subscription (useSyncExternalStore) --------- */

let snapshot: Project = buildSnapshot();
let dirty = false;
const listeners = new Set<() => void>();

doc.on("update", () => {
  dirty = true;
  listeners.forEach((l) => l());
});

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): Project {
  if (dirty) {
    snapshot = buildSnapshot();
    dirty = false;
  }
  return snapshot;
}

/* ---- lookup ------------------------------------------------------- */

/* A NESTED-BOARD node cannot take children (types.ts `boardRef`), and
 * this is where that is made true. Every op below that can put a child
 * under an existing node refuses on it -- the renderers do not offer the
 * gesture either, but the ops layer is the choke point, so no path (drag,
 * paste, seam, demote, a stale UI, a future caller) can write the shape
 * at all. The UI reads the same rule from state/nesting.ts `isNested`. */
const nestedY = (m: YMap): boolean => {
  const ref = m.get("boardRef");
  return typeof ref === "string" && ref !== "";
};

/* Which depths a node may be MOVED to, given the tier invariant.
 *
 * Normally exactly its own: a node at depth d has children at d+1, so
 * changing its depth silently re-tiers all of them. A NESTING CARD has
 * no children, so it has nothing to protect and takes any rung of the
 * destination ladder -- bounded by the leaf, because past that is the
 * stowed region where content exists and nothing renders it (owner,
 * 2026-08-24: "totally movable by dragging to any drop zone in any
 * tier"). The drag layer lifts the same refusal (board/drag.ts). */
function tierOk(m: YMap, srcDepth: number, dstDepth: number, dstBoard: YMap | null): boolean {
  if (!nestedY(m)) return dstDepth === srcDepth;
  const leaf = (dstBoard ? partArr(dstBoard, "levels")?.length ?? 0 : 0) - 1;
  return leaf >= 0 && dstDepth >= 0 && dstDepth <= leaf;
}

interface Located {
  boardMap: YMap; // the board the node lives in
  boardId: string;
  arr: YArr; // the array the node lives in
  index: number; // its index there
  map: YMap; // the node
  depth: number; // its tier (within its board's ladder)
}

/* Depth-first search for a node across every board. O(total nodes) per
 * call; fine for user-driven ops. Node ids are unique doc-wide (uid +
 * the repair pass), so the first hit is the only hit. */
function locate(id: string): Located | null {
  const boards = boardsArr();
  if (!boards) return null;
  for (let b = 0; b < boards.length; b++) {
    const boardMap = boards.get(b);
    const roots = partArr(boardMap, "roots");
    if (!roots) continue;
    const stack: { arr: YArr; depth: number }[] = [{ arr: roots, depth: 0 }];
    while (stack.length) {
      const { arr, depth } = stack.pop()!;
      for (let i = 0; i < arr.length; i++) {
        const m = arr.get(i);
        if (m.get("id") === id) {
          return { boardMap, boardId: boardMap.get("id") as string, arr, index: i, map: m, depth };
        }
        const ch = m.get("children") as YArr | undefined;
        if (ch && ch.length) stack.push({ arr: ch, depth: depth + 1 });
      }
    }
  }
  return null;
}

/* One step of an ancestor chain: the node, the array holding it, and where
 * it sits there -- everything needed to cut its tail or pin a sibling
 * beside it without a second lookup. */
interface PathStep {
  map: YMap;
  arr: YArr;
  index: number;
}

/* The chain of nodes from a board's root down to `id`, outermost first, so
 * `chain[d]` is the ancestor at depth d. `locate` gives a node's own array
 * and index but not the ancestors above it, and the corkboard insert needs
 * every tier between the gap and the one being pinned. */
function pathTo(boardMap: YMap, id: string): PathStep[] | null {
  const roots = partArr(boardMap, "roots");
  if (!roots) return null;
  const walk = (arr: YArr, trail: PathStep[]): PathStep[] | null => {
    for (let i = 0; i < arr.length; i++) {
      const map = arr.get(i);
      const step: PathStep = { map, arr, index: i };
      if (map.get("id") === id) return [...trail, step];
      const ch = map.get("children");
      if (ch instanceof Y.Array && (ch as YArr).length) {
        const hit = walk(ch as YArr, [...trail, step]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(roots, []);
}

/* Locate MANY nodes in ONE traversal.
 *
 * `locate` is a full scan, so the natural `for (const id of ids) locate(id)`
 * that every selection-wide op used to do is O(nodes x selection) -- fine
 * for the two or three cards you drag, badly wrong for "apply this to the
 * 500 cards I selected", which is exactly what bulk metadata paste is.
 * One walk collecting a Set of targets is O(nodes) however big the
 * selection, and it stops early once every id is found.
 *
 * Returns a Map so callers can keep the caller's own ordering; ids that
 * don't resolve are simply absent, as with `locate` returning null.
 *
 * (An id -> node INDEX would make single lookups O(1) too, but it has to
 * be invalidated on every remote transaction, move and import, and a stale
 * entry means an op silently writing into a detached Y.Map. Not worth it
 * while single lookups happen at human typing speed.) */
function locateMany(ids: Iterable<string>): Map<string, Located> {
  const want = new Set(ids);
  const found = new Map<string, Located>();
  const boards = boardsArr();
  if (!boards || want.size === 0) return found;
  for (let b = 0; b < boards.length; b++) {
    const boardMap = boards.get(b);
    const roots = partArr(boardMap, "roots");
    if (!roots) continue;
    const stack: { arr: YArr; depth: number }[] = [{ arr: roots, depth: 0 }];
    while (stack.length) {
      const { arr, depth } = stack.pop()!;
      for (let i = 0; i < arr.length; i++) {
        const m = arr.get(i);
        const id = m.get("id") as string;
        if (want.has(id) && !found.has(id)) {
          found.set(id, {
            boardMap,
            boardId: boardMap.get("id") as string,
            arr,
            index: i,
            map: m,
            depth,
          });
          if (found.size === want.size) return found;
        }
        const ch = m.get("children") as YArr | undefined;
        if (ch && ch.length) stack.push({ arr: ch, depth: depth + 1 });
      }
    }
  }
  return found;
}

/* Like `locate`, but also reports WHERE THE PARENT sits -- promote needs
 * to insert beside the parent, which `locate` alone can't say (its `arr`
 * is the parent's children, not the parent's own position). parentArr /
 * parentIndex are undefined for roots. */
interface Family extends Located {
  parentArr?: YArr;
  parentIndex?: number;
}

function locateFamily(id: string): Family | null {
  const boards = boardsArr();
  if (!boards) return null;
  for (let b = 0; b < boards.length; b++) {
    const boardMap = boards.get(b);
    const roots = partArr(boardMap, "roots");
    if (!roots) continue;
    const boardId = boardMap.get("id") as string;
    const walk = (arr: YArr, depth: number, parentArr?: YArr, parentIndex?: number): Family | null => {
      for (let i = 0; i < arr.length; i++) {
        const m = arr.get(i);
        if (m.get("id") === id) {
          return { boardMap, boardId, arr, index: i, map: m, depth, parentArr, parentIndex };
        }
        const ch = m.get("children") as YArr | undefined;
        if (ch && ch.length) {
          const hit = walk(ch, depth + 1, arr, i);
          if (hit) return hit;
        }
      }
      return null;
    };
    const hit = walk(roots, 0);
    if (hit) return hit;
  }
  return null;
}

/* True if `id` appears anywhere in this node's subtree. Guards moveNode
 * against dropping a node into its own descendant. */
function isDescendant(map: YMap, id: string): boolean {
  const ch = map.get("children") as YArr | undefined;
  if (!ch) return false;
  for (let i = 0; i < ch.length; i++) {
    const c = ch.get(i);
    if (c.get("id") === id) return true;
    if (isDescendant(c, id)) return true;
  }
  return false;
}

/* Move a node between arrays (or within one), inserting a clone at
 * `dstIndex` (an index in the destination's pre-move ordering, i.e.
 * "insert before the node currently at dstIndex"). Same-array moves
 * account for the removal (spec Sec 4). */
function relocate(srcArr: YArr, srcIndex: number, dstArr: YArr, dstIndex: number) {
  if (srcIndex < 0 || srcIndex >= srcArr.length) return;
  const copy = buildNodeY(nodeToPlain(srcArr.get(srcIndex)));
  srcArr.delete(srcIndex, 1);
  let idx = srcArr === dstArr && dstIndex > srcIndex ? dstIndex - 1 : dstIndex;
  idx = Math.max(0, Math.min(idx, dstArr.length));
  dstArr.insert(idx, [copy]);
}

/* ---- node factory ------------------------------------------------- */

/* Build a fresh node at `depth`, cascading a single empty child chain
 * down to the leaf-parent tier (matches the prototype: a new reel comes
 * with an empty section + scene; a new scene comes empty). New nodes carry
 * no font -- they inherit their tier's default font (LevelDef.defaultFont). */
function newNodeSubtree(depth: number, levelCount: number): Node {
  const node: Node = { id: uid("n" + depth), title: "", collapsed: false, children: [] };
  if (depth <= levelCount - 3) node.children = [newNodeSubtree(depth + 1, levelCount)];
  return node;
}

/* Deep-clone a node with fresh ids (duplicate / import / cross-board
 * copy). Keeps titles/fields; only ids are regenerated. */
function regenIds(node: Node): Node {
  return { ...node, id: uid("c"), children: node.children.map(regenIds) };
}

/* A whole board's content with fresh node ids AND ITS YARN FOLLOWING.
 *
 * Every path that copies a board regenerates node ids so the copy cannot
 * collide with what it came from -- and an Edge is a pair of node ids, so
 * a bare `roots.map(regenIds)` leaves every string pointing at the
 * originals. They then dangle and the repair pass eats them: importing or
 * duplicating a Free Grid board would arrive with the cards intact and
 * the connections silently gone.
 *
 * The same shape as importProject's boardRef remap, and found the same
 * way: by asking what else is a REFERENCE rather than a value. */
function regenBoardIds(board: Board): Board {
  const map = new Map<string, string>();
  const walk = (n: Node): Node => {
    const id = uid("c");
    map.set(n.id, id);
    return { ...n, id, children: n.children.map(walk) };
  };
  const roots = board.roots.map(walk);
  /* Both ends must have been in this board, which after the walk means
   * both were remapped. An edge naming a node the board does not carry
   * could never be drawn anyway, and keeping it would only give the
   * repair pass something to delete. */
  const edges = board.edges?.filter((e) => map.has(e.from) && map.has(e.to));
  const moved = edges?.map((e) => ({ ...e, from: map.get(e.from)!, to: map.get(e.to)! }));
  return { ...board, roots, ...(moved?.length ? { edges: moved } : {}) };
}

/* Materialize a board's legend from the default set when it is missing/
 * empty (old data), so an edit has something to mutate. */
function ensureLegend(boardMap: YMap): YArr {
  const arr = ensurePart(boardMap, "legend");
  if (arr.length === 0) {
    const levels = partArr(boardMap, "levels")?.toArray().map(levelToPlain) ?? [];
    arr.push(defaultLegend(levels).map(buildLegendY));
  }
  return arr;
}

/* Where a legend entry lives: the board's own list (tier defaults, the
 * nesting fill) or the project palette (every override, ADR 0006). */
function findLegendEntry(boardId: string, id: string): { arr: YArr; index: number; map: YMap } | null {
  const board = boardMapById(boardId);
  const lists: (YArr | null)[] = [board ? ensureLegend(board) : null, paletteArr()];
  for (const arr of lists) {
    if (!arr) continue;
    for (let i = 0; i < arr.length; i++) {
      if (arr.get(i).get("id") === id) return { arr, index: i, map: arr.get(i) };
    }
  }
  return null;
}

/* HOIST every board's option entries into the palette (state/palette.ts
 * plans it; this applies it). Inside whatever transaction is running:
 * the repair pass after a remote sync or at load, and every local path
 * that writes a board (a template, an import, a duplicate), so a board
 * never keeps an override of its own for longer than the write that
 * brought it. Cards that named a same-label entry are re-pointed at the
 * project's. */
function hoistPaletteNow(): void {
  const boards = boardsArr();
  if (!boards) return;
  const plain = boards.toArray().map(boardToPlain);
  const plan = planHoist(plain, paletteArr()?.toArray().map(legendToPlain) ?? []);
  if (!hoistNeeded(plan)) return;
  if (plan.add.length) ensurePaletteArr().push(plan.add.map(buildLegendY));
  for (let b = 0; b < boards.length; b++) {
    const m = boards.get(b);
    const gone = plan.strip.get(m.get("id") as string);
    const legend = partArr(m, "legend");
    if (gone && legend) {
      const drop = new Set(gone);
      for (let i = legend.length - 1; i >= 0; i--) {
        if (drop.has(legend.get(i).get("id") as string)) legend.delete(i, 1);
      }
    }
    if (plan.remap.size) {
      const walk = (arr: YArr | null) => {
        if (!arr) return;
        for (let i = 0; i < arr.length; i++) {
          const n = arr.get(i);
          const c = n.get("color");
          if (typeof c === "string" && plan.remap.has(c)) n.set("color", plan.remap.get(c));
          walk(asArr(n.get("children")));
        }
      };
      walk(partArr(m, "roots"));
    }
  }
}

/* ---- transactions + undo ------------------------------------------ */

/* Local edits carry this origin so the UndoManager tracks them (and only
 * them -- remote sync, IndexedDB load, migration and repair use other
 * origins, so undo never rewinds those). */
const LOCAL_ORIGIN = "local";
function tx(fn: () => void) {
  /* The intent journal diffs each touched node against the cached plain
   * node from before the write; warming the snapshot here is what makes
   * that "before" exist for every node, not just the ones a pane has
   * projected since the last change. Cheap: structural sharing makes a
   * clean snapshot a few ms at real scale, and the UI asks for it after
   * every transaction anyway. */
  getSnapshot();
  doc.transact(fn, LOCAL_ORIGIN);
}

export const undoManager = new Y.UndoManager(projectMap, {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
  captureTimeout: 400,
});

/* ---- migration: pre-Phase-4 single-board doc -> project ----------- *
 * The old shape kept one board in the root "board" map. Wrap it as the
 * project's first board and clear the legacy keys. DETERMINISTIC on
 * every peer (fixed board id, node ids preserved), so if two clients
 * migrate the same doc concurrently the repair pass converges the two
 * pushes to one. Old-version clients cannot read the new shape -- all
 * collaborators must upgrade together. */
const MIGRATE_ORIGIN = "migrate";

export function migrateLegacyBoard(d: Y.Doc = doc): boolean {
  const legacy = d.getMap("board") as YMap;
  const roots = asArr(legacy.get("roots"));
  const levels = asArr(legacy.get("levels"));
  const hasContent = (roots && roots.length > 0) || (levels && levels.length > 0);
  if (!hasContent) return false;
  const project = d.getMap("project") as YMap;
  const b: Board = {
    id: LEGACY_BOARD_ID,
    title: (legacy.get("title") as string) ?? "",
    levels: levels?.toArray().map(levelToPlain) ?? [],
    legend: asArr(legacy.get("legend"))?.toArray().map(legendToPlain) ?? [],
    roots: roots?.toArray().map(nodeToPlain) ?? [],
  };
  d.transact(() => {
    let boards = asArr(project.get("boards"));
    if (!boards) {
      boards = new Y.Array() as YArr;
      project.set("boards", boards);
    }
    // idempotence: if some peer's migration already synced in, just clear
    let present = false;
    for (let i = 0; i < boards.length; i++) {
      if (boards.get(i).get("id") === LEGACY_BOARD_ID) present = true;
    }
    if (!present) {
      boards.push([buildBoardY(b)]);
      if (project.get("title") === undefined) project.set("title", b.title);
    }
    legacy.delete("title");
    legacy.delete("levels");
    legacy.delete("legend");
    legacy.delete("roots");
  }, MIGRATE_ORIGIN);
  return true;
}

/* ---- post-merge repair (multiplayer self-healing) ----------------- *
 * Structural ops Yjs cannot express natively are built on clone+delete
 * (moves) or wholesale pushes (migration, board add). Those converge
 * SYNTACTICALLY under CRDT merge but not semantically: concurrent moves
 * of one node leave it twice with the same id; concurrent migrations
 * push the legacy board twice. This cannot be prevented client-side, so
 * we self-heal: after any remote-origin transaction, delete every
 * occurrence of a duplicated id after the first, in document order.
 * Converged peers share one document order, so they all delete the SAME
 * copies and the repair itself converges. Boards are de-duplicated
 * FIRST: a doubled migrated board carries the same node ids, and
 * removing the later board wholesale is the correct converged outcome
 * (the doc-wide node pass then sees each id once). Untracked by undo. */
const REPAIR_ORIGIN = "repair";
let repairQueued = false;

/* Delete the first duplicated-id node found across all boards (document
 * order keeps the first copy); returns whether one was found. One victim
 * per call -- deleting shifts indices, so the walk restarts. */
function deleteOneDuplicateNode(): boolean {
  const boards = boardsArr();
  if (!boards) return false;
  const seen = new Set<string>();
  let victim: { arr: YArr; index: number } | null = null;
  const walk = (arr: YArr): boolean => {
    for (let i = 0; i < arr.length; i++) {
      const m = arr.get(i);
      const id = m.get("id") as string;
      if (seen.has(id)) {
        victim = { arr, index: i };
        return true;
      }
      seen.add(id);
      const ch = m.get("children") as YArr | undefined;
      if (ch && ch.length && walk(ch)) return true;
    }
    return false;
  };
  for (let b = 0; b < boards.length; b++) {
    const roots = partArr(boards.get(b), "roots");
    if (roots && walk(roots)) break;
  }
  if (!victim) return false;
  const v: { arr: YArr; index: number } = victim;
  v.arr.delete(v.index, 1);
  return true;
}

/* Delete the first entry whose `key` repeats an earlier entry's. */
function deleteOneDuplicateBy(arr: YArr | null, key: string): boolean {
  if (!arr) return false;
  const seen = new Set<unknown>();
  for (let i = 0; i < arr.length; i++) {
    const k = arr.get(i).get(key);
    if (k === undefined) continue;
    if (seen.has(k)) {
      arr.delete(i, 1);
      return true;
    }
    seen.add(k);
  }
  return false;
}

export function repairDuplicates(): void {
  doc.transact(() => {
    while (deleteOneDuplicateBy(boardsArr(), "id")) {
      /* doubled boards (concurrent migrations) -- must run first */
    }
    while (deleteOneDuplicateBy(tagsArr(), "id")) {
      /* doubled tag definitions (two peers importing the same board) */
    }
    while (deleteOneDuplicateBy(fieldsArr(), "id")) {
      /* doubled metadata categories, the same way */
    }
    while (deleteOneDuplicateNode()) {
      /* doubled nodes (concurrent moves), doc-wide */
    }
    const boards = boardsArr();
    if (boards) {
      for (let b = 0; b < boards.length; b++) {
        const m = boards.get(b);
        while (deleteOneDuplicateBy(partArr(m, "levels"), "id")) {
          /* duplicate ladder entries */
        }
        while (deleteOneDuplicateBy(partArr(m, "legend"), "id")) {
          /* duplicate legend entries */
        }
        while (deleteOneDuplicateBy(partArr(m, "legend"), "tier")) {
          /* two default-color entries bound to one tier */
        }
        const roots = partArr(m, "roots");
        if (roots) repairNodeVocab(roots);
        while (deleteOneDuplicateBy(partArr(m, "edges"), "id")) {
          /* doubled yarn (two peers stringing the same pair at once) */
        }
        if (roots) repairEdges(m, roots);
      }
    }
    /* ...and the palette: doubled entries (two clients hoisting at once
     * push the same ids), then anything still sitting on a board */
    while (deleteOneDuplicateBy(paletteArr(), "id")) {
      /* doubled palette entries */
    }
    hoistPaletteNow();
  }, REPAIR_ORIGIN);
}

/* Cut every string tied to any of these cards. Called from the delete
 * ops so the yarn dies inside the SAME transaction as its endpoint --
 * see delNodes for why that matters to undo. Free-grid boards only in
 * practice; a no-op on every other type, which carries no edges. */
function cutEdgesFor(boardMap: YMap, ids: string[]): void {
  const arr = partArr(boardMap, "edges");
  if (!arr?.length) return;
  const gone = new Set(ids);
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr.get(i);
    if (gone.has(e.get("from") as string) || gone.has(e.get("to") as string)) arr.delete(i, 1);
  }
}

/* Yarn whose endpoints are gone, cleaned up.
 *
 * SAFE HERE FOR THE REASON IT IS NOT SAFE FOR A NESTED BOARD'S REF, and
 * the contrast is the whole justification: an edge is derived from two
 * cards that are both on THIS board, so a missing endpoint means the
 * card was deleted, not that it has yet to arrive -- a peer holding the
 * edge without the card is holding half of one transaction, which Yjs
 * does not produce. A dangling `boardRef`, by contrast, routinely means
 * "that board has not synced in yet", which is why that one draws a
 * tombstone instead of being scrubbed.
 *
 * Also drops a self-loop and a duplicate pair, which no local op will
 * make but a MERGE can: two peers stringing the same two cards at once
 * produce two edges with different ids, and one line drawn twice is
 * just a thicker line nobody can delete half of. Deterministic on a
 * converged doc (first in document order wins), so the repair converges
 * with it. */
function repairEdges(boardMap: YMap, roots: YArr): void {
  const arr = partArr(boardMap, "edges");
  if (!arr?.length) return;
  const ids = new Set<string>();
  for (let i = 0; i < roots.length; i++) ids.add(roots.get(i).get("id") as string);
  const seen = new Set<string>();
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr.get(i);
    const from = e.get("from") as string;
    const to = e.get("to") as string;
    if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) arr.delete(i, 1);
  }
  // second pass for duplicates, front to back so the FIRST one survives
  for (let i = 0; i < arr.length; i++) {
    const e = arr.get(i);
    const from = e.get("from") as string;
    const to = e.get("to") as string;
    const pair = from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
    if (seen.has(pair)) {
      arr.delete(i, 1);
      i--;
    } else seen.add(pair);
  }
}

/* What a node references from the project's vocabularies, cleaned up.
 *
 * An applied-tag list can pick up duplicates the same way anything else
 * does under merge (two peers tagging the same card), and either list can
 * point at a definition someone else deleted -- a `values` key whose
 * category is gone is a value nothing can ever show. Both read as
 * invisible weight, so strip them.
 *
 * Tags and values share ONE walk: the alternative is two full passes over
 * every node after every remote transaction. */
function repairNodeVocab(nodes: YArr): void {
  const knownTags = new Set((tagsArr()?.toArray() ?? []).map((t) => t.get("id") as string));
  const knownFields = new Set((fieldsArr()?.toArray() ?? []).map((f) => f.get("id") as string));
  const walk = (arr: YArr) => {
    for (let i = 0; i < arr.length; i++) {
      const m = arr.get(i);
      const tags = m.get("tags");
      if (tags instanceof Y.Array) {
        const seen = new Set<string>();
        for (let t = tags.length - 1; t >= 0; t--) {
          const id = tags.get(t) as string;
          if (typeof id !== "string" || !knownTags.has(id) || seen.has(id)) tags.delete(t, 1);
          else seen.add(id);
        }
        if (tags.length === 0) m.delete("tags");
      }
      const values = m.get("values");
      if (values instanceof Y.Map) {
        // a Y.Map can't hold a duplicate key, so this is only ever about
        // dangling categories and blanks
        for (const [k, v] of [...values.entries()]) {
          if (!knownFields.has(k) || typeof v !== "string" || v === "") values.delete(k);
        }
        if (values.size === 0) m.delete("values");
      }
      const slots = m.get("slots");
      if (slots instanceof Y.Map) {
        for (const [k, v] of [...slots.entries()]) {
          const known = typeof v === "string" && knownFields.has(v);
          if (!known || !(SLOT_IDS as string[]).includes(k)) slots.delete(k);
        }
        if (slots.size === 0) m.delete("slots");
      }
      // ...and while we're on this node, upgrade a pre-notes-system note.
      // It rides along here rather than in its own pass because a second
      // full walk of every node after every remote transaction is the only
      // other way to do it.
      const notes = m.get("notes");
      if (typeof notes === "string") {
        if (notes) {
          const arr = new Y.Array() as YArr;
          arr.push([buildNoteY(legacyNote(m.get("id") as string, notes))]);
          m.set("notes", arr);
        } else {
          m.delete("notes"); // an empty string was never a note
        }
      } else if (notes instanceof Y.Array && notes.length === 0) {
        m.delete("notes"); // no notes left: carry nothing, like tags/values
      }
      const ch = m.get("children") as YArr | undefined;
      if (ch && ch.length) walk(ch);
    }
  };
  walk(nodes);
}

/* ---- intent journal (state/intent.ts has the why) ------------------ *
 * The doc-side half: what to record after a LOCAL transaction, and what
 * to put back after a REMOTE one. */
const intent = new IntentJournal(localStorageIntent(scoped("corko-intent")));

/* A node map's Yjs item identity. A clone (every move) mints a new one;
 * an in-place edit never changes it -- which is the whole signal. */
function itemIdOf(m: YMap): string {
  const it = (m as unknown as { _item?: { id: { client: number; clock: number } } })._item;
  return it ? `${it.id.client}:${it.id.clock}` : "";
}

function noteIntent(origin: unknown, touched: Map<YMap, Node>): void {
  if (!touched.size) return;
  if (origin === LOCAL_ORIGIN || origin === undoManager) {
    const now = Date.now();
    const entries: IntentEntry[] = [];
    for (const [m, before] of touched) {
      entries.push(...diffNode(before, nodeToPlainCached(m), itemIdOf(m), now));
    }
    intent.add(entries, now);
  } else if (origin !== REPAIR_ORIGIN && origin !== MIGRATE_ORIGIN) {
    /* A remote transaction that removed a child from a parent that is
     * STILL THE SAME MAP deleted that child on purpose -- a clone of the
     * parent would be a different map with no cache entry. Those
     * children must not come back. */
    const gone = new Set<string>();
    for (const [m, before] of touched) {
      const now = new Set(nodeToPlainCached(m).children.map((c) => c.id));
      for (const c of before.children) if (!now.has(c.id)) gone.add(c.id);
    }
    if (gone.size) intent.dropInserts(gone);
  }
}

/* One plain field, read the way the projection reads it. */
function readNodeField(m: YMap, key: string): unknown {
  const stub = (c: YMap): Node => ({ id: c.get("id") as string, title: "", collapsed: false, children: [] });
  return nodeToPlainWith(m, stub)[key as keyof Node];
}

/* One plain field, written the way buildNodeY writes it. */
function writeNodeField(m: YMap, key: string, value: unknown): void {
  if (value === undefined || value === null || value === false || value === "") {
    if (key === "collapsed") m.set(key, false);
    else m.delete(key);
    return;
  }
  if (key === "notes") {
    const arr = new Y.Array() as YArr;
    arr.push((value as Note[]).map(buildNoteY));
    m.set(key, arr);
  } else if (key === "tags") {
    const arr = new Y.Array<string>();
    arr.push([...(value as string[])]);
    m.set(key, arr);
  } else if (key === "slots" || key === "values") {
    const map = new Y.Map<string>();
    for (const [k, v] of Object.entries(value as Record<string, string>)) if (v) map.set(k, v);
    m.set(key, map);
  } else if (key === "cell" || key === "span") {
    m.set(key, { ...(value as Record<string, number>) });
  } else {
    m.set(key, value);
  }
}

/* After a remote transaction: put back what a clone threw away. One
 * walk (locateMany) however long the journal, then only the entries
 * whose node is now a DIFFERENT map than the one they were written into
 * do anything. Under REPAIR_ORIGIN, so it is neither journaled again nor
 * an undo step. */
export function repairIntent(): number {
  if (!intent.entries.length) return 0;
  const ids = new Set<string>();
  for (const e of intent.entries) {
    ids.add(e.nodeId);
    if (e.kind === "insert") ids.add(e.parentId);
  }
  let found = locateMany(ids);
  let wrote = 0;
  const drop = new Set<IntentEntry>();
  doc.transact(() => {
    /* INSERTS FIRST, then fields. A field written onto a child the
     * journal itself has just put back must land on the fresh map, so
     * the lookup is taken again once anything was inserted. */
    let inserted = false;
    for (const e of intent.entries) {
      if (e.kind !== "insert") continue;
      const p = found.get(e.parentId);
      if (!p) continue;
      const pi = itemIdOf(p.map);
      if (found.has(e.nodeId)) {
        e.parentItem = pi;
        continue;
      }
      if (pi === e.parentItem) {
        drop.add(e); // the parent is the map I wrote into and the child is gone: deleted on purpose
        continue;
      }
      if (nestedY(p.map)) continue;
      const ch = p.map.get("children") as YArr | undefined;
      if (!ch) continue;
      ch.insert(Math.min(e.index, ch.length), [buildNodeY(e.node)]);
      e.parentItem = pi;
      wrote++;
      inserted = true;
    }
    if (inserted) found = locateMany(ids);
    for (const e of intent.entries) {
      if (e.kind !== "field") continue;
      const l = found.get(e.nodeId);
      if (!l) continue;
      const item = itemIdOf(l.map);
      if (item === e.item) continue;
      if (!sameValue(readNodeField(l.map, e.key), e.before)) {
        e.item = item; // somebody changed it after me: theirs
        continue;
      }
      writeNodeField(l.map, e.key, e.after);
      e.item = item;
      wrote++;
    }
  }, REPAIR_ORIGIN);
  if (drop.size) intent.entries = intent.entries.filter((e) => !drop.has(e));
  if (wrote || drop.size) intent.persist();
  return wrote;
}

/* Tests and the dev console: what this browser is holding. */
export const intentJournal = intent;

/* Run migration + repair after transactions we didn't author locally
 * (remote sync, IndexedDB load) -- the only sources of legacy shapes and
 * merge duplicates. Deferred to a microtask: mutating the doc from
 * inside afterTransaction re-enters the transaction machinery. */
doc.on("afterTransaction", (tr: Y.Transaction) => {
  if (
    tr.origin === LOCAL_ORIGIN ||
    tr.origin === REPAIR_ORIGIN ||
    tr.origin === MIGRATE_ORIGIN ||
    tr.origin === undoManager
  )
    return;
  if (tr.changedParentTypes.size === 0) return;
  if (repairQueued) return;
  repairQueued = true;
  queueMicrotask(() => {
    repairQueued = false;
    migrateLegacyBoard();
    repairDuplicates();
    repairIntent();
  });
});

/* ---- board add helper --------------------------------------------- */

/* Push a fully-built board. Exposed for tests and migration-adjacent
 * paths that need to control ids; app code goes through
 * addBoardFromTemplate / importBoard / duplicateBoard. */
/* Add tag definitions we don't already have. Same-id definitions are
 * LEFT ALONE: the local placement/color is what every existing card in
 * this project is already drawn with, so an import must not move them. */
function mergeTags(incoming: TagDef[]): void {
  tx(() => {
    const arr = ensureTagsArr();
    const have = new Set(arr.toArray().map((t) => t.get("id") as string));
    const add = incoming.filter((t) => !have.has(t.id));
    if (add.length) arr.push(add.map(buildTagY));
  });
}

/* Same contract for metadata categories: add the ones we don't have, leave
 * same-id definitions alone (our label is the one this project's cards are
 * already filed under). */
function mergeFields(incoming: FieldDef[]): void {
  tx(() => {
    const arr = ensureFieldsArr();
    const have = new Set(arr.toArray().map((f) => f.get("id") as string));
    const add = incoming.filter((f) => !have.has(f.id));
    if (add.length) arr.push(add.map(buildFieldY));
  });
}

export function addBoardRaw(b: Board): string {
  /* No longer names the project after its first board. That was a
   * Phase 4 convenience for the one-board doc being wrapped; with
   * projects as rooms it named every fresh project "Untitled Board" and
   * two of them read as one in the switcher (owner, 2026-09-02). The
   * legacy migration still carries the old board's title across. */
  tx(() => {
    ensureBoardsArr().push([buildBoardY(b)]);
  });
  return b.id;
}

/* THE VOCABULARY-MERGE RULE, in one place because it was a shipped bug
 * three separate times (importBoard, importProject, addBoardFromTemplate --
 * each found on its own, after shipping): anything that writes nodes whose
 * tags/values/slots reference definitions not yet in this doc MUST land the
 * definitions in the SAME transaction, before the nodes.
 *
 * Why: transactions are the unit of sync. Split them and a peer can receive
 * the board alone, treat it as a remote transaction, and run repairNodeVocab
 * over cards whose tag ids and value keys resolve to nothing -- deleting
 * exactly those, then syncing the deletions back to everyone including the
 * writer. Solo it always looks fine (repair skips local-origin
 * transactions), so a violation here needs the regression tests in
 * ydoc.test.ts "merge repair", not a manual check.
 *
 * Yjs nests transactions (an inner tx() joins the outer one), so the
 * helpers this calls stay usable on their own. */
function withVocabulary(
  tags: TagDef[] | undefined,
  fields: FieldDef[] | undefined,
  writeBoards: () => void,
): void {
  tx(() => {
    if (tags?.length) mergeTags(tags);
    if (fields?.length) mergeFields(fields);
    writeBoards();
  });
}

/* ---- note helpers -------------------------------------------------- */

/* A node's notes array, materialized -- and a pre-notes-system string
 * upgraded in place -- so every note op works whether or not the repair
 * pass has reached this node yet. */
function ensureNotes(nodeMap: YMap): YArr {
  const cur = nodeMap.get("notes");
  if (cur instanceof Y.Array) return cur as YArr;
  const arr = new Y.Array() as YArr;
  if (typeof cur === "string" && cur) {
    arr.push([buildNoteY(legacyNote(nodeMap.get("id") as string, cur))]);
  }
  nodeMap.set("notes", arr);
  return arr;
}

function findNoteIn(arr: YArr, noteId: string): { index: number; map: YMap } | null {
  for (let i = 0; i < arr.length; i++) {
    if (arr.get(i).get("id") === noteId) return { index: i, map: arr.get(i) };
  }
  return null;
}

/* A note on a node, or one of its replies. */
function locateNote(
  nodeId: string,
  noteId: string,
  replyId?: string,
): { index: number; map: YMap } | null {
  const n = locate(nodeId);
  if (!n) return null;
  const notes = n.map.get("notes");
  if (!(notes instanceof Y.Array)) return null;
  const hit = findNoteIn(notes as YArr, noteId);
  if (!hit || !replyId) return hit;
  const replies = hit.map.get("replies");
  return replies instanceof Y.Array ? findNoteIn(replies as YArr, replyId) : null;
}

/* The same replacement rule as state/search.ts's `replaceAll`, which is
 * what the preview renders with -- kept here as its own copy on purpose:
 * ydoc is the doc layer and doesn't import render-side helpers, and if
 * these two ever disagree the preview would be lying about what the op
 * will write. Pinned by a test that runs both over the same input. */
function replaceAllIn(title: string, q: string, to: string, matchCase: boolean): string {
  if (!q) return title;
  if (matchCase) return title.split(q).join(to);
  let out = "";
  let rest = title;
  const needle = q.toLowerCase();
  for (;;) {
    const at = rest.toLowerCase().indexOf(needle);
    if (at < 0) return out + rest;
    out += rest.slice(0, at) + to;
    rest = rest.slice(at + q.length);
  }
}

/* ---- public mutation API (each is one transaction) ---------------- */

/* WHAT A PHOTO DOES TO THE WORDS ON A CARD, written as ordinary
 * overrides rather than applied by a stylesheet nobody can see (owner,
 * 2026-09-01). White, shadowed and set to the bottom is what a caption
 * over a picture wants; because these are real values, the Text
 * overrides panel shows them and any of them can be changed or cleared.
 *
 * ONE definition, so the manual "add image" path and a grabbed EDL still
 * cannot disagree about what a card with a picture looks like. */
const PHOTO_TEXT = { textColor: "#ffffff", textShadow: true, titleAlign: "bottom" } as const;
function applyPhotoText(map: YMap) {
  /* ONLY ONTO A CARD THAT HAS SAID NOTHING ABOUT ITS WORDS. A color,
   * size, font, shadow or position somebody chose is a decision, and a
   * picture arriving must not overrule it (2026-09-01 audit: the guard
   * used to be "had no picture", which is a different question). */
  if (hasTextOverrides(map)) return;
  map.set("textColor", PHOTO_TEXT.textColor);
  map.set("textShadow", PHOTO_TEXT.textShadow);
  map.set("titleAlign", PHOTO_TEXT.titleAlign);
}
function hasTextOverrides(map: YMap): boolean {
  return ["textColor", "textSize", "textShadow", "titleAlign", "font"].some((k) => {
    const v = map.get(k);
    return v !== undefined && v !== "" && v !== null && v !== false;
  });
}
/* When the LAST picture leaves, take the treatment back -- but only if it
 * is still exactly what the picture brought. A white title over cork is
 * what an untouched imaged card became once its photo was removed; a
 * value somebody has since changed stays, all three of them, because a
 * changed set is theirs now. */
function clearPhotoText(map: YMap) {
  if (map.get("image") || map.get("still")) return;
  if (
    map.get("textColor") !== PHOTO_TEXT.textColor ||
    map.get("textShadow") !== PHOTO_TEXT.textShadow ||
    map.get("titleAlign") !== PHOTO_TEXT.titleAlign
  )
    return;
  map.delete("textColor");
  map.delete("textShadow");
  map.delete("titleAlign");
}

export const ops = {
  undo() {
    getSnapshot();
    undoManager.undo();
  },
  redo() {
    getSnapshot();
    undoManager.redo();
  },

  /* THE MARK (state/mark.ts): the logo's override and its pool, one
   * plain value on the project map, rewritten whole -- it is a few
   * hundred bytes, and a design is a single thing to a person. */
  setMarkOverride(design: MarkDesign | null) {
    tx(() => {
      const cur = sanitizeMark(projectMap.get("mark")) ?? {};
      const next: MarkState = { ...cur };
      if (design) next.override = sanitizeDesign(design) ?? undefined;
      else delete next.override;
      if (next.override || next.pool?.length) projectMap.set("mark", next);
      else projectMap.delete("mark");
    });
  },
  addMarkToPool(design: MarkDesign) {
    const clean = sanitizeDesign(design);
    if (!clean) return;
    tx(() => {
      const cur = sanitizeMark(projectMap.get("mark")) ?? {};
      const pool = (cur.pool ?? []).filter((d) => !sameDesign(d, clean));
      pool.push(clean);
      projectMap.set("mark", { ...cur, pool: pool.slice(-MAX_POOL) });
    });
  },
  removeMarkFromPool(design: MarkDesign) {
    tx(() => {
      const cur = sanitizeMark(projectMap.get("mark")) ?? {};
      const pool = (cur.pool ?? []).filter((d) => !sameDesign(d, design));
      const next: MarkState = { ...cur };
      if (pool.length) next.pool = pool;
      else delete next.pool;
      if (next.override || next.pool) projectMap.set("mark", next);
      else projectMap.delete("mark");
    });
  },
  clearMarkPool() {
    tx(() => {
      const cur = sanitizeMark(projectMap.get("mark")) ?? {};
      if (cur.override) projectMap.set("mark", { override: cur.override });
      else projectMap.delete("mark");
    });
  },

  setProjectTitle(value: string) {
    tx(() => projectMap.set("title", value));
  },

  /* Which way every split tag cuts (ADR 0005). One axis for the whole
   * project: mixing them per tag would make a card carrying two splits
   * unreadable, and the vocabulary deciding the look is the rule tags
   * already follow. */
  setSplitAxis(axis: SplitAxis) {
    tx(() => projectMap.set("splitAxis", axis));
  },

  setBoardTitle(boardId: string, value: string) {
    tx(() => boardMapById(boardId)?.set("title", value));
  },

  /* FILE A BOARD, or take it out of a folder with an empty list.
   *
   * A folder is a list of NAMES rather than a defined entity
   * (state/types.ts Board.folder says why), so filing is one write and
   * there is nothing to keep in step. An empty list DELETES the key
   * rather than storing [], so a board filed nowhere is byte-identical
   * to one that never was. */
  setBoardFolder(boardId: string, folder: string[]) {
    const f = cleanFolder(folder);
    tx(() => {
      const m = boardMapById(boardId);
      if (!m) return;
      if (f.length) m.set("folder", f);
      else m.delete("folder");
    });
  },

  /* FILE SEVERAL BOARDS AT ONCE -- what dragging a selection does.
   * ONE transaction, so a drag of six boards is one undo step rather
   * than six, which is the same rule moveNodes and setNodesColor keep. */
  /* WHERE THE TITLE SITS, as an override. Passing "" (or anything that
   * is not top/bottom) DELETES the key rather than storing "center", so
   * a card left alone is byte-identical to one that never was asked --
   * the same rule every optional field here keeps. */
  /* THE TEXT OVERRIDES. Each takes a null/"" to CLEAR, deleting the key
   * rather than storing a "same as the tier" value -- so a card back at
   * its default is byte-identical to one nobody touched, the rule every
   * optional field here keeps. */
  setNodeTextColor(ids: string[], color: string) {
    const found = locateMany(new Set(ids));
    tx(() => {
      for (const { map } of found.values()) {
        if (color) map.set("textColor", color);
        else map.delete("textColor");
      }
    });
  },

  setNodeTextSize(ids: string[], size: number | null) {
    const found = locateMany(new Set(ids));
    tx(() => {
      for (const { map } of found.values()) {
        if (size && Number.isFinite(size)) map.set("textSize", Math.max(6, Math.min(200, Math.round(size))));
        else map.delete("textSize");
      }
    });
  },

  setNodeTextShadow(ids: string[], on: boolean) {
    const found = locateMany(new Set(ids));
    tx(() => {
      for (const { map } of found.values()) {
        if (on) map.set("textShadow", true);
        else map.delete("textShadow");
      }
    });
  },

  setNodeFont(ids: string[], font: string) {
    const found = locateMany(new Set(ids));
    tx(() => {
      for (const { map } of found.values()) {
        if (font) map.set("font", font);
        else map.delete("font");
      }
    });
  },

  setNodeTitleAlign(ids: string[], align: "top" | "bottom" | "") {
    const found = locateMany(new Set(ids));
    tx(() => {
      for (const { map } of found.values()) {
        if (align === "top" || align === "bottom") map.set("titleAlign", align);
        else map.delete("titleAlign");
      }
    });
  },

  /* ALL FIVE BACK TO THE TIER IN ONE TRANSACTION (2026-09-12): the text
   * panel's Reset row used to call the five setters in turn, which was
   * five undo steps for one click -- and on a selection of many, five
   * broadcasts. One undo takes the whole reset back now. */
  resetNodeText(ids: string[]) {
    const found = locateMany(new Set(ids));
    tx(() => {
      for (const { map } of found.values()) {
        for (const key of ["textColor", "textSize", "textShadow", "font", "titleAlign"]) map.delete(key);
      }
    });
  },

  setBoardsFolder(boardIds: string[], folder: string[]) {
    const f = cleanFolder(folder);
    tx(() => {
      for (const id of boardIds) {
        const m = boardMapById(id);
        if (!m) continue;
        if (f.length) m.set("folder", f);
        else m.delete("folder");
      }
    });
  },

  /* MAKE A FOLDER, empty. Boards name the folder they are in, so a
   * folder holding something needs no entry -- this is only what makes
   * an EMPTY one exist, and it lives in the doc rather than in one
   * browser because a folder somebody made is structure, and structure
   * is shared (owner, 2026-08-30). */
  addFolder(folder: string[]) {
    const f = cleanFolder(folder);
    if (!f.length) return;
    tx(() => {
      const arr = ensureFolders();
      for (const v of arr.toArray()) if (sameFolder(cleanFolder(v), f)) return;
      arr.push([f]);
    });
  },

  /* Forget a folder. Its boards and any subfolders MOVE UP to its
   * parent rather than being unfiled or deleted: nothing a person made
   * disappears because they tidied a level away, and moving up is the
   * one answer that is never a surprise. */
  removeFolder(folder: string[]) {
    const src = cleanFolder(folder);
    if (!src.length) return;
    const up = src.slice(0, -1);
    tx(() => {
      const arr = foldersArr();
      if (arr) {
        /* Descending, so an earlier delete cannot move a later index --
         * the trap moveNodes taught. */
        for (let i = arr.length - 1; i >= 0; i--) {
          const c = cleanFolder(arr.get(i));
          if (sameFolder(c, src)) arr.delete(i, 1);
          else if (isUnder(c, src)) {
            arr.delete(i, 1);
            arr.insert(i, [rebase(c, src, up)]);
          }
        }
      }
      eachBoard((m) => {
        const c = cleanFolder(m.get("folder"));
        if (!c.length) return;
        if (!sameFolder(c, src) && !isUnder(c, src)) return;
        const moved = sameFolder(c, src) ? up : rebase(c, src, up);
        if (moved.length) m.set("folder", moved);
        else m.delete("folder");
      });
    });
  },

  /* Rename a folder everywhere, or remove it with an empty list.
   *
   * PREFIX-AWARE, which is what makes nesting work: renaming a parent
   * carries its subfolders with it, because a subfolder IS its parent's
   * list plus a name. ONE transaction, so it is one undo step and no
   * peer ever sees the shelf half-renamed.
   *
   * It rewrites the FOLDER LIST as well as the boards. Without that an
   * empty folder could not be renamed at all -- which is exactly what
   * the owner hit while these were still local drafts.
   *
   * Renaming ONTO an existing folder merges the two, which is what a
   * name model means and is the useful behavior anyway. */
  renameFolder(from: string[], to: string[]) {
    const src = cleanFolder(from);
    if (!src.length) return;
    const dst = cleanFolder(to);
    /* Refuse to move a folder INSIDE ITSELF, which a drag can ask for
     * by dropping a folder onto its own descendant. Left alone it would
     * rebase the subtree onto a path that no longer has a root, so the
     * whole branch would vanish from the shelf. */
    if (dst.length && isUnder(dst, src)) return;
    tx(() => {
      const arr = foldersArr();
      if (arr) {
        for (let i = arr.length - 1; i >= 0; i--) {
          const c = cleanFolder(arr.get(i));
          if (!sameFolder(c, src) && !isUnder(c, src)) continue;
          arr.delete(i, 1);
          const moved = sameFolder(c, src) ? dst : rebase(c, src, dst);
          if (moved.length) arr.insert(i, [moved]);
        }
      }
      eachBoard((m) => {
        const c = cleanFolder(m.get("folder"));
        if (!c.length) return;
        if (!sameFolder(c, src) && !isUnder(c, src)) return;
        const moved = sameFolder(c, src) ? dst : rebase(c, src, dst);
        if (moved.length) m.set("folder", moved);
        else m.delete("folder");
      });
    });
  },



  /* DUPLICATE A FOLDER: every board in it and under it, copied with
   * fresh ids into a sibling folder named "<name> copy" (numbered if that
   * is taken), subfolders and all, in ONE transaction. Boards keep their
   * own titles -- the copy is the folder, so a "copy" suffix on each
   * board would be noise. Empty subfolders travel too, since the shelf
   * shows them. Returns the new folder's path, or [] when nothing was
   * there to copy. The shelf asks before doing this to more than a few
   * boards (owner, 2026-09-02). */
  duplicateFolder(folder: string[]): string[] {
    const src = cleanFolder(folder);
    if (!src.length) return [];
    let dst: string[] = [];
    tx(() => {
      const boards = boardsArr();
      if (!boards) return;
      const parent = src.slice(0, -1);
      /* Sibling names already in use at the parent level, from both the
       * declared list and every board's path. */
      const taken = new Set<string>();
      const consider = (f: readonly string[]) => {
        if (f.length > parent.length && sameFolder(f.slice(0, parent.length), parent)) taken.add(f[parent.length]);
      };
      for (const v of foldersArr()?.toArray() ?? []) consider(cleanFolder(v));
      eachBoard((m) => consider(cleanFolder(m.get("folder"))));
      const base = `${src[src.length - 1]} copy`;
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
      dst = [...parent, name];

      const arr = ensureFolders();
      const have = arr.toArray().map(cleanFolder);
      const add: string[][] = [dst];
      for (const c of have) {
        if (isUnder(c, src)) add.push(rebase(c, src, dst));
      }
      for (const f of add) {
        if (!have.some((h) => sameFolder(h, f)) && !arr.toArray().some((h) => sameFolder(cleanFolder(h), f))) {
          arr.push([f]);
        }
      }

      const copies: Board[] = [];
      let last = -1;
      for (let i = 0; i < boards.length; i++) {
        const m = boards.get(i);
        const c = cleanFolder(m.get("folder"));
        if (!c.length || (!sameFolder(c, src) && !isUnder(c, src))) continue;
        last = i;
        const plain = boardToPlain(m);
        copies.push(
          regenBoardIds({ ...plain, id: uid("bd"), folder: sameFolder(c, src) ? dst : rebase(c, src, dst) }),
        );
      }
      if (copies.length) boards.insert(last + 1, copies.map(buildBoardY));
    });
    return dst;
  },

  /* Shared per-board layout settings (every collaborator sees the same
   * row structure -- these are how the board READS, not personal taste). */
  setBoardMaxRowBeats(boardId: string, n: number) {
    tx(() => boardMapById(boardId)?.set("maxRowBeats", Math.max(1, Math.min(10, Math.round(n)))));
  },
  /* THE BOARD'S SHARED BACKDROP (state/types.ts BoardLook): a patch over
   * what is set, written as one plain value; null clears it back to
   * "nothing chosen", where every browser's own preference shows. */
  setBoardLook(boardId: string, patch: Partial<BoardLook> | null) {
    tx(() => {
      const m = boardMapById(boardId);
      if (!m) return;
      if (patch === null) {
        m.delete("look");
        return;
      }
      const cur = sanitizeLook(m.get("look")) ?? { bg: "cork" as const };
      const next = sanitizeLook({ ...cur, ...patch });
      if (next) m.set("look", next);
    });
  },

  /* THE BOARD'S SHARED IMAGE GAMMA (types.ts Board.gamma). 1 is off and
   * is stored as an ABSENCE, so a board nobody has touched carries
   * nothing and an older build sees its pictures as they are. */
  setBoardGamma(boardId: string, gamma: number) {
    tx(() => {
      const m = boardMapById(boardId);
      if (!m) return;
      const g = Math.min(MAX_GAMMA, Math.max(MIN_GAMMA, gamma));
      if (g === 1) m.delete("gamma");
      else m.set("gamma", g);
    });
  },

  setBoardCardSpacing(boardId: string, px: number) {
    tx(() => boardMapById(boardId)?.set("cardSpacing", Math.max(8, Math.min(20, Math.round(px)))));
  },

  setNodeField(id: string, field: NodeField, value: string) {
    tx(() => {
      const n = locate(id);
      if (n) n.map.set(field, value);
    });
  },

  /* Manual row break after a beat: the beat strip wraps only at these. */
  toggleBreak(id: string) {
    tx(() => {
      const n = locate(id);
      if (n) n.map.set("breakAfter", !n.map.get("breakAfter"));
    });
  },

  /* Add a top-tier node at the end of a board. */
  addRoot(boardId: string): string {
    let id = "";
    tx(() => {
      const board = boardMapById(boardId);
      if (!board) return;
      const levelCount = partArr(board, "levels")?.length ?? 0;
      if (levelCount === 0) return;
      const node = newNodeSubtree(0, levelCount);
      id = node.id;
      ensurePart(board, "roots").push([buildNodeY(node)]);
    });
    return id;
  },

  /* Add a child at the end of `parentId`. Returns the new node's id
   * (callers auto-focus new leaf cards). */
  /* Insert a root at `index` -- the top tier's half of "every gap between
   * siblings takes an insert". addRoot appends; without this the top tier
   * would be the one rung you could only add to the end of. */
  addRootAt(boardId: string, index: number): string {
    let id = "";
    tx(() => {
      const board = boardMapById(boardId);
      if (!board) return;
      const levelCount = partArr(board, "levels")?.length ?? 0;
      if (levelCount === 0) return;
      const node = newNodeSubtree(0, levelCount);
      id = node.id;
      const arr = ensurePart(board, "roots") as YArr;
      arr.insert(Math.max(0, Math.min(index, arr.length)), [buildNodeY(node)]);
    });
    return id;
  },

  addChild(parentId: string): string {
    let id = "";
    tx(() => {
      const p = locate(parentId);
      if (!p || nestedY(p.map)) return;
      const levelCount = partArr(p.boardMap, "levels")?.length ?? 0;
      if (levelCount === 0) return;
      const node = newNodeSubtree(p.depth + 1, levelCount);
      id = node.id;
      (p.map.get("children") as YArr).push([buildNodeY(node)]);
    });
    return id;
  },

  /* Insert a new child of `parentId` at `index` (clamped) rather than at
   * the end -- backs the hover-between-cards insert (spec Sec 4). */
  addChildAt(parentId: string, index: number): string {
    let id = "";
    tx(() => {
      const p = locate(parentId);
      if (!p || nestedY(p.map)) return;
      const levelCount = partArr(p.boardMap, "levels")?.length ?? 0;
      if (levelCount === 0) return;
      const node = newNodeSubtree(p.depth + 1, levelCount);
      id = node.id;
      const arr = p.map.get("children") as YArr;
      const i = Math.max(0, Math.min(index, arr.length));
      arr.insert(i, [buildNodeY(node)]);
    });
    return id;
  },

  /* PIN A CARD OF ANY TIER AT A GAP, AND LET IT ABSORB WHAT FALLS BELOW.
   *
   * The corkboard rule, and the whole of it: a card of tier T pinned at a
   * point takes everything below it, down to the next card of tier T or
   * shallower. Anything absorbed that is DEEPER than T has lost its parent,
   * so a no-name one is minted at each tier in between.
   *
   * Worked on a Reel > Day > Scene ladder, pinning at the gap between
   * scenes B and C of Day 1:
   *   +Scene  a scene lands between B and C. Nothing else moves.
   *   +Day    a Day lands after Day 1 holding C. Day 1 keeps A and B;
   *           Day 2 is untouched, its own card stops the absorption.
   *   +Reel   a Reel lands after Reel 1 and absorbs down to Reel 2: that is
   *           C *and* all of Day 2. C has no Day inside the new Reel, so
   *           one is minted for it; Day 2 keeps its identity and its place.
   *
   * Nothing is CLONED -- ids travel with the cards, because these are the
   * same cards under a new header, which is what the physical model says
   * and what keeps notes, tags and selection coherent. One transaction, so
   * one undo step however much it takes in.
   *
   * `index === 0` with an ancestor tier is refused: the gap between a
   * container and its first child can only make that container's children
   * (owner's rule). It is the caller's job not to offer it, and refusing
   * here means the op cannot empty a lane by accident. */
  insertTierAt(boardId: string, parentId: string | null, index: number, tierDepth: number): string {
    let newId = "";
    tx(() => {
      const board = boardMapById(boardId);
      if (!board) return;
      const levelCount = partArr(board, "levels")?.length ?? 0;
      if (levelCount === 0) return;

      // the tier the cards either side of this gap sit at
      const ownDepth = parentId === null ? 0 : (locate(parentId)?.depth ?? -2) + 1;
      if (ownDepth < 0 || tierDepth < 0 || tierDepth > ownDepth) return;

      // the gap's own tier: a plain insert, nothing moves
      if (tierDepth === ownDepth) {
        newId = parentId === null ? ops.addRootAt(boardId, index) : ops.addChildAt(parentId, index);
        return;
      }
      if (index === 0) return; // see the header
      const chain = pathTo(board, parentId as string);
      if (!chain || chain.length !== ownDepth) return;

      /* Read every absorbed subtree as PLAIN nodes BEFORE deleting
       * anything -- a detached Y type cannot be re-integrated, which is why
       * every move in this file is clone-then-remove. */
      const kidsOf = (step: PathStep): YArr | null => {
        const k = step.map.get("children");
        return k instanceof Y.Array ? (k as YArr) : null;
      };
      const slice = (arr: YArr | null, from: number): Node[] => {
        const out: Node[] = [];
        if (arr) for (let i = from; i < arr.length; i++) out.push(nodeToPlain(arr.get(i)));
        return out;
      };
      // what sits below the gap inside the parent...
      const carry = slice(kidsOf(chain[ownDepth - 1]), index);
      // ...and, at each tier above it, the siblings that follow the chain
      const trailingAt = (d: number) => slice(kidsOf(chain[d]), chain[d + 1].index + 1);

      const noName = (depth: number, children: Node[]): Node => ({
        id: uid("n" + depth),
        title: "",
        collapsed: false,
        children,
      });

      // Build the newcomer's contents bottom-up, minting a no-name parent
      // only where there is something to hold.
      let kids: Node[];
      if (tierDepth === ownDepth - 1) {
        kids = carry; // the chosen tier IS the parent: a plain split
      } else {
        let sub: Node | null = carry.length ? noName(ownDepth - 1, carry) : null;
        for (let d = ownDepth - 2; d > tierDepth; d--) {
          const at = [...(sub ? [sub] : []), ...trailingAt(d)];
          sub = at.length ? noName(d, at) : null;
        }
        kids = [...(sub ? [sub] : []), ...trailingAt(tierDepth)];
      }

      /* Absorbing nothing means this is simply a new card, so give it the
       * same empty child cascade every other new node gets. */
      const fresh = newNodeSubtree(tierDepth, levelCount);
      const node: Node = kids.length ? { ...fresh, children: kids } : fresh;
      newId = node.id;

      /* Remove what moved. Deepest first, and only ever the TAIL of each
       * array -- the chain node itself always sits before the cut, so no
       * index read above is invalidated by a delete below. */
      const cutTail = (arr: YArr | null, from: number) => {
        if (arr && from < arr.length) arr.delete(from, arr.length - from);
      };
      cutTail(kidsOf(chain[ownDepth - 1]), index);
      if (tierDepth < ownDepth - 1) {
        for (let d = ownDepth - 2; d >= tierDepth; d--) cutTail(kidsOf(chain[d]), chain[d + 1].index + 1);
      }

      // ...and pin the newcomer immediately after the tier it joins
      const at = chain[tierDepth];
      at.arr.insert(at.index + 1, [buildNodeY(node)]);
    });
    return newId;
  },

  delNode(id: string) {
    tx(() => {
      const n = locate(id);
      if (!n) return;
      cutEdgesFor(n.boardMap, [id]);
      n.arr.delete(n.index, 1);
    });
  },

  /* Delete a whole selection in ONE transaction (one undo step -- the
   * keyboard's Delete). One locateMany walk, then deletions in DESCENDING
   * index order: the indices were all read before the first delete, and a
   * lower-index delete would shift every later one (the same trap
   * moveNodes documents). A selection is single-tier (selection.ts), so
   * no id here can sit inside another's subtree. */
  delNodes(ids: string[]) {
    if (!ids.length) return;
    tx(() => {
      const found = [...locateMany(ids).values()].sort((a, b) => b.index - a.index);
      /* Yarn goes IN THE SAME TRANSACTION as the cards it was tied to.
       * The repair pass would drop these anyway, but repair runs under
       * an origin the UndoManager does not track -- so a card brought
       * back by Cmd-Z would come back bare, its strings quietly gone.
       * Cut them here and undo restores the whole picture. */
      for (const l of found) cutEdgesFor(l.boardMap, [l.map.get("id") as string]);
      for (const l of found) l.arr.delete(l.index, 1);
    });
  },

  /* Shared hide/show for a set of nodes (spec Sec 4). */
  setHidden(ids: string[], hidden: boolean) {
    tx(() => {
      for (const n of locateMany(ids).values()) n.map.set("hidden", hidden);
    });
  },

  /* Stack a selection: the first (document-order) card stays the visible
   * "top"; the rest are hidden and tuck behind it (spec Sec 4). Dragging
   * the top later carries the whole stack (see moveNodes). A selection
   * lives within one board (the first id's board). */
  stack(ids: string[]) {
    if (ids.length < 2) return;
    tx(() => {
      const first = locate(ids[0]);
      if (!first) return;
      const roots = partArr(first.boardMap, "roots");
      if (!roots) return;
      const moving = new Set(ids);
      const order: string[] = [];
      const collect = (arr: YArr) => {
        for (let i = 0; i < arr.length; i++) {
          const m = arr.get(i);
          if (moving.has(m.get("id") as string)) order.push(m.get("id") as string);
          const ch = m.get("children") as YArr | undefined;
          if (ch && ch.length) collect(ch);
        }
      };
      collect(roots);
      if (order.length < 2) return;
      const found = locateMany(order);
      found.get(order[0])?.map.set("hidden", false);
      for (const id of order.slice(1)) found.get(id)?.map.set("hidden", true);
    });
  },

  /* Duplicate a node in place: a deep clone with fresh ids inserted right
   * after the original (context-menu action). Returns the copy's id. */
  /* A copy lands beside the original, never exactly on top of it.
   *
   * On every other type "beside" is the next index and the renderer puts
   * it somewhere visibly different. On a FREE GRID the copy would
   * inherit the same cell and sit perfectly behind the original -- so
   * the gesture would look like nothing happened, and the way to find
   * out otherwise is to drag the top one off. Nudged by a cell and a
   * bit; the doc is the only place that knows the difference. */
  duplicateNode(id: string): string {
    let copyId = "";
    tx(() => {
      const n = locate(id);
      if (!n) return;
      const copy = regenIds(nodeToPlain(n.map));
      if (copy.cell) copy.cell = clampCell({ x: copy.cell.x + 2, y: copy.cell.y + 2 });
      copyId = copy.id;
      n.arr.insert(n.index + 1, [buildNodeY(copy)]);
    });
    return copyId;
  },

  /* Reorder within the current parent by one step (keyboard/button
   * fallback, spec Sec 4). */
  moveByDir(id: string, dir: -1 | 1) {
    tx(() => {
      const n = locate(id);
      if (!n) return;
      const target = dir > 0 ? n.index + 2 : n.index - 1;
      relocate(n.arr, n.index, n.arr, target);
    });
  },

  /* Full move + re-parent: place `id` inside `parentId` (or at the roots
   * of `rootBoardId` when parentId is null) at `index`. Rejects cycles
   * and tier changes so the ladder invariant holds -- a node always
   * stays at its own tier (cross-board moves allowed at equal depth). */
  moveNode(id: string, parentId: string | null, index: number, rootBoardId?: string) {
    tx(() => {
      const src = locate(id);
      if (!src) return;

      let dstArr: YArr;
      let dstDepth: number;
      let dstBoard: YMap | null;
      if (parentId === null) {
        const board = boardMapById(rootBoardId ?? src.boardId);
        if (!board) return;
        const roots = partArr(board, "roots");
        if (!roots) return;
        dstArr = roots;
        dstDepth = 0;
        dstBoard = board;
      } else {
        if (parentId === id) return;
        const p = locate(parentId);
        if (!p || nestedY(p.map)) return;
        if (isDescendant(src.map, parentId)) return; // no drop into own subtree
        dstArr = p.map.get("children") as YArr;
        dstDepth = p.depth + 1;
        dstBoard = p.boardMap;
      }
      if (!tierOk(src.map, src.depth, dstDepth, dstBoard)) return;
      relocate(src.arr, src.index, dstArr, index);
    });
  },

  /* Move several same-tier nodes to `parentId` (or `rootBoardId` roots)
   * at `index` as one contiguous block, preserving their document order
   * (collective drag of a multi-selection). Wrong-tier nodes are
   * skipped. */
  moveNodes(ids: string[], parentId: string | null, index: number, rootBoardId?: string) {
    if (ids.length === 0) return;
    tx(() => {
      let dstArr: YArr;
      let dstDepth: number;
      if (parentId === null) {
        const src = locate(ids[0]);
        const board = boardMapById(rootBoardId ?? src?.boardId ?? "");
        if (!board) return;
        const roots = partArr(board, "roots");
        if (!roots) return;
        dstArr = roots;
        dstDepth = 0;
      } else {
        const p = locate(parentId);
        if (!p || nestedY(p.map)) return;
        dstArr = p.map.get("children") as YArr;
        dstDepth = p.depth + 1;
      }
      const moving = new Set(ids);
      // stacks travel with their top: pull in the trailing hidden run of
      // each moved card (the cards tucked behind it).
      for (const l of locateMany(ids).values()) {
        for (let i = l.index + 1; i < l.arr.length; i++) {
          const m = l.arr.get(i);
          if (Boolean(m.get("hidden"))) moving.add(m.get("id") as string);
          else break;
        }
      }
      // insert before the first non-moving node at/after `index`
      let refId: string | null = null;
      for (let i = index; i < dstArr.length; i++) {
        const id = dstArr.get(i).get("id") as string;
        if (!moving.has(id)) {
          refId = id;
          break;
        }
      }
      // collect moving nodes in document order (across boards, boards
      // order) at the destination tier
      const order: string[] = [];
      const collect = (arr: YArr, depth: number) => {
        for (let i = 0; i < arr.length; i++) {
          const m = arr.get(i);
          /* At the destination tier -- or a NESTING CARD at any tier,
           * which has no children to mis-tier and so travels freely
           * (see tierOk). Everything else at the wrong rung is skipped,
           * which is what keeps the ladder invariant true. */
          if (moving.has(m.get("id") as string) && (depth === dstDepth || nestedY(m))) {
            order.push(m.get("id") as string);
          }
          const ch = m.get("children") as YArr | undefined;
          if (ch && ch.length) collect(ch, depth + 1);
        }
      };
      const boards = boardsArr();
      if (!boards) return;
      for (let b = 0; b < boards.length; b++) {
        const roots = partArr(boards.get(b), "roots");
        if (roots) collect(roots, 0);
      }
      if (order.length === 0) return;
      // clone before removing (Yjs can't re-integrate detached types)
      const located = locateMany(order);
      const clones = order.map((id) => buildNodeY(nodeToPlain(located.get(id)!.map)));
      /* Delete by DESCENDING index. These positions were all read in one
       * walk, so a deletion at a lower index would shift every later one --
       * the old per-id re-lookup papered over that by re-reading the array
       * each time. Descending keeps every remaining index valid, and it's
       * safe across arrays since a delete in one can't move another. */
      for (const l of [...located.values()].sort((a, b) => b.index - a.index)) {
        l.arr.delete(l.index, 1);
      }
      let insertAt = dstArr.length;
      if (refId !== null) {
        for (let i = 0; i < dstArr.length; i++) {
          if (dstArr.get(i).get("id") === refId) {
            insertAt = i;
            break;
          }
        }
      }
      dstArr.insert(insertAt, clones);
    });
  },

  /* Copy several same-tier nodes (deep clones, fresh ids) into `parentId`
   * (or the roots of `rootBoardId`) at `index`, preserving document order.
   * The sources are untouched -- this is the cross-board drag (pull from
   * the master board into a section board, spec Sec 5.4 workflow); a
   * same-board drag is a move (see moveNodes). Nodes whose tier doesn't
   * match the destination are skipped, so the ladder invariant holds.
   * Returns the new ids, in insertion order. */
  copyNodes(ids: string[], parentId: string | null, index: number, rootBoardId?: string): string[] {
    if (ids.length === 0) return [];
    const made: string[] = [];
    tx(() => {
      let dstArr: YArr;
      let dstDepth: number;
      if (parentId === null) {
        const src = locate(ids[0]);
        const board = boardMapById(rootBoardId ?? src?.boardId ?? "");
        if (!board) return;
        const roots = partArr(board, "roots");
        if (!roots) return;
        dstArr = roots;
        dstDepth = 0;
      } else {
        const p = locate(parentId);
        if (!p || nestedY(p.map)) return;
        dstArr = p.map.get("children") as YArr;
        dstDepth = p.depth + 1;
      }
      const wanted = new Set(ids);
      // stacks travel with their top, exactly as a move carries them
      for (const l of locateMany(ids).values()) {
        for (let i = l.index + 1; i < l.arr.length; i++) {
          const m = l.arr.get(i);
          if (Boolean(m.get("hidden"))) wanted.add(m.get("id") as string);
          else break;
        }
      }
      /* Collect the sources in document order, at the destination ROLE.
       * Role = height above each board's own leaf, not raw depth: a
       * cross-ladder copy pairs a 4-tier scene with a 3-tier board's
       * scene row even though their depths differ, and must NOT pair a
       * 4-tier scene with a 3-tier beat row even though their depths
       * match (that drop used to clone children below the leaf). Within
       * one board height and depth agree, so same-board behavior is
       * unchanged. */
      const boards = boardsArr();
      if (!boards) return;
      const dstBoard = parentId === null ? boardMapById(rootBoardId ?? "") : locate(parentId)?.boardMap;
      const dstLeaf = (dstBoard ? (partArr(dstBoard, "levels")?.length ?? 1) : 1) - 1;
      const dstHeight = dstLeaf - dstDepth;
      const sources: Node[] = [];
      for (let b = 0; b < boards.length; b++) {
        const boardMap = boards.get(b);
        const roots = partArr(boardMap, "roots");
        if (!roots) continue;
        const leafB = (partArr(boardMap, "levels")?.length ?? 1) - 1;
        const collect = (arr: YArr, depth: number) => {
          for (let i = 0; i < arr.length; i++) {
            const m = arr.get(i);
            /* At the destination ROLE -- or a NESTING CARD, which has
             * no role: no children, so no rung is wrong for it (the same
             * relaxation tierOk makes for a move). */
            if (wanted.has(m.get("id") as string) && (leafB - depth === dstHeight || nestedY(m))) {
              sources.push(nodeToPlain(m));
            }
            const ch = m.get("children") as YArr | undefined;
            if (ch && ch.length) collect(ch, depth + 1);
          }
        };
        collect(roots, 0);
      }
      if (sources.length === 0) return;
      const clones = sources.map((n) => regenIds(n));
      made.push(...clones.map((c) => c.id));
      const at = Math.max(0, Math.min(index, dstArr.length));
      dstArr.insert(at, clones.map(buildNodeY));
    });
    return made;
  },

  /* Cut: remove a set of nodes (+ their trailing hidden stacks) from the
   * doc and return plain snapshots + their tier depth AND role height,
   * for the clipboard. Only the first-found tier is taken (a cut is
   * single-tier). `height` (distance above the source board's leaf) is
   * what cross-ladder pastes match on -- depth only means the same thing
   * between same-length ladders.
   *
   * `remove` is what separates CUT from COPY, and it is the only
   * difference between them: both need the identical collection pass
   * (the tier rule, the trailing hidden stacks, the plain projection),
   * so a copy that reimplemented any of it would drift. Copy arrived
   * late -- the clipboard was cut-only until 2026-08-26 -- which is why
   * this reads as a cut with a flag rather than the other way round. */
  extractNodes(
    ids: string[],
    remove = true,
  ): { nodes: Node[]; depth: number; height: number } | null {
    let out: { nodes: Node[]; depth: number; height: number } | null = null;
    tx(() => {
      const boards = boardsArr();
      if (!boards) return;
      const set = new Set(ids);
      for (const l of locateMany(ids).values()) {
        for (let i = l.index + 1; i < l.arr.length; i++) {
          const m = l.arr.get(i);
          if (Boolean(m.get("hidden"))) set.add(m.get("id") as string);
          else break;
        }
      }
      let depth = -1;
      let height = 0;
      const collected: YMap[] = [];
      for (let b = 0; b < boards.length; b++) {
        const boardMap = boards.get(b);
        const roots = partArr(boardMap, "roots");
        if (!roots) continue;
        const leafB = (partArr(boardMap, "levels")?.length ?? 1) - 1;
        const walkAll = (arr: YArr, d: number) => {
          for (let i = 0; i < arr.length; i++) {
            const m = arr.get(i);
            if (set.has(m.get("id") as string)) {
              if (depth < 0) {
                depth = d;
                height = leafB - d;
              }
              if (d === depth) collected.push(m);
            }
            const ch = m.get("children") as YArr | undefined;
            if (ch && ch.length) walkAll(ch, d + 1);
          }
        };
        walkAll(roots, 0);
      }
      if (!collected.length) return;
      const nodes = collected.map((m) => nodeToPlain(m));
      if (remove) {
        for (const n of nodes) {
          const l = locate(n.id);
          if (l) l.arr.delete(l.index, 1);
        }
      }
      out = { nodes, depth, height };
    });
    return out;
  },

  /* Paste: insert deep clones (fresh ids) of clipboard nodes at `parentId`
   * / `index` (or the roots of `rootBoardId`). The caller enforces the
   * tier match (paste like into like -- works across boards). */
  insertNodes(parentId: string | null, index: number, nodes: Node[], rootBoardId?: string) {
    if (!nodes.length) return;
    tx(() => {
      let dstArr: YArr;
      if (parentId === null) {
        const board = boardMapById(rootBoardId ?? "");
        if (!board) return;
        const roots = partArr(board, "roots");
        if (!roots) return;
        dstArr = roots;
      } else {
        const p = locate(parentId);
        if (!p || nestedY(p.map)) return;
        dstArr = p.map.get("children") as YArr;
      }
      const clones = nodes.map((n) => buildNodeY(regenIds(n)));
      const i = Math.max(0, Math.min(index, dstArr.length));
      dstArr.insert(i, clones);
    });
  },

  /* ---- tier ladder (per board) ------------------------------------ */

  /* Relabel this tier's own default-color legend entry from whatever the
   * level currently says. Both writers below call it, so a rename can't
   * drop a descriptor and a descriptor can't stale a rename. */
  setLevelName(boardId: string, depth: number, name: string) {
    tx(() => {
      const board = boardMapById(boardId);
      const level = levelAt(boardId, depth);
      if (!board || !level) return;
      level.set("name", name);
      relabelTierEntry(board, level);
    });
  },

  /* The tier's DESCRIPTOR: what its default color means, shown only in
   * the legend as "Scene (Linear)". Deliberately not the tier's name --
   * that noun is used in counts, add buttons and the graduation menu,
   * where a color's meaning has no business. */
  setLevelDescriptor(boardId: string, depth: number, descriptor: string) {
    tx(() => {
      const board = boardMapById(boardId);
      const level = levelAt(boardId, depth);
      if (!board || !level) return;
      const d = descriptor.trim();
      if (d) level.set("descriptor", d);
      else level.delete("descriptor"); // blank is not a value
      relabelTierEntry(board, level);
    });
  },

  /* Add a new top tier ("add parent category"): wrap the board's roots
   * under one new blank node AND prepend the level, in one transaction.
   * Capped at MAX_TIERS. */
  addParentTier(boardId: string, name: string) {
    tx(() => {
      const board = boardMapById(boardId);
      if (!board) return;
      const levels = partArr(board, "levels");
      const roots = partArr(board, "roots");
      if (!levels || !roots || levels.length >= MAX_TIERS) return;
      const wrapped = roots.toArray().map((m) => nodeToPlain(m));
      const parent: Node = { id: uid("n0"), title: "", collapsed: false, children: wrapped };
      roots.delete(0, roots.length);
      roots.push([buildNodeY(parent)]);
      const level: LevelDef = {
        id: uid("lvl"),
        name,
        variant: "reel",
        fields: { color: false, notes: true },
      };
      levels.insert(0, [buildLevelY(level)]);
      // give the new tier a default color entry (Defaults row)
      const legend = ensureLegend(board);
      legend.push([buildLegendY(tierDefaultFor(levels.toArray().map(levelToPlain), level.id))]);
    });
  },

  /* Default title font for a tier (per-card font still overrides). */
  setLevelDefaultFont(boardId: string, depth: number, font: string) {
    tx(() => levelAt(boardId, depth)?.set("defaultFont", font));
  },

  /* Proxy aspect (width/height) for a tier in the Overview. */
  setLevelAspect(boardId: string, depth: number, aspect: number) {
    tx(() => levelAt(boardId, depth)?.set("aspect", aspect));
  },

  /* Anchored card height for a tier (px); width follows from the aspect. */
  setLevelHeight(boardId: string, depth: number, height: number) {
    tx(() => levelAt(boardId, depth)?.set("height", height));
  },

  /* The TARGET title size for a tier (px) -- a title renders at this and
   * auto-shrinks if it cannot fit. The only size knob since expandText
   * retired (2026-08-14). */
  setLevelTextSize(boardId: string, depth: number, size: number) {
    tx(() => {
      const l = levelAt(boardId, depth);
      if (!l) return;
      l.set("textSize", size);
      /* Choosing a size ADOPTS the post-expandText model for this tier:
       * while the retired flag is set, targetFontSize ignores textSize
       * (see its header), so leaving it would make the slider look
       * broken -- you would drag it and nothing would move. */
      if (l.get("expandText") !== undefined) l.delete("expandText");
    });
  },

  /* Title color override for a tier; "" clears it (back to auto-contrast). */
  setLevelTextColor(boardId: string, depth: number, color: string) {
    tx(() => {
      const m = levelAt(boardId, depth);
      if (!m) return;
      if (color) m.set("textColor", color);
      else m.delete("textColor");
    });
  },

  /* Header tiers (above the scene tier): full-width band vs aspect card. */
  setLevelFullWidth(boardId: string, depth: number, fullWidth: boolean) {
    tx(() => levelAt(boardId, depth)?.set("fullWidth", fullWidth));
  },

  /* SET TO APP DEFAULT (owner, 2026-09-08): one tier's GEOMETRY back to
   * what a new board stamps for its height above the leaf
   * (state/tierDefaults.ts) -- text size, height, aspect, full width,
   * band height -- in one transaction, so it is one undo. Its name,
   * color, font and descriptor are the tier's identity and stay. */
  resetLevelGeometry(boardId: string, depth: number) {
    tx(() => {
      const b = boardMapById(boardId);
      const m = levelAt(boardId, depth);
      if (!b || !m) return;
      const levels = partArr(b, "levels");
      if (!levels) return;
      const leaf = levels.length - 1;
      const d = tierDefault(leaf - depth);
      m.set("textSize", d.textSize);
      m.set("height", d.height);
      m.set("aspect", d.aspect);
      if (m.get("expandText") !== undefined) m.delete("expandText");
      if (depth < leaf - 1) {
        m.set("fullWidth", d.fullWidth ?? false);
        if (d.bandHeight) m.set("bandHeight", d.bandHeight);
        else m.delete("bandHeight");
      } else {
        m.delete("fullWidth");
        m.delete("bandHeight");
      }
    });
  },

  /* THE STRIP a tier holds beside its cards: which side, how big the
   * picture stands, the air between it and the card, and whether it
   * centers in the space or snugs up to the card (types.ts). A patch
   * rather than four arguments, since the panel edits one knob at a
   * time and the others must survive untouched. */
  setLevelImageStrip(
    boardId: string,
    depth: number,
    patch: { edge?: ImageEdge | null; size?: number; gap?: number; center?: boolean },
  ) {
    tx(() => {
      const m = levelAt(boardId, depth);
      if (!m) return;
      if (patch.edge === null) {
        // clearing the side clears the whole strip: "no picture beside
        // this card" is said by the side, never by winding a knob to zero
        for (const k of ["imageEdge", "imageRoom", "imageGap", "imageCenter"]) m.delete(k);
        return;
      }
      if (patch.edge) m.set("imageEdge", patch.edge);
      if (patch.size !== undefined) {
        m.set("imageRoom", Math.min(MAX_IMAGE_ROOM, Math.max(MIN_IMAGE_ROOM, patch.size)));
      }
      if (patch.gap !== undefined) {
        const gap = Math.min(MAX_IMAGE_GAP, Math.max(0, Math.round(patch.gap)));
        if (gap > 0) m.set("imageGap", gap);
        else m.delete("imageGap");
      }
      if (patch.center !== undefined) {
        if (patch.center) m.set("imageCenter", true);
        else m.delete("imageCenter");
      }
    });
  },

  /* Band height for a full-width tier (px); 0/negative clears it back to
   * content-sized. Separate from `height`, which belongs to card mode. */
  setLevelBandHeight(boardId: string, depth: number, px: number) {
    tx(() => {
      const m = levelAt(boardId, depth);
      if (!m) return;
      if (px > 0) m.set("bandHeight", px);
      else m.delete("bandHeight");
    });
  },

  /* ---- legend (per board) ----------------------------------------- */

  /* Idempotent upgrade: ensure the board's legend has one `tier`-bound
   * default entry per current level. */
  ensureTierDefaults(boardId: string) {
    tx(() => {
      const board = boardMapById(boardId);
      if (!board) return;
      const levels = partArr(board, "levels")?.toArray().map(levelToPlain) ?? [];
      if (levels.length === 0) return;
      const arr = ensureLegend(board);
      const have = new Set<string>();
      for (let i = 0; i < arr.length; i++) {
        const t = arr.get(i).get("tier");
        if (t) have.add(t as string);
      }
      for (const l of levels) {
        if (!have.has(l.id)) arr.push([buildLegendY(tierDefaultFor(levels, l.id))]);
      }
      /* ...and the NESTED default, which is not a tier (colors.ts
       * `nestedDefault`). Upserted here for the same reason the tier
       * ones are: a board that predates it has to grow the entry, and
       * it has to be there even on a board with no nesting cards --
       * standing in the legend is what says the option exists. */
      let hasNested = false;
      for (let i = 0; i < arr.length; i++) if (arr.get(i).get("role") === "nested") hasNested = true;
      if (!hasNested) arr.push([buildLegendY(nestedDefault())]);
    });
  },

  /* Set a tier's default color, upserting its `tier`-bound legend entry. */
  setTierColor(boardId: string, levelId: string, bg: string) {
    tx(() => {
      const board = boardMapById(boardId);
      if (!board) return;
      const arr = ensureLegend(board);
      for (let i = 0; i < arr.length; i++) {
        const e = arr.get(i);
        if (e.get("tier") === levelId) {
          e.set("bg", bg);
          e.set("border", deriveBorder(bg));
          return;
        }
      }
      const levels = partArr(board, "levels")?.toArray().map(levelToPlain) ?? [];
      if (!levels.some((l) => l.id === levelId)) return; // unknown tier
      const entry = tierDefaultFor(levels, levelId);
      arr.push([buildLegendY({ ...entry, bg, border: deriveBorder(bg) })]);
    });
  },

  /* AN ENTRY LIVES ON THE BOARD OR IN THE PALETTE (ADR 0006): tier
   * defaults and the nesting fill on the board, every override in the
   * project's palette. The board id still travels on these calls -- it
   * says where the tier defaults are -- and each looks on the board
   * first, then up. */
  setLegendLabel(boardId: string, id: string, label: string) {
    tx(() => {
      const found = findLegendEntry(boardId, id);
      if (found) found.map.set("label", label);
    });
  },

  setLegendColor(boardId: string, id: string, bg: string) {
    tx(() => {
      const found = findLegendEntry(boardId, id);
      if (!found) return;
      found.map.set("bg", bg);
      found.map.set("border", deriveBorder(bg));
    });
  },

  /* A new override goes straight into the palette: it is the project's
   * from birth, visible on this board because it is fresh (board/
   * newColors.ts) and on any other the moment a card there wears it. */
  addLegendEntry(_boardId: string): string {
    let id = "";
    tx(() => {
      const arr = ensurePaletteArr();
      const bg = "#dcdce0";
      const entry: LegendEntry = { id: uid("leg"), label: "New", bg, border: deriveBorder(bg) };
      id = entry.id;
      arr.push([buildLegendY(entry)]);
    });
    return id;
  },

  /* Removing an override removes it from the PROJECT: every board's
   * cards that wore it fall back to their tier's default. The panel
   * says how many, across how many boards, before it lets you. */
  removeLegendEntry(boardId: string, id: string) {
    tx(() => {
      const found = findLegendEntry(boardId, id);
      if (!found) return;
      if (found.map.get("tier")) return; // tier defaults are not removable
      found.arr.delete(found.index, 1);
    });
  },

  /* ---- tags (ADR 0002) -------------------------------------------- *
   * Project-level vocabulary; each definition carries the placement that
   * every card carrying it draws, so the mark lands in the same spot
   * board-wide. Applying/removing is per node, at any tier. */

  addTag(seed?: Partial<TagDef>): string {
    const id = uid("tag");
    tx(() => {
      ensureTagsArr().push([
        buildTagY({
          id,
          name: seed?.name ?? "",
          color: seed?.color ?? TAG_COLORS[(tagsArr()?.length ?? 0) % TAG_COLORS.length],
          pos: seed?.pos ?? 0,
          reach: seed?.reach ?? TAG_REACH.default,
          span: seed?.span ?? TAG_SPAN.default,
          offset: seed?.offset ?? 0,
          shape: seed?.shape ?? "flat",
          visible: seed?.visible ?? true,
          kind: seed?.kind ?? "tab",
        }),
      ]);
    });
    return id;
  },

  setTag(id: string, patch: Partial<Omit<TagDef, "id">>) {
    tx(() => {
      const arr = tagsArr();
      if (!arr) return;
      for (let i = 0; i < arr.length; i++) {
        const m = arr.get(i);
        if (m.get("id") !== id) continue;
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) m.set(k, v);
        return;
      }
    });
  },

  /* Remove a definition AND every application of it -- a tag id that no
   * longer resolves would leave invisible dead weight on nodes. */
  /* Move a tag to sit BEFORE `beforeId` in the project vocabulary (null =
   * to the end). The array order is not decoration: it is the paint order
   * of the tabs, so dragging a swatch up the legend is how you say which
   * tag wins when two overlap on a card (board/TagTabs.tsx).
   *
   * Clone-and-reinsert rather than a Y.Array move, which Yjs has no
   * primitive for -- the same shape as every other reorder here, and the
   * merge-repair pass already dedupes tag ids if two peers reorder at
   * once. */
  reorderTag(id: string, beforeId: string | null) {
    tx(() => {
      const arr = tagsArr();
      if (!arr || id === beforeId) return;
      const at = arr.toArray().findIndex((t) => t.get("id") === id);
      if (at < 0) return;
      const plain = tagToPlain(arr.get(at));
      arr.delete(at, 1);
      const before =
        beforeId === null ? arr.length : arr.toArray().findIndex((t) => t.get("id") === beforeId);
      arr.insert(before < 0 ? arr.length : before, [buildTagY(plain)]);
    });
  },

  /* The same, for a board's legend. Tier DEFAULTS are excluded on both
   * ends: their row is the tier ladder's order, not a free list, and
   * letting one slide into the overrides would put a tier's default
   * color in a row that doesn't mean that. */
  reorderLegendEntry(boardId: string, id: string, beforeId: string | null) {
    tx(() => {
      if (id === beforeId) return;
      /* the overrides row IS the palette now; a board's own list only
       * ever holds defaults, which do not reorder */
      const arr = findLegendEntry(boardId, id)?.arr;
      if (!arr) return;
      const at = arr.toArray().findIndex((e) => e.get("id") === id);
      if (at < 0 || arr.get(at).get("tier")) return;
      const plain = legendToPlain(arr.get(at));
      arr.delete(at, 1);
      let before = arr.length;
      if (beforeId !== null) {
        const found = arr.toArray().findIndex((e) => e.get("id") === beforeId);
        if (found >= 0 && !arr.get(found).get("tier")) before = found;
      }
      arr.insert(before, [buildLegendY(plain)]);
    });
  },

  /* Reorder the metadata categories, exactly as reorderTag does for the
   * vocabulary above. The order is not decoration here either: it is the
   * order every card's panel lists its categories in, so it is how you
   * put the ones you fill in constantly at the top.
   *
   * Clone-and-reinsert rather than a Y.Array move, which Yjs has no
   * primitive for -- the same shape (and the same concurrent-move caveat)
   * as reorderTag. */
  reorderField(id: string, beforeId: string | null) {
    tx(() => {
      const arr = fieldsArr();
      if (!arr || id === beforeId) return;
      const at = arr.toArray().findIndex((f) => f.get("id") === id);
      if (at < 0) return;
      const plain = fieldToPlain(arr.get(at));
      arr.delete(at, 1);
      const before =
        beforeId === null ? arr.length : arr.toArray().findIndex((f) => f.get("id") === beforeId);
      arr.insert(before < 0 ? arr.length : before, [buildFieldY(plain)]);
    });
  },

  removeTag(id: string) {
    tx(() => {
      const arr = tagsArr();
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          if (arr.get(i).get("id") === id) {
            arr.delete(i, 1);
            break;
          }
        }
      }
      const boards = boardsArr();
      if (!boards) return;
      const strip = (nodes: YArr) => {
        for (let i = 0; i < nodes.length; i++) {
          const m = nodes.get(i);
          const tags = m.get("tags");
          if (tags instanceof Y.Array) {
            for (let t = tags.length - 1; t >= 0; t--) if (tags.get(t) === id) tags.delete(t, 1);
            if (tags.length === 0) m.delete("tags");
          }
          const ch = m.get("children") as YArr | undefined;
          if (ch && ch.length) strip(ch);
        }
      };
      for (let b = 0; b < boards.length; b++) {
        const roots = partArr(boards.get(b), "roots");
        if (roots) strip(roots);
      }
    });
  },

  /* Find-and-replace across a set of titles, in ONE transaction.
   *
   * One transaction is the whole point: `setNodeField` per card would be
   * one undo step per card, so backing out a 40-card replace would mean
   * forty Cmd-Zs. Here it is one, and one sync message.
   *
   * Only rewrites titles that actually change, so a node whose title
   * doesn't contain `find` is never touched -- it stays out of the undo
   * entry and out of the update sent to every peer. Returns how many
   * titles changed, which is what the confirmation reports.
   *
   * NOTE undo is local-origin only (see the UndoManager). A collaborator
   * cannot undo YOUR bulk replace, which is why the UI confirms with a
   * preview rather than just doing it. */
  replaceInTitles(ids: string[], find: string, to: string, matchCase = false): number {
    let changed = 0;
    if (!find) return 0;
    tx(() => {
      for (const n of locateMany(ids).values()) {
        /* NEVER a nesting card. It draws its TARGET board's title and
         * keeps its own written-but-unread, so rewriting `title` here
         * would silently edit a name nobody can see -- and would not
         * touch the words the preview showed. Renaming the board is the
         * deliberate act, and it lives in the card menu. Guarded in the
         * OP, not just the UI, so no caller can route round it. */
        if (n.map.get("boardRef")) continue;
        const title = n.map.get("title");
        if (typeof title !== "string") continue;
        const next = replaceAllIn(title, find, to, matchCase);
        if (next === title) continue;
        n.map.set("title", next);
        changed++;
      }
    });
    return changed;
  },

  /* Apply/remove a tag on a set of nodes (a selection tags together). */
  /* Paint a run of cards one color, in ONE transaction (= one undo
   * step). The card menu's swatches and a color dragged out of the
   * legend both land here: a right-click on a card that's part of a
   * selection acts on the whole selection, the way Cut and Remove-tags
   * already do. "" clears back to the tier default. */
  setNodesColor(ids: string[], color: string) {
    tx(() => {
      for (const n of locateMany(ids).values()) {
        if (color) n.map.set("color", color);
        else n.map.delete("color");
      }
    });
  },

  setNodeTag(ids: string[], tagId: string, on: boolean) {
    tx(() => {
      for (const n of locateMany(ids).values()) {
        let tags = n.map.get("tags");
        if (!(tags instanceof Y.Array)) {
          if (!on) continue;
          tags = new Y.Array<string>();
          n.map.set("tags", tags);
        }
        const arr = tags as Y.Array<string>;
        const at = arr.toArray().indexOf(tagId);
        if (on && at < 0) arr.push([tagId]);
        else if (!on && at >= 0) arr.delete(at, 1);
        if (arr.length === 0) n.map.delete("tags");
      }
    });
  },

  /* Take every tag off these nodes (the card menu's "Remove all tags").
   * The definitions stay in the project -- this detaches, it doesn't
   * delete. */
  clearNodeTags(ids: string[]) {
    tx(() => {
      for (const n of locateMany(ids).values()) {
        if (n.map.get("tags") !== undefined) n.map.delete("tags");
      }
    });
  },

  /* ---- notes ------------------------------------------------------ *
   * A card holds a LIST of notes, each with an author, an open/resolved
   * state and its own replies. Written from the quick Note panel (which
   * edits the most recent one) and from the Notes view. */

  addNote(nodeId: string, seed?: { body?: string; author?: string }): string {
    const id = uid("nt");
    tx(() => {
      const n = locate(nodeId);
      if (!n) return;
      ensureNotes(n.map).push([
        buildNoteY({
          id,
          body: seed?.body ?? "",
          author: seed?.author ?? "",
          state: "open",
          createdAt: Date.now(),
        }),
      ]);
    });
    return id;
  },

  /* Edit a note's body / author / state / implementation note. Pass
   * `replyId` to edit a reply instead of the note it hangs off. An empty
   * implementation note is no implementation note (the key goes, and its
   * author and time with it), the rule every optional string on a node
   * follows. Writing `impl` without `implBy` / `implAt` leaves whatever
   * stamp is there; the panel always sends all three. */
  setNote(
    nodeId: string,
    noteId: string,
    patch: Partial<Pick<Note, "body" | "author" | "state" | "impl" | "implBy" | "implAt">>,
    replyId?: string,
  ) {
    tx(() => {
      const target = locateNote(nodeId, noteId, replyId);
      if (!target) return;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (k === "impl" && !v) {
          target.map.delete("impl");
          target.map.delete("implBy");
          target.map.delete("implAt");
        } else if (k === "implBy" && !v) target.map.delete("implBy");
        else target.map.set(k, v);
      }
    });
  },

  /* Delete a note (or one reply). Deliberately separate from resolving:
   * a resolved note is a kept record, deleting is the explicit throw-away. */
  removeNote(nodeId: string, noteId: string, replyId?: string) {
    tx(() => {
      const n = locate(nodeId);
      if (!n) return;
      const notes = n.map.get("notes");
      if (!(notes instanceof Y.Array)) return;
      if (replyId) {
        const parent = findNoteIn(notes as YArr, noteId);
        const replies = parent?.map.get("replies");
        if (!(replies instanceof Y.Array)) return;
        const hit = findNoteIn(replies as YArr, replyId);
        if (!hit) return;
        (replies as YArr).delete(hit.index, 1);
        if ((replies as YArr).length === 0) parent!.map.delete("replies");
        return;
      }
      const hit = findNoteIn(notes as YArr, noteId);
      if (!hit) return;
      (notes as YArr).delete(hit.index, 1);
      // an empty list is no list, the same as tags/values
      if ((notes as YArr).length === 0) n.map.delete("notes");
    });
  },

  /* The receiver answering a note with context, rather than leaving a
   * second unattached note. One level deep -- see the Note type. */
  addReply(nodeId: string, noteId: string, seed?: { body?: string; author?: string }): string {
    const id = uid("nt");
    tx(() => {
      const target = locateNote(nodeId, noteId);
      if (!target) return;
      let replies = target.map.get("replies");
      if (!(replies instanceof Y.Array)) {
        replies = new Y.Array() as YArr;
        target.map.set("replies", replies);
      }
      (replies as YArr).push([
        buildNoteY({
          id,
          body: seed?.body ?? "",
          author: seed?.author ?? "",
          state: "open",
          createdAt: Date.now(),
        }),
      ]);
    });
    return id;
  },

  /* ---- metadata categories (spec Sec 7 "scalar layers") ----------- *
   * Project-level definitions, like tags -- define a category once and it
   * appears on every card's metadata panel with a blank value. The value
   * itself is per node. Tags handle membership, fields handle values (the
   * closing note of ADR 0002). */

  addField(seed?: Partial<FieldDef>): string {
    const id = uid("fld");
    tx(() => {
      ensureFieldsArr().push([buildFieldY({ id, name: seed?.name ?? "" })]);
    });
    return id;
  },

  /* Rename a category. Project-wide by design: the label belongs to the
   * definition, so every card that has filled it in is re-labelled too. */
  setField(id: string, patch: Partial<Omit<FieldDef, "id">>) {
    tx(() => {
      const arr = fieldsArr();
      if (!arr) return;
      for (let i = 0; i < arr.length; i++) {
        const m = arr.get(i);
        if (m.get("id") !== id) continue;
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) m.set(k, v);
        return;
      }
    });
  },

  /* Remove a category AND every value filed under it -- a value whose
   * category is gone can never be shown or edited again, so leaving them
   * behind would just be invisible weight (same reasoning as removeTag). */
  removeField(id: string) {
    tx(() => {
      const arr = fieldsArr();
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          if (arr.get(i).get("id") === id) {
            arr.delete(i, 1);
            break;
          }
        }
      }
      const boards = boardsArr();
      if (!boards) return;
      const strip = (nodes: YArr) => {
        for (let i = 0; i < nodes.length; i++) {
          const m = nodes.get(i);
          const values = m.get("values");
          if (values instanceof Y.Map) {
            values.delete(id);
            if (values.size === 0) m.delete("values");
          }
          const ch = m.get("children") as YArr | undefined;
          if (ch && ch.length) strip(ch);
        }
      };
      for (let b = 0; b < boards.length; b++) {
        const roots = partArr(boards.get(b), "roots");
        if (roots) strip(roots);
      }
    });
  },

  /* Set one category's value on a set of nodes. A blank value is the same
   * as no value: it deletes the key, and the last one out deletes the map,
   * so an untouched card carries nothing (the same shape as tags). */
  setNodeValue(ids: string[], fieldId: string, value: string) {
    tx(() => {
      for (const n of locateMany(ids).values()) {
        let values = n.map.get("values");
        if (!(values instanceof Y.Map)) {
          if (!value) continue;
          values = new Y.Map<string>();
          n.map.set("values", values);
        }
        const map = values as Y.Map<string>;
        if (value) map.set(fieldId, value);
        else map.delete(fieldId);
        if (map.size === 0) n.map.delete("values");
      }
    });
  },

  /* Write several categories at once, onto several cards at once -- the
   * bulk half of the metadata workflow ("paste these values onto every
   * card I selected"). A blank clears, exactly as setNodeValue's does, so
   * pasting an empty value is how you wipe a category across a selection.
   *
   * One walk for the whole selection (locateMany), not one per card. */
  setNodeValues(ids: string[], patch: Record<string, string>) {
    const entries = Object.entries(patch);
    if (!entries.length) return;
    tx(() => {
      for (const n of locateMany(ids).values()) {
        let values = n.map.get("values");
        for (const [fieldId, raw] of entries) {
          const value = raw.trim();
          if (!(values instanceof Y.Map)) {
            if (!value) continue; // nothing to clear, nothing to store
            values = new Y.Map<string>();
            n.map.set("values", values);
          }
          const map = values as Y.Map<string>;
          if (value) map.set(fieldId, value);
          else map.delete(fieldId);
        }
        if (values instanceof Y.Map && values.size === 0) n.map.delete("values");
      }
    });
  },

  /* Put a category in one of a card's six display slots, or clear the slot
   * (`fieldId` null). A category lives in at most ONE slot per card, so
   * placing one that's already somewhere else MOVES it -- otherwise a drag
   * would silently leave a copy behind. */
  setNodeSlot(ids: string[], slot: SlotId, fieldId: string | null) {
    tx(() => {
      for (const n of locateMany(ids).values()) {
        let slots = n.map.get("slots");
        if (!(slots instanceof Y.Map)) {
          if (!fieldId) continue;
          slots = new Y.Map<string>();
          n.map.set("slots", slots);
        }
        const map = slots as Y.Map<string>;
        if (fieldId) {
          for (const [k, v] of [...map.entries()]) if (v === fieldId && k !== slot) map.delete(k);
          map.set(slot, fieldId);
        } else {
          map.delete(slot);
        }
        if (map.size === 0) n.map.delete("slots");
      }
    });
  },

  /* Push chosen VALUES from one card onto every card at the SAME TIER
   * inside a scope -- the structural twin of applyLayout, and its
   * counterpart to the paste-values clipboard.
   *
   * The clipboard flow (copy a card, select the targets, paste) is for a
   * handful of cards you can point at. This is for "every beat in this
   * reel", where pointing at them isn't viable. Same scope model as
   * applyLayout so the two read alike.
   *
   * `fieldIds` is what the caller ticked, so filling in a shoot day
   * doesn't drag a timecode along with it. A blank source value CLEARS the
   * category on the targets -- the same rule as PasteValuesPopover, and
   * the only way to wipe a column in bulk. Returns how many cards changed.
   *
   * The write keeps ADR 0003's invariant: a blank is not a value, so
   * clearing removes the key, and the last key out removes the map. */
  applyValues(sourceId: string, scopeId: string | null, fieldIds: string[]): number {
    let count = 0;
    if (!fieldIds.length) return 0;
    tx(() => {
      const src = locate(sourceId);
      if (!src) return;
      const srcValues = src.map.get("values");
      const from = srcValues instanceof Y.Map ? (srcValues as Y.Map<string>) : null;
      // snapshot what we're pushing before touching anything
      const patch = fieldIds.map((id) => [id, (from?.get(id) ?? "").trim()] as const);

      let roots: YArr | null = null;
      let rootDepth = 0;
      if (scopeId) {
        const scope = locate(scopeId);
        if (!scope) return;
        roots = (scope.map.get("children") as YArr | undefined) ?? null;
        rootDepth = scope.depth + 1;
      } else {
        roots = partArr(src.boardMap, "roots");
        rootDepth = 0;
      }
      if (!roots) return;

      const walk = (arr: YArr, depth: number) => {
        for (let i = 0; i < arr.length; i++) {
          const m = arr.get(i);
          if (depth === src.depth) {
            if (m.get("id") !== sourceId) {
              count++;
              let vals = m.get("values");
              if (!(vals instanceof Y.Map)) {
                // nothing to clear, and nothing to write into yet
                if (patch.every(([, v]) => v === "")) continue;
                vals = new Y.Map<string>();
                m.set("values", vals);
              }
              const map = vals as Y.Map<string>;
              for (const [id, v] of patch) {
                if (v === "") map.delete(id);
                else map.set(id, v);
              }
              if (map.size === 0) m.delete("values");
            }
            continue; // same-tier cards only; no need to go deeper
          }
          const ch = m.get("children") as YArr | undefined;
          if (ch && ch.length) walk(ch, depth + 1);
        }
      };
      walk(roots, rootDepth);
    });
    return count;
  },

  /* Push one card's layout onto every card at the SAME TIER inside a
   * scope -- the whole board, or one ancestor's subtree. Placement is per
   * card (a card can differ from its neighbours), so this is how a layout
   * stops being a one-card decision without making it a global one.
   *
   * Layout only: values stay where they are. Returns how many cards took it. */
  applyLayout(sourceId: string, scopeId: string | null): number {
    let count = 0;
    tx(() => {
      const src = locate(sourceId);
      if (!src) return;
      const layout = src.map.get("slots");
      const entries =
        layout instanceof Y.Map
          ? ([...(layout as Y.Map<string>).entries()] as [string, string][])
          : [];
      // the subtree to sweep, and the depth it starts at
      let roots: YArr | null = null;
      let rootDepth = 0;
      if (scopeId) {
        const scope = locate(scopeId);
        if (!scope) return;
        roots = (scope.map.get("children") as YArr | undefined) ?? null;
        rootDepth = scope.depth + 1;
      } else {
        roots = partArr(src.boardMap, "roots");
        rootDepth = 0;
      }
      if (!roots) return;
      const walk = (arr: YArr, depth: number) => {
        for (let i = 0; i < arr.length; i++) {
          const m = arr.get(i);
          if (depth === src.depth) {
            if (m.get("id") !== sourceId) {
              count++;
              if (entries.length) {
                const next = new Y.Map<string>();
                for (const [k, v] of entries) next.set(k, v);
                m.set("slots", next);
              } else {
                m.delete("slots"); // an empty layout clears theirs too
              }
            }
            continue; // same-tier cards only; no need to go deeper
          }
          const ch = m.get("children") as YArr | undefined;
          if (ch && ch.length) walk(ch, depth + 1);
        }
      };
      walk(roots, rootDepth);
    });
    return count;
  },

  /* ---- graduation (owner's design, 2026-08-02) -------------------- *
   * A node CONVERTS to the neighbouring tier -- tier is depth, so the op
   * is a move and the whole subtree shifts a rung with it. Everything the
   * card carries (tags, values, slots, notes, color, font) is tier-
   * agnostic by design (ADR 0002/0003), so it all ports untouched, and
   * the node keeps its ID, so panels/selection/fold stay coherent. */

  /* Promote: the node converts to its parent's tier. Always structurally
   * safe (going up never pushes anything below the leaf) -- and if the
   * node carried STOWED children (below-leaf content, see demoteNode),
   * they surface again simply by fitting the ladder. Roots can't promote
   * (there is no tier above; "add parent category" is the board door).
   *
   * PLACEMENT PRESERVES READING ORDER (owner's refinement): `mode` says
   * where the promoted node lands relative to its old parent --
   *   "before" -- ahead of the parent (it was the parent's FIRST child)
   *   "after"  -- behind it (it was the LAST child; the classic case)
   *   "split"  -- it sat in the MIDDLE, so the parent SPLITS around it:
   *               the parent keeps the leading siblings, the node lands
   *               next, and the trailing siblings move (ids kept) into a
   *               fresh "<parent title> (cont'd)" continuation -- the
   *               screenwriter's own idiom. The continuation inherits the
   *               parent's color/font AND its tags/values/slots (it IS
   *               the same scene resumed; owner's call) -- but not its
   *               notes, which are conversations about the original.
   * The card menu picks the mode (dialog for the surrounded case).
   * Returns whether it happened. */
  promoteNode(id: string, mode: "before" | "after" | "split" = "after"): boolean {
    let ok = false;
    tx(() => {
      const fam = locateFamily(id);
      if (!fam || fam.parentArr === undefined || fam.parentIndex === undefined) return;
      const parentMap = fam.parentArr.get(fam.parentIndex);
      const plain = nodeToPlain(fam.map);
      // beat-idiom attributes don't survive becoming a lane
      delete plain.breakAfter;
      delete plain.hidden;

      if (mode === "split") {
        const parentPlain = nodeToPlain(parentMap);
        const trailing = parentPlain.children.slice(fam.index + 1);
        const cont: Node = {
          id: uid("n"),
          title: parentPlain.title ? parentPlain.title + " (cont'd)" : "(cont'd)",
          collapsed: false,
          children: trailing, // MOVED, ids kept -- panels/selection stay valid
        };
        if (parentPlain.color !== undefined) cont.color = parentPlain.color;
        if (parentPlain.font !== undefined) cont.font = parentPlain.font;
        if (parentPlain.tags?.length) cont.tags = [...parentPlain.tags];
        if (parentPlain.values) cont.values = { ...parentPlain.values };
        if (parentPlain.slots) cont.slots = { ...parentPlain.slots };
        // take the node and everything after it out of the parent...
        fam.arr.delete(fam.index, fam.arr.length - fam.index);
        // ...and land [promoted, continuation] right behind it
        fam.parentArr.insert(fam.parentIndex + 1, [buildNodeY(plain), buildNodeY(cont)]);
        ok = true;
        return;
      }

      fam.arr.delete(fam.index, 1);
      const at = mode === "before" ? fam.parentIndex : fam.parentIndex + 1;
      fam.parentArr.insert(at, [buildNodeY(plain)]);
      ok = true;
    });
    return ok;
  },

  /* Demote: the node converts one tier down; its subtree shifts with it.
   * WHOSE child it becomes is `into` (owner's design -- adoption is an
   * authorial choice, and every option preserves reading order):
   *
   *   "neighbor" -- tucks into the PRECEDING sibling as its last child
   *                 (else the following one, as its first). Needs a
   *                 sibling. The "this scene was really the tail of the
   *                 previous one" case.
   *   "wrap"     -- a fresh UNTITLED parent appears exactly where the
   *                 node stood, holding it as its only child. No
   *                 adoption; works with no siblings at all (it retires
   *                 the only-children-can't-demote restriction). The
   *                 caller auto-edits the returned wrapper so it gets a
   *                 name. Promote may split a parent; demote may mint
   *                 one.
   *
   * Content that would land below the leaf tier is handled per `leaves`:
   *   "stow"   -- it simply stays in the doc as below-leaf children:
   *               dormant, carried everywhere, surfaced again when the
   *               carrier is promoted back. Lossless round trip.
   *   "delete" -- subtrees that would sink below the leaf are removed.
   *
   * Leaf-tier nodes can't demote (there is no tier below; stow is a
   * demotion side-effect, not a direct gesture). */
  demoteNode(
    id: string,
    leaves: "stow" | "delete",
    into: "neighbor" | "wrap" = "neighbor",
  ): { ok: boolean; wrapper: string | null } {
    let ok = false;
    let wrapper: string | null = null;
    tx(() => {
      const fam = locateFamily(id);
      if (!fam) return;
      const leaf = (partArr(fam.boardMap, "levels")?.length ?? 1) - 1;
      if (fam.depth >= leaf) return; // already the leaf tier

      let plain = nodeToPlain(fam.map);
      if (leaves === "delete") {
        /* Remove the subtrees that would cross the leaf. After the demote
         * the node sits at depth+1, so a descendant at node-relative depth
         * r lands below the leaf iff r >= leaf - depth: empty the children
         * of every node one rung above that boundary. */
        const cut = leaf - fam.depth;
        const trim = (n: Node, r: number): Node => ({
          ...n,
          children: r + 1 === cut ? [] : n.children.map((c) => trim(c, r + 1)),
        });
        plain = trim(plain, 0);
      }

      if (into === "wrap") {
        const shell: Node = { id: uid("n"), title: "", collapsed: false, children: [plain] };
        wrapper = shell.id;
        fam.arr.delete(fam.index, 1);
        fam.arr.insert(fam.index, [buildNodeY(shell)]);
        ok = true;
        return;
      }

      const intoPrev = fam.index > 0;
      const targetIndex = intoPrev ? fam.index - 1 : fam.index + 1;
      if (targetIndex < 0 || targetIndex >= fam.arr.length) return; // only child, no neighbor
      const target = fam.arr.get(targetIndex);
      if (nestedY(target)) return; // a nested board holds no children
      fam.arr.delete(fam.index, 1);
      const children = target.get("children") as YArr;
      if (intoPrev) children.push([buildNodeY(plain)]);
      else children.insert(0, [buildNodeY(plain)]);
      ok = true;
    });
    return { ok, wrapper };
  },

  /* Drop a TALLER node into a board: the destination GROWS the tiers it
   * lacks (owner's refinement, 2026-08-02) rather than the node demoting.
   * One transaction:
   *   - the source board's upper LevelDefs port in as the new top tiers
   *     (name, styling, band mode -- and their tier-default legend colors),
   *   - the existing roots wrap under one blank node per added tier (tier
   *     is depth: if the ladder grows, every old root needs a new parent
   *     or it would BE the new top tier),
   *   - the dragged node lands as a fresh-id copy beside that wrapper.
   * Returns the copy's id, or null when the node isn't actually taller. */
  extendBoardWithNode(dstBoardId: string, srcNodeId: string): string | null {
    let made: string | null = null;
    tx(() => {
      const src = locate(srcNodeId);
      const dst = boardMapById(dstBoardId);
      if (!src || !dst) return;
      const srcLevelsArr = partArr(src.boardMap, "levels");
      const dstLevels = partArr(dst, "levels");
      const dstRoots = partArr(dst, "roots");
      if (!srcLevelsArr || !dstLevels || !dstRoots) return;
      const srcHeight = srcLevelsArr.length - 1 - src.depth;
      const k = srcHeight - (dstLevels.length - 1);
      if (k <= 0 || dstLevels.length + k > MAX_TIERS) return;

      // port the source's tiers-from-the-node-down-to-what-dst-has as the
      // new top of the destination ladder, fresh ids on collision
      const dstIds = new Set(dstLevels.toArray().map((m) => m.get("id") as string));
      const srcLegend = partArr(src.boardMap, "legend")?.toArray().map(legendToPlain) ?? [];
      const ported: LevelDef[] = [];
      for (let i = 0; i < k; i++) {
        const lvl = levelToPlain(srcLevelsArr.get(src.depth + i));
        const oldId = lvl.id;
        if (dstIds.has(lvl.id)) lvl.id = uid("lvl");
        ported.push(lvl);
        // its tier-default color comes along; rewire to the (possibly
        // fresh) level id and mint a fresh entry id to avoid collisions
        const entry = srcLegend.find((e) => e.tier === oldId);
        const dstLegend = ensureLegend(dst);
        dstLegend.push([
          buildLegendY(
            entry
              ? { ...entry, id: uid("leg"), tier: lvl.id, label: lvl.name }
              : tierDefaultFor([...ported], lvl.id),
          ),
        ]);
      }
      dstLevels.insert(0, ported.map(buildLevelY));

      // wrap the old roots: one blank node per added tier, nested
      const oldRoots = dstRoots.toArray().map((m) => nodeToPlain(m));
      let wrapped: Node[] = oldRoots;
      for (let i = k - 1; i >= 0; i--) {
        wrapped = [{ id: uid("n" + i), title: "", collapsed: false, children: wrapped }];
      }
      dstRoots.delete(0, dstRoots.length);
      dstRoots.push(wrapped.map(buildNodeY));

      // ...and the newcomer lands beside the wrapper, fresh ids (a
      // cross-board drop is a COPY; the source stays)
      const copy = regenIds(nodeToPlain(src.map));
      made = copy.id;
      dstRoots.push([buildNodeY(copy)]);
    });
    return made;
  },

  /* ---- boards (Phase 4) ------------------------------------------- */

  /* Add a new board from a starter template. Non-destructive: existing
   * boards are untouched (the old createBoardFromTemplate replaced the
   * whole doc). Returns the new board's id. */
  /* ---- free grid: position, size, picture, yarn ------------------- */

  /* Pin a card at a cell. One value, clamped to the surface, so a card
   * can never be dragged off the board and lost (state/gridBoard.ts).
   * Takes a LIST because a grid drag can carry a selection. */
  setNodeCells(cells: Record<string, Cell>) {
    const ids = Object.keys(cells);
    if (!ids.length) return;
    tx(() => {
      for (const [id, l] of locateMany(ids)) {
        const c = clampCell(cells[id]);
        l.map.set("cell", { x: c.x, y: c.y });
      }
    });
  },

  /* How many cells a card covers. Per CARD on this type alone -- see
   * types.ts `Span` for why that is a deliberate exception rather than a
   * drift away from "size is a tier property". */
  setNodeSpan(id: string, span: Span) {
    tx(() => {
      const n = locate(id);
      if (!n) return;
      const c = clampSpan(span);
      n.map.set("span", { w: c.w, h: c.h });
    });
  },

  /* A grabbed still's KEY. Empty clears it, and only it -- the blob
   * itself is deliberately left in the store, because a key can be
   * shared (a duplicated board's cards point at the same frames) so
   * nothing may delete bytes on the strength of ONE card dropping them.
   * Reclaiming is a mark-and-sweep over every board, which is Phase C's
   * purge and is a button rather than a side effect.
   *
   * The appearance keys go with it for `setNodeImage`'s reason: they
   * describe a picture that is no longer there. */
  setNodeStill(id: string, key: string) {
    tx(() => {
      const n = locate(id);
      if (!n) return;
      if (key) {
        const had = n.map.get("image") || n.map.get("still");
        n.map.set("still", key);
        if (!had) applyPhotoText(n.map);
      } else {
        n.map.delete("still");
        /* ...but only if there is no hand-pinned image still wanting
         * them. `image` wins in the renderer, so a card can hold both. */
        if (!n.map.get("image")) {
          n.map.delete("imageFit");
          n.map.delete("imageTile");
          n.map.delete("imageMirror");
          n.map.delete("imageAlign");
        }
        clearPhotoText(n.map);
      }
    });
  },

  /* The picture on a card, already downscaled by the caller
   * (board/grid/gridImage.ts). Empty clears it -- the key is DELETED
   * rather than set to "", so a card with no picture carries no weight,
   * which for a data URI is the difference between nothing and a stray
   * kilobyte on every card that ever had one. */
  setNodeImage(id: string, dataUri: string) {
    tx(() => {
      const n = locate(id);
      if (!n) return;
      if (dataUri) {
        const had = n.map.get("image") || n.map.get("still");
        n.map.set("image", dataUri);
        /* A PICTURE ARRIVING ON A BARE CARD BRINGS THE TREATMENT WITH
         * IT, as real values rather than as a stylesheet rule that fires
         * behind your back (owner, 2026-09-01). White, shadowed and
         * bottom-set is what a photo caption wants; writing it means the
         * Text overrides panel shows exactly what the card is doing and
         * can change or clear any of it.
         *
         * Only when there was NO picture before -- replacing one must
         * not silently undo choices somebody has since made about the
         * words. */
        if (!had) applyPhotoText(n.map);
      } else {
        /* Removing the image takes its appearance with it -- those keys
         * describe a picture that is no longer there, and leaving them
         * would silently re-apply to whatever is added next. */
        n.map.delete("image");
        /* Unless a grabbed still is underneath and still wants them. */
        if (!n.map.get("still")) {
          n.map.delete("imageFit");
          n.map.delete("imageTile");
          n.map.delete("imageMirror");
          n.map.delete("imageAlign");
        }
        clearPhotoText(n.map);
      }
    });
  },

  /* How the image sits on the card (types.ts Node.imageFit). The DEFAULT
   * is stored as an absence, so a card set back to Fill looks exactly
   * like one nobody ever touched. */
  setNodeImageFit(id: string, fit: "fill" | "fit" | "side") {
    tx(() => {
      const n = locate(id);
      if (!n) return;
      if (fit === "fit" || fit === "side") n.map.set("imageFit", fit);
      else n.map.delete("imageFit");
      /* The sub-settings are NOT cleared with the mode. Each is read only
       * in its own mode, so a stale one draws nothing -- and flipping to
       * Fill and back should hand you your tiling again rather than
       * silently forgetting it. (This op did clear them at first, on the
       * reasoning that a hidden flag springing back is surprising; now
       * that each mode carries its own sub-options, losing them on every
       * round trip is the more surprising of the two.) */
    });
  },

  setNodeImageTile(id: string, on: boolean) {
    tx(() => {
      const n = locate(id);
      if (!n) return;
      if (on) n.map.set("imageTile", true);
      else n.map.delete("imageTile");
    });
  },

  /* Reflect every other tile, so the repeats meet edge-to-edge rather
   * than butting the same edge against itself. Only read while tiling. */
  setNodeImageMirror(id: string, on: boolean) {
    tx(() => {
      const n = locate(id);
      if (!n) return;
      if (on) n.map.set("imageMirror", true);
      else n.map.delete("imageMirror");
    });
  },

  /* THE WHOLE SIT AT ONCE (2026-09-08): what a new picture is stamped
   * with (settings.imageSit). The same delete-on-default rules as the
   * four single-field ops above.
   *
   * PLURAL, the house shape for an op that can act on a selection
   * (setNodeTitleAlign, setNodeValue): "apply this look to every card at
   * the tier" is ONE transaction, so it syncs as one change and one
   * Cmd+Z takes all of it back. */
  setNodeImageSit(
    ids: string[],
    sit: {
      fit: "fill" | "fit" | "side";
      tile: boolean;
      mirror: boolean;
      align: string;
      corner: "tl" | "tr" | "bl" | "br";
      titleAlign?: "" | "top" | "bottom";
    },
  ) {
    tx(() => {
      for (const id of ids) {
      const n = locate(id);
      if (!n) continue;
      // the text position is part of the sit (2026-09-08); "" is centered
      if (sit.titleAlign !== undefined) {
        if (sit.titleAlign) n.map.set("titleAlign", sit.titleAlign);
        else n.map.delete("titleAlign");
      }
      if (sit.fit === "fit" || sit.fit === "side") n.map.set("imageFit", sit.fit);
      else n.map.delete("imageFit");
      n.map.delete("imageCorner"); // retired with Corner mode (types.ts)
      if (sit.tile) n.map.set("imageTile", true);
      else n.map.delete("imageTile");
      if (sit.mirror) n.map.set("imageMirror", true);
      else n.map.delete("imageMirror");
      if (sit.align && sit.align !== "center center") n.map.set("imageAlign", sit.align);
      else n.map.delete("imageAlign");
      }
    });
  },

  setNodeImageAlign(id: string, align: string) {
    tx(() => {
      const n = locate(id);
      if (!n) return;
      if (align && align !== "center center") n.map.set("imageAlign", align);
      else n.map.delete("imageAlign");
    });
  },

  /* String yarn between two cards. Refuses a card to itself and a pair
   * that is already joined -- two strings between the same two cards is
   * a mistake, not a stronger connection, and it would draw as one line
   * anyway. Returns the edge id, or "" if it refused. */
  addEdge(boardId: string, from: string, to: string, color = DEFAULT_YARN): string {
    let made = "";
    tx(() => {
      if (!from || !to || from === to) return;
      const board = boardMapById(boardId);
      if (!board) return;
      const roots = partArr(board, "roots");
      if (!roots) return;
      const ids = new Set(roots.toArray().map((r) => r.get("id") as string));
      if (!ids.has(from) || !ids.has(to)) return; // both ends must be ON this board
      const arr = ensurePart(board, "edges") as YArr;
      if (edgeBetween(arr.toArray().map(edgeToPlain), from, to)) return;
      const edge: Edge = { id: uid("yn"), from, to, color };
      arr.push([buildEdgeY(edge)]);
      made = edge.id;
    });
    return made;
  },

  removeEdge(boardId: string, edgeId: string) {
    tx(() => {
      const board = boardMapById(boardId);
      const arr = board ? partArr(board, "edges") : null;
      if (!arr) return;
      for (let i = 0; i < arr.length; i++) {
        if (arr.get(i).get("id") === edgeId) {
          arr.delete(i, 1);
          return;
        }
      }
    });
  },

  setEdgeWidth(boardId: string, edgeId: string, width: number) {
    tx(() => {
      const board = boardMapById(boardId);
      const arr = board ? partArr(board, "edges") : null;
      if (!arr) return;
      for (let i = 0; i < arr.length; i++) {
        if (arr.get(i).get("id") === edgeId) {
          /* The default is stored as an ABSENCE, so a string set back to
             normal looks exactly like one nobody ever touched. */
          if (width === DEFAULT_YARN_WIDTH) arr.get(i).delete("width");
          else arr.get(i).set("width", width);
          return;
        }
      }
    });
  },

  setEdgeColor(boardId: string, edgeId: string, color: string) {
    tx(() => {
      const board = boardMapById(boardId);
      const arr = board ? partArr(board, "edges") : null;
      if (!arr) return;
      for (let i = 0; i < arr.length; i++) {
        if (arr.get(i).get("id") === edgeId) {
          arr.get(i).set("color", color);
          return;
        }
      }
    });
  },

  /* ---- nested boards --------------------------------------------- */

  /* Point this card at a board (docs/explorations/board-shapes.md,
   * DECISIONS 3). Also the RELINK path -- a card that already points
   * somewhere has no children left to lose, so one op covers both.
   *
   * CONVERTING DELETES THE NODE'S CHILDREN, which is the owner's rule:
   * "if you knew what you were doing, you'd just create a new node for
   * the purpose and it'll be empty already." Moving them into the target
   * instead was considered and NOT taken -- it would have made this the
   * tool for breaking a board apart, which is a different feature with a
   * much worse failure mode. The caller confirms the count first; this
   * runs in ONE tx, so the whole thing is one Cmd-Z.
   *
   * A BOARD THAT POINTS BACK IS FINE; THE HOST BOARD ITSELF IS NOT
   * (owner, 2026-08-24). Cycles are allowed -- a nesting card draws its
   * target's NAME and never its content, so no render recurses and the
   * useful case is a back-link out of a section board to the master map.
   * The doc-side reachability walk that used to refuse those is gone.
   *
   * The ONE refusal left is the host board, and it is not about
   * recursion (nothing would break): a nesting card means GO SOMEWHERE
   * ELSE, and yourself is the only target that isn't somewhere else. The
   * card would wear its own board's name, rename when that board is
   * renamed, and take you where you already are -- the affordance and
   * the outcome disagreeing, with nothing on the card able to say it was
   * deliberate. It is also the case an NLE forbids outright, and the
   * audience's model of a nested sequence is why the feature has that
   * name.
   *
   * The target's title is copied in as a TOMBSTONE (`boardRefTitle`),
   * read only if the board is ever missing. See the field's comment for
   * why the card does not display it. */
  nestNode(nodeId: string, targetBoardId: string): boolean {
    let ok = false;
    tx(() => {
      const n = locate(nodeId);
      const target = boardMapById(targetBoardId);
      if (!n || !target) return;
      if (n.boardId === targetBoardId) return; // see the header
      const children = n.map.get("children");
      if (children instanceof Y.Array && children.length) children.delete(0, children.length);
      /* THE OLD TITLE GOES TOO (owner, 2026-08-26: "when we convert a
       * card to a nested node, it should just be a nested node. we don't
       * need to hold onto what was there (except for undo purposes)").
       *
       * It used to be left written and merely unread, so un-nesting
       * handed the card its old name back. That kept a name nobody could
       * see -- which is the same objection that made a nesting card
       * searchable by the wrong string (state/nesting.ts searchTitle),
       * and it is the children rule applied to the title: a conversion
       * is a conversion. UNDO is the escape hatch and covers it, since
       * this whole op is one `tx`.
       *
       * The cost, accepted: un-nesting now gives a blank card rather than
       * the name it had. */
      n.map.set("title", "");
      n.map.set("boardRef", targetBoardId);
      n.map.set("boardRefTitle", (target.get("title") as string) ?? "");
      ok = true;
    });
    return ok;
  },

  /* Stop standing in for a board. The card comes back BLANK: `nestNode`
   * clears the old title on the way in (owner's call -- a conversion is a
   * conversion), so there is nothing to hand back. Undo is what recovers
   * the original, not this. */
  unnestNode(nodeId: string) {
    tx(() => {
      const n = locate(nodeId);
      if (!n) return;
      n.map.delete("boardRef");
      n.map.delete("boardRefTitle");
    });
  },

  addBoardFromTemplate(t: BoardTemplate): string {
    const { tags, fields, ...built } = t.build();
    /* Every new board starts on the per-tier defaults, whichever
     * template it came from (state/tierDefaults.ts). Here rather than in
     * the templates so the landing's three, the full shelf's eleven and
     * the story scaffolds can't drift apart. */
    const rest = { ...built, levels: withTierDefaults(built.levels) };
    let id = "";
    /* withVocabulary, because a template may ship tag and category
     * definitions its cards reference (the worked examples do). This path
     * used to call addBoardRaw alone, so a template's vocabulary was
     * dropped outright and the repair pass stripped every reference. */
    withVocabulary(tags, fields, () => {
      id = addBoardRaw(rest as Board);
      hoistPaletteNow();
    });
    return id;
  },

  /* Add an imported board file as a NEW board in the project. Content
   * gets fresh node ids so re-importing an export of a board that still
   * exists here can't collide with it (node ids are unique doc-wide).
   * A board file also carries the tag + metadata-category definitions its
   * cards reference (ADR 0002); those merge into the project by id -- an id
   * we already have keeps OUR definition, since the local placement (or
   * label) is what the rest of this project's cards are drawn with / filed
   * under. Without the merge the file's cards would arrive carrying tag ids
   * and value keys that resolve to nothing.
   * Callers MUST sanitize the file first (state/validate.ts). */
  importBoard(b: Board): string {
    const { tags, fields, ...rest } = b;
    const fresh: Board = regenBoardIds({ ...rest, id: uid("bd") });
    let id = "";
    /* withVocabulary -- this is the path where the rule was first learned
     * the hard way. It used to be three separate transactions (board, then
     * tags, then fields = three updates on the wire), and an import
     * silently arrived stripped of its metadata for everyone, including
     * the importer. (Observed 2026-08-01: a board imported cleanly while a
     * second tab was open on the same room, and lost every tag and value.) */
    withVocabulary(tags, fields, () => {
      id = addBoardRaw(fresh);
      hoistPaletteNow(); // a board file's overrides join the project's
    });
    return id;
  },

  /* Add every board of an imported PROJECT file (the whole-project
   * backup) to this project, each with fresh board + node ids -- so
   * loading a backup next to the boards it came from can't collide.
   * Non-destructive, like importBoard: nothing here is replaced, so a
   * restore is a merge you can then prune. Callers MUST sanitize the
   * file first (state/validate.ts). Returns the new board ids. */
  importProject(p: Project): string[] {
    const made: string[] = [];
    withVocabulary(p.tags, p.fields, () => {
      const boards = ensureBoardsArr();
      /* NESTED REFS ARE REMAPPED, and they have to be. Every imported
       * board gets a fresh id (so a backup can land beside the boards it
       * came from without colliding), which would leave every nesting
       * card inside the import pointing at the ORIGINAL id -- i.e. at the
       * boards already here, not at its own fresh copies. That is exactly
       * backwards in the case this op exists for: "a restore is a merge
       * you can prune". Mint the ids first, then rewrite the refs. A ref
       * that points OUT of the file (an id not in `p.boards`) is left
       * alone to dangle -- it may still resolve here, and if it doesn't
       * the card draws its tombstone. */
      const remap = new Map(p.boards.map((b) => [b.id, uid("bd")]));
      const reref = (n: Node): Node => ({
        ...n,
        ...(n.boardRef && remap.has(n.boardRef) ? { boardRef: remap.get(n.boardRef)! } : {}),
        children: n.children.map(reref),
      });
      /* THE FILE'S PALETTE RIDES ON ITS BOARDS. Each imported board's
       * legend gets the file's overrides appended as options, and the
       * hoist below lifts them into this project's palette by the
       * ordinary rules (same id kept, same label remapped, else added)
       * -- one mechanism for a restore and for a board someone made
       * last month. */
      const filePalette = (p.palette ?? []).filter((e) => !e.tier && !e.role);
      for (const b of p.boards) {
        // fresh NODE ids (edges follow), then the cross-board refs remap
        const fresh = regenBoardIds({ ...b, id: remap.get(b.id)! });
        fresh.roots = fresh.roots.map(reref);
        if (filePalette.length) {
          const have = new Set(fresh.legend.map((e) => e.id));
          fresh.legend = [...fresh.legend, ...filePalette.filter((e) => !have.has(e.id))];
        }
        made.push(fresh.id);
        boards.push([buildBoardY(fresh)]);
      }
      hoistPaletteNow();
      /* THE FOLDERS COME WITH IT. The imported boards carry the paths
       * they were filed under, so without this an EMPTY folder in the
       * backup would be lost and -- worse -- a restore would look like
       * it had silently reorganized itself. Merged rather than replaced:
       * a restore is a merge you can prune, so it must not delete a
       * folder that is already here. Same-name is same-folder, so
       * overlapping ones simply coincide. */
      if (p.folders?.length) {
        const arr = ensureFolders();
        const have = new Set(arr.toArray().map((v) => JSON.stringify(cleanFolder(v))));
        for (const raw of p.folders) {
          const f = cleanFolder(raw);
          const k = JSON.stringify(f);
          if (f.length && !have.has(k)) {
            have.add(k);
            arr.push([f]);
          }
        }
      }
      // an untitled project takes the file's name; a named one keeps its own
      if (!(projectMap.get("title") as string | undefined)?.trim() && p.title) {
        projectMap.set("title", p.title);
      }
      // a logo travels with a project file, unless this project has its own
      if (p.mark && !sanitizeMark(projectMap.get("mark"))) projectMap.set("mark", p.mark);
    });
    return made;
  },

  /* Duplicate a board -- the version workflow (spec Sec 5.4): lock a
   * cut, duplicate it, iterate the copy. Deep clone with fresh node ids,
   * inserted right after the original. Returns the copy's id. */
  duplicateBoard(boardId: string): string {
    let copyId = "";
    tx(() => {
      const boards = boardsArr();
      const m = boardMapById(boardId);
      if (!boards || !m) return;
      const plain = boardToPlain(m);
      const copy: Board = regenBoardIds({
        ...plain,
        id: uid("bd"),
        title: plain.title ? plain.title + " copy" : "Untitled copy",
      });
      copyId = copy.id;
      let at = boards.length;
      for (let i = 0; i < boards.length; i++) {
        if (boards.get(i) === m) {
          at = i + 1;
          break;
        }
      }
      boards.insert(at, [buildBoardY(copy)]);
      hoistPaletteNow(); // a copy of a not-yet-hoisted board brings its overrides up
    });
    return copyId;
  },

  /* A FREE GRID FROM A BEAT MAP (owner, 2026-09-11): a NEW board beside
   * the source, laid out by state/gridFrom.ts from the Overview's column
   * tier and detail level. duplicateBoard's shape exactly -- plain, the
   * transform in the middle, fresh ids, inserted after the source, the
   * palette hoisted (the tier colors arrive as option entries, and the
   * hoist is what makes them project colors). Same project, so no
   * withVocabulary: every tag and category id already lives here. */
  convertToGrid(boardId: string, columnDepth: number, detailDepth: number): string {
    let gridId = "";
    tx(() => {
      const boards = boardsArr();
      const m = boardMapById(boardId);
      if (!boards || !m) return;
      const grid = regenBoardIds(gridFromBoard(boardToPlain(m), { columnDepth, detailDepth }));
      gridId = grid.id;
      let at = boards.length;
      for (let i = 0; i < boards.length; i++) {
        if (boards.get(i) === m) {
          at = i + 1;
          break;
        }
      }
      boards.insert(at, [buildBoardY(grid)]);
      hoistPaletteNow();
    });
    return gridId;
  },

  deleteBoard(boardId: string) {
    tx(() => {
      const boards = boardsArr();
      if (!boards) return;
      for (let i = 0; i < boards.length; i++) {
        if (boards.get(i).get("id") === boardId) {
          boards.delete(i, 1);
          return;
        }
      }
    });
  },
};

/* Resolve after local persistence loads. A fresh doc is left empty on
 * purpose: the app shows the template picker when there are no boards,
 * which seeds via ops.addBoardFromTemplate. A pre-Phase-4 doc migrates
 * here (and again after remote sync, via the repair hook). */
export const whenReady: Promise<void> = provider.whenSynced.then(() => {
  migrateLegacyBoard();
  // ...and upgrade this doc's own legacy shapes (notes as a plain string).
  // The repair pass only runs after REMOTE transactions, so without this a
  // solo/offline doc would never be rewritten -- it would render fine
  // (the reader tolerates a string) and quietly stay on the old shape.
  repairDuplicates();
  dirty = true;
});
