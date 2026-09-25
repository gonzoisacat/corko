/* ------------------------------------------------------------------ *
 *  Corko data model -- plain-object snapshot types.
 *
 *  The board is a single recursive tree of Nodes. A node's *tier* is
 *  its depth in the board's `levels` ladder (the template); tier is not
 *  stored on the node. See docs/adr/0001-configurable-tiers.md.
 *
 *  The canonical source of truth lives in a Yjs document (ydoc.ts); a
 *  snapshot is a plain-object projection of that doc, rebuilt on change.
 * ------------------------------------------------------------------ */

/* Which optional fields a tier exposes.
 *
 * Down to `color` in practice: `subtitle` and `tag` were the hardcoded
 * card-face metadata (a section's date, and the "DAY XX" a scene's footer
 * read off its ancestor) and both were removed when display SLOTS landed --
 * anything on a card's face is a metadata category now (ADR 0003). `notes`
 * is vestigial too: every node carries a note list regardless of tier. */
export interface LevelFields {
  color: boolean;
  notes: boolean;
}

/* Visual treatment token for a tier. Maps to a CSS class; the leaf tier
 * always renders as cards regardless of variant. */
export type LevelVariant = "reel" | "section" | "scene";

export interface LevelDef {
  id: string; // stable, e.g. "reel"
  name: string; // display noun, e.g. "Reel" / "Act" / "Episode"
  /* What this tier's DEFAULT COLOR means, shown in parentheses beside its
   * legend swatch and nowhere else: "Scene (Linear)" against a "Scene
   * (Floaters)" override. A tier's name is used all over -- counts, "Add
   * Scene", the graduation menu -- so it can't carry a color's meaning;
   * this can. Blank = just the name. */
  descriptor?: string;
  fields: LevelFields;
  variant: LevelVariant;
  defaultFont?: string; // default title typeface for this tier (id, e.g. "marker")
  aspect?: number; // card width/height (both views); default ~1.45
  height?: number; // anchored card height in px; width = height * aspect
  textSize?: number; // title font size in px (overrides the tier default)
  textColor?: string; // title color hex (overrides the auto-contrast default)
  /* RETIRED 2026-08-14 -- read and written for file compatibility, and
   * ignored by every renderer. `textSize` is the whole story now: a
   * title is set at that TARGET size and auto-shrinks if it cannot fit.
   * Kept in the shape rather than stripped so an older board (or an
   * older build in the same room) round-trips unchanged. */
  expandText?: boolean;
  fullWidth?: boolean; // header tiers (above the scene tier) only: render as a
  // full-width swimlane band instead of an aspect card. Ignored for the leaf
  // (beat) and leaf-parent (scene) tiers, which are always cards.
  /* THE PICTURE'S OWN ROOM (owner, 2026-09-08). A tier can append room
   * beside its cards for the picture to live in, instead of the picture
   * sitting over the words. The TEXT CARD is untouched by this -- it
   * keeps `height` and `aspect`, its padding, its slots and its title
   * rules -- and the room is added to the card's box on the named edge,
   * so a card at a tier with room is wider (or taller) than the same
   * card without.
   *
   * PER TIER rather than per card, and deliberately (his call): the room
   * is what makes a whole row of cards read alike, so a tier where every
   * card carries a frame reserves it once. A card at such a tier with no
   * picture simply leaves the room empty.
   *
   * Absent = no room, which is every board that predates this. The
   * picture then sits on the card face as it always did, by the card's
   * own `imageFit`. */
  imageEdge?: ImageEdge;
  /* HOW BIG THE PICTURE IS, as a multiple of the card's own HEIGHT (his
   * unit, 2026-09-09: "the number represents how many times the card
   * height the image is going to be"). The picture keeps its own aspect,
   * so its WIDTH follows from its shape; the strip beside the card is
   * the same multiple of the card's WIDTH, which keeps the reserve
   * proportional to the card and means nothing has to know a picture's
   * shape in advance. Absent = 1. */
  imageRoom?: number;
  /* AIR BETWEEN THE PICTURE AND THE CARD, in px (owner, 2026-09-09:
   * "whether a padding slider can also be added to optionally separate
   * the picture further from the card by a few px or whatever (like
   * 1-20)"). It EXTENDS the strip rather than eating into it, so the
   * picture keeps its size and every card at the tier still holds the
   * same total space. Absent = 0, flush against the card. */
  imageGap?: number;
  /* Whether the picture CENTERS in its strip instead of snugging up to
   * the card (owner, 2026-09-09: "i am wondering if the image can be
   * centered within the extra space"). It only shows on a picture
   * narrower than its strip, which at a proportional strip means
   * anything squarer than the card -- a 16:9 frame is nearly the strip's
   * full width either way. Absent = snug, which is what he first asked
   * for. */
  imageCenter?: boolean;
  bandHeight?: number; // full-width mode only: the band's height in px.
  // Unset = content-sized (the pre-slider behavior). `height` can't serve
  // here -- it belongs to CARD mode, and toggling fullWidth must not drag
  // a 131px card height onto a 44px band or vice versa.
}

export interface Node {
  id: string;
  title: string;
  collapsed: boolean;
  subtitle?: string;
  tag?: string;
  color?: string; // legend entry id (see colors.ts); only on color-capable tiers
  notes?: Note[]; // any tier (see Note); was a single string before the notes system
  font?: string; // per-card typeface id (e.g. "marker"); default "sans"
  /* PER-CARD TEXT OVERRIDES (owner, 2026-09-01). Each is absent unless
   * somebody set it, and absent means "use the tier's answer" -- so a
   * card nobody has touched carries none of these and looks exactly as
   * it always did.
   *
   * THEY EXIST BECAUSE THE AUTO TREATMENT WAS A HIDDEN RULE. A card with
   * a picture used to get white text and a drop shadow from a CSS rule
   * nothing could see or turn off; the owner's objection was exactly
   * that ("I don't like the white with drop shadow auto treatment being
   * out of my control"). Adding a picture now WRITES these instead, so
   * what the card does is visible in the panel and can be changed or
   * cleared like anything else a person chose. */
  textColor?: string; // hex; overrides the tier's color / auto-contrast
  textSize?: number; // px target for the title fit; overrides the tier's
  textShadow?: boolean; // the drop shadow that makes type survive a photo
  hidden?: boolean; // shared "hide" (Excel-column style); collapses to a peek
  breakAfter?: boolean; // manual row break after this beat (beats wrap only here)
  /* NESTED BOARD (docs/explorations/board-shapes.md, DECISIONS 3): this
   * card stands in for another board. The id of that board -- a
   * REFERENCE, not containment, which is why the same board may be
   * nested in several places and why deleting this card never touches
   * it. The NLE reading the name was chosen for.
   *
   * A nested node CANNOT HAVE CHILDREN. Converting deletes any it had
   * (behind a counted, undoable confirm), and every op that could put a
   * child under one refuses -- see state/nesting.ts `isNested`. That is
   * enforced in the ops layer rather than in the renderers, so no path
   * can write the shape at all.
   *
   * Absent = an ordinary card, which is what makes this safe in a mixed
   * room: a client that predates it sees a card it can rename, move or
   * delete, and nothing corrupts. */
  boardRef?: string;
  /* The target's title as it read WHEN THIS WAS LINKED -- a tombstone,
   * never the display source. The card shows the target board's LIVE
   * title (owner's call), so a ref whose board is gone would otherwise
   * have no name at all and draw blank. This is only ever read in that
   * dead case, so its going stale costs nothing and it lets the card say
   * WHICH board it lost.
   *
   * It is deliberately not a reconnection key. Two boards can share a
   * title, so matching by name would silently point a card at the wrong
   * cut; relinking is a human act (the card menu's "Relink..."). */
  boardRefTitle?: string;
  /* FREE GRID ONLY (Board.type "grid"). Where this card is anchored and
   * how many cells it covers; absent on every other type, and absent on
   * a grid card that has not been placed yet (the renderer parks those
   * in the first free cells). */
  cell?: Cell;
  span?: Span;
  /* A picture on the card, as a data URI -- a DOWNSCALED thumbnail, not
   * the original (board/grid/gridImage.ts). It rides in the doc so it
   * syncs like everything else, which is the whole reason it has to stay
   * small: the doc is persisted whole, in 1.5 MB chunks, so a handful of
   * full-size photos would dwarf a 3,000-card cut. */
  image?: string;
  /* A frame grabbed from a proxy video by the EDL importer -- a KEY into
   * a BlobStore (state/blobStore.ts), never the bytes.
   *
   * DELIBERATELY A SEPARATE FIELD FROM `image`, which is a data URI in
   * the doc. That is fine for a handful of pinned photos and fatal for a
   * shot per event: at ~15 KB a still, 500 shots is 7.5 MB written into
   * a project doc that is 740 KB today, rewritten whole every three
   * seconds, downloaded entire by every joining client, and permanent
   * (an ordinary delete cannot reclaim it -- undo pins the bytes; see
   * docs/explorations/edl-shot-board.md for the measurements).
   *
   * So the doc holds a reference and the bytes live beside it. ONE
   * renderer serves both (board/ImageFrame.tsx), so the card face is not
   * duplicated; only the lifecycle differs, which is the point -- these
   * can be purged, and an `image` cannot.
   *
   * The key is minted at build time and survives `regenBoardIds`, which
   * rewrites node ids but not arbitrary string fields. So a duplicated
   * or imported board's cards keep pointing at the blobs they came with,
   * and nothing needs re-grabbing. */
  still?: string;
  /* HOW that image sits on the card. Absent = "fill", which is what every
   * image did before these existed, so nothing needed migrating.
   *
   *   fill  crop to cover the card -- one dimension is cut off unless the
   *         aspects happen to match. `imageAlign` says WHICH part
   *         survives the crop (an `object-position`, absent = centered),
   *         so a face near an edge need not be the bit cut off.
   *   fit   the whole image, centered, with bars down the sides or along
   *         the top and bottom. `imageTile` fills those bars with the
   *         image repeated, and `imageMirror` reflects every other copy
   *         so the repeats meet edge-to-edge instead of butting.
   *   SIDE  the picture sits BESIDE the words instead of under them, in
   *         the room its tier appends (LevelDef.imageEdge). Contained,
   *         at its own aspect. The mode is the card's -- one card can
   *         take the room while its neighbour keeps a full-bleed photo
   *         -- while the room itself is the TIER's, so every card at
   *         that tier is one box and a row stays true. Replaced Corner
   *         (owner, 2026-09-09).
   *
   * Each key is read only in its own mode, and none is cleared when the
   * mode changes: flipping to Fill and back should give you your tiling
   * again rather than silently forgetting it. */
  imageFit?: "fill" | "fit" | "side";
  imageTile?: boolean;
  imageMirror?: boolean;
  /* RETIRED 2026-09-08, the day it shipped ("corner mode is kind of
   * wack"), replaced by the room a TIER appends (LevelDef.imageEdge).
   * Read and written for file compatibility and ignored by every
   * renderer, the way `expandText` is: a stored `imageFit: "corner"`
   * now reads as Fill, which is what an older build already did with
   * it, and the card's own white-and-shadowed overrides -- written when
   * its picture arrived and merely suppressed while it was a thumbnail
   * -- come back with it. Kept in the shape rather than stripped so a
   * board that still carries one round-trips unchanged. */
  imageCorner?: "tl" | "tr" | "bl" | "br";
  imageAlign?: string;
  /* WHERE THE TITLE SITS ON THE CARD -- an OVERRIDE, not a setting
   * (owner, 2026-09-01). Absent means centered, which is what every card
   * has always done and what almost every card should keep doing; this
   * exists for the one with a face in the middle of its photograph.
   * "top" | "bottom" only, so there is no third spelling of the
   * default. */
  titleAlign?: "top" | "bottom";
  tags?: string[]; // applied TagDef ids (docs/adr/0002-tag-layers.md)
  values?: Record<string, string>; // FieldDef.id -> this card's value (see FieldDef)
  slots?: Partial<Record<SlotId, string>>; // where those values show on the card face
  children: Node[]; // empty at the leaf tier
}

/* A color legend entry: a node's `color` stores this entry's `id`. Both
 * the fill and the meaning (label) are user-editable and shared on the
 * board (synced), like the tier ladder. `border` is derived from `bg`
 * when the user recolors, so cards keep the notecard look. */
export interface LegendEntry {
  id: string;
  label: string;
  bg: string;
  border: string;
  tier?: string; // level id this entry is the default color for; absent = free "option" color
  /* A default bound to something that is NOT a tier. The only one so far
   * is "nested": the fill for a card standing in for another board.
   *
   * Its own field rather than a sentinel in `tier`, and the reason is
   * that `tier` means "the level id this entry defaults for" -- a
   * nesting card is not a level, so the legend's tier gear (which opens
   * that tier's whole look: name, font, height, aspect) has nothing to
   * open. Either way it needs special-casing; this way the data does not
   * lie about what it is.
   *
   * WHY A NESTED CARD GETS ITS OWN DEFAULT AT ALL (owner, 2026-08-24):
   * these cards move freely between tiers, so a color that came from
   * whichever tier they happen to sit at would repaint every time you
   * dropped one. A card you can put anywhere needs a color that does
   * not depend on where it is. */
  role?: "nested";
}

/* A tag: a mark you place on cards to make one more dimension scannable
 * across the whole board (which character is in a scene, what needs
 * licensing, ...). See docs/adr/0002-tag-layers.md.
 *
 * The PLACEMENT lives here rather than per application, so every card
 * carrying a tag draws the same mark in the same spot -- that sameness is
 * what lets your eye find it without reading. Tags are project-level, so
 * a card copied into another board keeps its tags meaning the same thing. */
export interface TagDef {
  id: string;
  name: string;
  color: string; // swatch + tab fill
  pos: number; // 0..1 clockwise around the card's edge from top-centre
  /* Named for what they DO, not for the sliders: `reach` is how far the tab
   * sticks out from the edge (the "Length" control), `span` is how wide it
   * runs along the edge (the "Thickness" control). Both px at detail scale. */
  reach: number;
  span: number;
  offset: number; // px along the outward normal: 0 straddles, + pushes out, - pulls in
  shape: TagShape; // square end, or a ribbon's notched (swallowtail) end
  visible: boolean; // off: no tab drawn, but still applied + highlightable
  /* HOW the tag shows. "tab" is the placed sticky-tab of ADR 0002 and
   * uses every field above. "split" ignores all of them (pos / reach /
   * span / offset / shape) and instead takes a vertical share of the
   * card's own fill -- see docs/adr/0005-split-tags.md. Absent = "tab",
   * so every board that predates this reads unchanged. */
  kind?: TagKind;
}

/* A tag either sits ON the card as a mark, or divides the card's color.
 * The two are different recognition channels and that is the whole reason
 * both exist: a MARK is found by where it is (which is why a tab's
 * placement is project-wide and identical on every card), a REGION is
 * found by its hue (which is why a split needs no placement at all). */
export type TagKind = "tab" | "split";

/* The tab's outer end. "ribbon" cuts a shallow V into it -- the bookmark
 * tail you see hanging off a book icon. A string rather than a boolean so
 * other ends (pointed, rounded) can join without a migration. */
export type TagShape = "flat" | "ribbon";

/* A note on a card: prose ABOUT the cut, addressed to a person.
 *
 * That's what separates it from a metadata value (see FieldDef) and is why
 * it doesn't share a panel with them: a note has an author, gets read,
 * gets answered, and eventually gets resolved -- it has a lifecycle, and
 * a timecode doesn't.
 *
 * `replies` is that answer: the receiver responds with context instead of
 * writing a second, unattached note. One level deep on purpose -- a note
 * and the responses to it is a conversation; a tree of responses to
 * responses is a forum, and nothing here needs one.
 *
 * `state` is deliberately not a delete. Resolving a note keeps it: the
 * record of what was asked and answered is the point, and deleting is a
 * separate, explicit act. */
export interface Note {
  id: string;
  body: string;
  author: string; // free text; defaults from the local `noteAuthor` setting
  state: NoteState;
  createdAt: number; // ms epoch, for ordering a cut's notes by when they landed
  /* THE IMPLEMENTATION NOTE (2026-09-06): what became of this note, in
   * the implementer's words -- the "implementation notes" column of the
   * owner's spreadsheet. ONE per note, beside the state, so a row has
   * exactly one answer to scan; the reply thread is for the back and
   * forth about it. Absent or "" is unanswered. Never on a reply.
   *
   * WHO WROTE IT AND WHEN (owner, 2026-09-07: "the first 'implementation
   * note' also needs an author. every response is pretty much the same
   * format/pattern beyond the initial parent note"). Stamped on every
   * commit of the field with the writer's name and the time, so the
   * answer reads like a reply -- a name above the words -- and dropped
   * with the words. Optional, absent-reads-as-today: an ordinary deploy,
   * not a coordinated reload. Only meaningful beside `impl`. */
  impl?: string;
  implBy?: string;
  implAt?: number;
  replies?: Note[];
}

/* Six states, the owner's spreadsheet legend (state/noteStates.ts holds
 * the table and the open/closed split). "resolved", the old second
 * state, reads as "done" forever. */
export type NoteState = "open" | "done" | "caveat" | "declined" | "later" | "discuss" | "other";

/* A metadata category: a project-level VALUE slot on a card -- starting
 * timecode, duration, shoot day, whatever this cut needs (spec Sec 7
 * "scalar layers").
 *
 * The split from tags is the point (ADR 0002's closing note): a tag is a
 * MEMBERSHIP drawn from a vocabulary, so it draws a mark you scan the board
 * for; a field is a VALUE, one per card, so it has nothing to scan for and
 * would mint one tag per shoot day if you tried. Tags handle membership;
 * fields handle values.
 *
 * The DEFINITION is project-level (defined once, appears on every card's
 * metadata popup with a blank value); the value lives on the node in
 * `Node.values`, and WHERE it shows on the card face in `Node.slots`.
 * Free text for now -- typed values (frames, timecode arithmetic) come
 * later. */
export interface FieldDef {
  id: string;
  name: string; // the label, e.g. "Timecode in" / "Shoot day"
  /* Draw the label alongside the value in its slot ("Shoot day: DAY 06")
   * rather than the value alone. Per category, because it depends entirely
   * on the category: a timecode reads fine bare, a bare "2" does not. */
  showLabel?: boolean;
}

/* Where a category's value shows on a card's face.
 *
 * Six places, no more: a full-width band top and bottom (the header and
 * footer -- the footer is where the old hardcoded "DAY XX" lived), and the
 * four corners. A slot holds ONE category, so the six are the whole budget
 * for a card and the layout can't turn into a soup.
 *
 * Placement is PER CARD (`Node.slots`), so a card only carries a layout
 * once you've given it one; the panel's "apply to..." button is how one
 * card's layout is pushed onto its neighbours at the same tier. */
export type SlotId = "header" | "footer" | "tl" | "tr" | "bl" | "br";

/* Which side of a card its tier hangs the picture on (LevelDef.imageEdge).
 * LEFT OR RIGHT ONLY, his scope 2026-09-09: "top/down seems like a bad
 * choice to offer in most cases, really anyway... or we could like add
 * it later". Above and below are a straight symmetry away if he wants
 * them, measured against the card's width instead of its height. */
export type ImageEdge = "left" | "right";
/* How much room, as a multiple of the text card's size along that edge:
 * 1 gives the picture a box the size of the card, which at the default
 * aspect is about a video frame, and is the default. The CEILING is low
 * on purpose (owner, 2026-09-09: "shouldn't be able to be too much
 * bigger. like. 1.2x or something") -- it is what bounds how far a
 * roomed tier's cards can diverge from every other tier's. The floor is
 * a sliver rather than nothing, because "no room" is said by clearing
 * the edge, not by winding the size to zero. */
export const MAX_IMAGE_GAP = 20;
/* THE GAMMA KNOB's travel (Board.gamma). Wider than this and a card
 * reads as a mistake rather than an adjustment. 1 is off. */
export const MIN_GAMMA = 0.5;
export const MAX_GAMMA = 2.5;
export const MIN_IMAGE_ROOM = 0.4;
export const MAX_IMAGE_ROOM = 1.2;
export const DEFAULT_IMAGE_ROOM = 1;

/* Reading order, which is also the order the panel's preview lays them out:
 * a row of three across the top, a row of three across the bottom.
 * ydoc/validate only use this as a membership set, so the order is the
 * panel's to choose. */
export const SLOT_IDS: SlotId[] = ["tl", "header", "tr", "bl", "footer", "br"];

/* The ids stay "header"/"footer" -- they're persisted in `Node.slots` and
 * renaming them would strand every placement in every saved file. The
 * LABELS say what those two now are: a center third of each row, not the
 * full-width bands they started as. */
export const SLOT_LABELS: Record<SlotId, string> = {
  header: "Top center",
  footer: "Bottom center",
  tl: "Top left",
  tr: "Top right",
  bl: "Bottom left",
  br: "Bottom right",
};

/* Slider ranges for a tag tab (UI + sanitizer clamp). */
export const TAG_REACH = { min: 3, max: 40, default: 12 }; // "Length": out from the edge
export const TAG_SPAN = { min: 8, max: 90, default: 26 }; // "Thickness": along the edge
export const TAG_OFFSET = { min: -24, max: 24, default: 0 }; // in/out along the normal

/* Shared per-board layout settings: these change how the board's
 * structure READS, so every collaborator sees the same one (unlike the
 * per-user look prefs in state/settings.ts). Absent = the defaults. */
export const DEFAULT_MAX_ROW_BEATS = 8;
export const DEFAULT_CARD_SPACING = 15;

/* WHAT SHAPE A BOARD IS (2026-08-15; docs/explorations/board-shapes.md's
 * DECISIONS section is the record).
 *
 * A type is WHOLE AND FIRM -- you do not get a kanban board inside a cut
 * board's tiers. It owns its own renderer and nothing else changes: the
 * data model underneath every type is the same recursive Node tree over
 * the same ladder (ADR 0001), which is exactly why a second shape costs
 * a renderer and no migration.
 *
 * "cut" is the beat board this app started as -- lanes stacking down the
 * page, the leaf tier running across in a strip. "kanban" is that same
 * renderer TRANSPOSED: the lanes stand side by side as columns and their
 * cards stack downward. Board > Column > Card is a two-rung ladder the
 * model already expresses, roots being the columns.
 *
 * ABSENT = "cut", which is what makes this safe in a mixed room: a
 * client that predates this reads a kanban board as an ordinary stacked
 * board. Wrong-looking, completely undamaging -- same nodes, same ops,
 * every edit still valid. (The pinboard/grid type will NOT have that
 * property, because positions are a second thing an old client can
 * invalidate; that one needs a coordinated reload.) */
export type BoardType = "cut" | "kanban" | "grid";

export type BoardBgKind = "default" | "slate" | "cork" | "custom";
export interface BoardLook {
  bg: BoardBgKind;
  custom?: string; // the flat color when bg is "custom"
  grain?: boolean; // the cork's roughness map over a custom color
  /* `corkTint` (a dye over the cork photo) lived here for one day,
   * 2026-09-05, and was cut by the owner as redundant with grain; a doc
   * that carries one is read as undyed. */
}

/* WHERE A CARD SITS ON A FREE GRID, in GRID CELLS (never pixels), so the
 * position survives zoom, a different screen and a font change -- and so
 * two peers moving one card resolve to a cell rather than to a smear.
 *
 * One value rather than two keys on purpose: under merge, last write
 * wins on the WHOLE position, which is what you want. Separate `x`/`y`
 * could take x from one peer and y from another and land the card
 * somewhere neither person chose. */
export interface Cell {
  x: number;
  y: number;
}

/* How many cells a card covers. Per CARD, which is a deliberate
 * exception to this project's "size is a TIER property" rule and belongs
 * to the grid type alone: a conspiracy board is made of things at
 * different sizes -- a big photo, a scrap of paper -- and on a lattice
 * that is expressible without free-form resizing, because a span is
 * whole cells. */
export interface Span {
  w: number;
  h: number;
}

/* A length of yarn between two cards' pins (docs/explorations/
 * board-shapes.md, DECISIONS 5b). The model's FIRST non-tree
 * relationship, which is why it is not a Node: it rides no tier ladder,
 * has no children, and belongs to the BOARD rather than to either end.
 *
 * Endpoints are node ids. An edge whose endpoint is gone is dropped by
 * the repair pass, the rule `repairNodeVocab` already applies to tag ids
 * and value keys -- and safe here for the reason it is NOT safe for a
 * nested board's ref: an edge is cheap to redraw and means nothing on
 * its own, where a dangling ref is a link somebody made on purpose. */
export interface Edge {
  id: string;
  from: string; // node id
  to: string; // node id
  color: string; // hex; yarn is chosen per string
  /* Stroke width in px at zoom 1, PER STRING like the color -- a thick
   * red line and a thin grey one say different things on a board whose
   * whole point is connections. One of YARN_WIDTHS (state/gridBoard.ts);
   * ABSENT means the default, so nothing existing had to be migrated and
   * an older bundle simply draws every string at its own default. */
  width?: number;
}

/* One version of the cut (spec Sec 6). A project holds many boards; each
 * board owns its own ladder + legend so versions can diverge. */
export interface Board {
  id: string;
  title: string;
  type?: BoardType; // absent = "cut" (see BoardType)
  levels: LevelDef[]; // ordered top -> bottom (the ladder / template)
  legend: LegendEntry[]; // color legend (fills + meanings), shared/synced
  roots: Node[]; // top-tier nodes
  /* WHICH FOLDER THIS BOARD IS FILED UNDER, as the LIST OF NAMES that
   * leads to it: ["Interviews / B-roll", "Reels"].
   *
   * A LIST RATHER THAN A JOINED PATH, and that is the owner's call
   * (2026-08-30). A "/" separator would have been shorter, but film
   * people write "Interviews/B-roll" far more readily than they write
   * code-like paths, so the slash has to be an ordinary character. With
   * no separator there is no forbidden character at all, nothing typed
   * gets silently mangled, and an export stays readable. A folder IS a
   * list of names; the joined string was only ever an encoding of that.
   *
   * Nesting is therefore a GESTURE, not a syntax -- you drag a folder
   * onto a folder, the same way you drag a board into one. Nobody has
   * to know a punctuation rule to make a subfolder.
   *
   * All the cheap arithmetic survives: "is A inside B" is an array
   * prefix, and re-parenting is a prefix swap. Absent = filed nowhere,
   * which is where every board starts. */
  folder?: string[];
  /* THE BOARD'S OWN BACKDROP (owner, 2026-09-05: "the corkboard color is
   * actually a great way to distinguish boards from each other at a
   * glance, but it means making the cork background board-defined and
   * not user-defined"). Shared, so everyone sees the blue-gray board as
   * the blue-gray board. Absent = none chosen yet, and the board wears
   * the app's DEFAULT (cork) -- never the viewer's own, since "defaults
   * are still settings" (owner, 2026-09-10) and a person's backdrop
   * appears only behind their own switch. state/boardLook.ts resolves;
   * `overrideBackdrop` in settings is that switch.
   * A plain value, like `mark`: small, and set as one piece. */
  look?: BoardLook;
  /* A GAMMA CURVE OVER THIS BOARD'S PICTURES (owner, 2026-09-10: "I want
   * it per board not per user"). SHARED, like the backdrop above it and
   * for the same reason: if this board's frame grabs came off a dark
   * proxy they are dark for everybody, so one person lifting them lifts
   * them for the team rather than each person finding the knob.
   *
   * Nothing is re-encoded -- it is a filter at render, so the stored
   * bytes are untouched and turning it back to 1 restores exactly what
   * was imported. Absent reads as 1, which is off, so an older build
   * simply shows the pictures as they are. */
  gamma?: number;
  maxRowBeats?: number; // auto-wrap a beat strip after this many (1-10)
  cardSpacing?: number; // px between beat cards (8-20)
  /* Only on an EXPORTED board file: the tag + field definitions its cards
   * reference, so the file can be loaded into a project that doesn't have
   * them (ADR 0002). Both live on the Project in the doc, never here --
   * without them a loaded board arrives with tag ids and value keys
   * pointing at nothing. */
  tags?: TagDef[];
  fields?: FieldDef[];
  /* FREE GRID ONLY: the yarn strung between this board's cards. Lives on
   * the board rather than the project because both endpoints do. */
  edges?: Edge[];
}

/* The whole doc: one project per Yjs doc (spec Sec 6) -- all versions of
 * one film live together, so duplication and compare are local ops and a
 * collaborator joining the project has every version. */
/* THE MARK'S DESIGN (state/mark.ts): the logo in the corner as a 6x6
 * grid of pins somebody rearranged. Six rows of `#`/`.`, a board color,
 * a default pin color, per-pin colors keyed "x,y". */
export interface MarkDesign {
  /* the grid's side, 5..8 (default 6, the C's) -- rows and columns alike */
  size?: number;
  cells: string[];
  board: string;
  pin: string;
  pins?: Record<string, string>;
}
export interface MarkState {
  /* the logo IS this, always -- every click still plays a routine and
   * lands back here */
  override?: MarkDesign;
  /* arrangements the click may land on, beside the built-in looks */
  pool?: MarkDesign[];
}

export interface Project {
  title: string;
  boards: Board[];
  /* optional, absent in every doc before the pinboard designer */
  mark?: MarkState;
  tags: TagDef[]; // project-wide tag vocabulary (ADR 0002)
  fields: FieldDef[]; // project-wide metadata categories (see FieldDef)
  /* THE PROJECT'S COLOR OVERRIDES (ADR 0006): every free "option" color
   * -- "B-roll / visual", "Needs review" -- lives here, once, for every
   * board, exactly as tags do. A board's own `legend` holds only what is
   * bound to that board: its tier defaults and the nesting fill. The
   * snapshot APPENDS this list to every board's `legend`, so a card's
   * `color` resolves on whichever board it is copied to and no consumer
   * has to know the two live apart. Absent in every doc older than the
   * ADR; the repair pass hoists a board's option entries up here the
   * first time a new build reads it (state/palette.ts). */
  palette?: LegendEntry[];
  /* WHICH WAY A SPLIT TAG CUTS THE CARD (ADR 0005). Project-level and
   * synced, for the same reason a tag's placement is: it is the
   * vocabulary that decides the look, so every card reads the same way
   * for everyone. One axis for ALL splits -- mixing them per tag would
   * make a card with two splits unreadable. Absent = "vertical". */
  splitAxis?: SplitAxis;
  /* EVERY FOLDER THAT EXISTS, each as its list of names.
   *
   * Boards name the folder they are in, so most folders need no entry
   * here -- this list is what makes an EMPTY one real (owner,
   * 2026-08-30: "make the folder visible if one is created regardless
   * of if it's empty"). It started as a local draft in one browser and
   * that was the wrong call: a folder somebody makes is structure, and
   * structure is shared. Templates for projects will want it too.
   *
   * Only DECLARED folders are stored -- ["A", "B"] does not imply an
   * entry for ["A"], which is filled in at display time. Ancestors are
   * arithmetic, not data.
   *
   * The display list is the UNION of this and every folder a board
   * names, so a board filed somewhere unlisted still shows where it
   * says it is. Duplicates are removed on read, since two peers making
   * the same folder is an ordinary merge rather than a conflict. */
  folders?: string[][];
}

/* Vertical cuts down the card, horizontal across it, diagonal from the
 * lower left to the top right (so the fill is the top-left corner and
 * the splits run toward the bottom right, keeping the same first-to-last
 * reading order the other two have). */
export type SplitAxis = "vertical" | "horizontal" | "diagonal";

/* Scalar fields that can be edited inline on a node. Notes are NOT one of
 * these any more (a list of Note objects with their own ops), and neither
 * are subtitle/tag (retired with the hardcoded card face). */
export type NodeField = "title" | "color" | "font";
