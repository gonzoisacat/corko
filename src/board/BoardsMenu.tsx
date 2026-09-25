import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TypeIcon } from "./typeIcons";
import { styleOf } from "../state/boardStyles";
import { scoped } from "../state/project";
import {
  Check,
  ChevronDown,
  Folder,
  Clock,
  Copy,
  Download,
  FolderPlus,
  Package,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { ops, useProject } from "../state/useBoard";
import { setSetting, useSettings, type SortDir } from "../state/settings";
import { boardLabel, shelfRows, folderContents } from "./boardSort";
import { sanitizeBoard, sanitizeProject } from "../state/validate";
import { leafDescendants } from "../state/counts";

/* THE DRAG IMAGE FOR A SHELF ROW, drawn explicitly rather than left to
 * the browser (owner-reported 2026-08-31: dragging a folder previewed
 * two or three rows, with the content of the rows BELOW it in the
 * picture).
 *
 * The default drag image is a snapshot of the element and its subtree,
 * and a shelf row's subtree reaches further than the row does: every
 * `[data-tip]` in it owns an absolutely positioned `::after` sitting
 * BELOW the control -- 300px wide and ~27px tall, which took a folder
 * heading's scrollHeight from 30 to 68 on its own. A board row carries
 * five of them, one per tool button.
 *
 * Rather than chase which of those Chromium folds into the snapshot,
 * this hands it a wrapper sized to the row with `overflow: hidden`, so
 * anything reaching past the row is CLIPPED by construction -- whatever
 * the reason for it. The tips are stripped from the clone as well, so
 * the picture is only ever the row.
 *
 * The discipline is `liftDragImage`'s (drag.ts) and so are its two
 * traps: the wrapper must be alive at capture time and is dropped a tick
 * later, and it is parked INSIDE `.app` rather than on body, because
 * only there does it inherit the fonts and variables that make it look
 * like the row it is a picture of. It also needs an explicit background:
 * a row is transparent and takes its color from the panel behind it,
 * which the clone does not come with. */
function shelfDragImage(e: { dataTransfer: DataTransfer }, el: HTMLElement, count = 1) {
  const r = el.getBoundingClientRect();
  const panel = el.closest(".options-panel");
  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    position: "fixed",
    top: "-10000px",
    left: "0",
    width: `${r.width}px`,
    height: `${r.height}px`,
    overflow: "hidden",
    borderRadius: "6px",
    background: panel ? getComputedStyle(panel).backgroundColor : "#fff",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);
  const clone = el.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-tip");
  clone.querySelectorAll("[data-tip]").forEach((n) => n.removeAttribute("data-tip"));
  Object.assign(clone.style, {
    width: `${r.width}px`,
    height: `${r.height}px`,
    margin: "0",
    opacity: "1",
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(clone);
  /* A multi-drag says HOW MANY, because the picture can only ever be one
   * row and a stack of nine looks exactly like a stack of two. */
  if (count > 1) {
    const badge = document.createElement("span");
    badge.className = "shelf-drag-count mono";
    badge.textContent = String(count);
    wrap.appendChild(badge);
  }
  (el.closest(".app") ?? document.body).appendChild(wrap);
  /* Held near the left edge at the row's middle, so the picture sits
   * under the pointer the way the row sat under it. */
  e.dataTransfer.setDragImage(wrap, 16, r.height / 2);
  window.setTimeout(() => wrap.remove(), 0);
}

/* Rolled-up folders, per browser. */
/* Our own dataTransfer type, so the shelf's drag is invisible to every
 * other drop target in the app -- and so this one refuses cards and
 * files rather than accepting whatever arrives. */
const BOARD_DRAG = "application/x-corko-board";
/* Dragging a FOLDER onto a folder is how nesting is made, now that no
 * character means "inside" (owner, 2026-08-30). Its own type, so a
 * folder cannot be dropped where a board goes or the other way round.
 * The value is the folderKey, which is in-memory only. */
const FOLDER_DRAG = "application/x-corko-folder";
/* Folders you have OPENED, by key (owner, 2026-09-04: "all collapsed by
 * default to start. they can remain in last state after that"). It used
 * to store the shut ones, which made open the default; the old key is
 * simply no longer read. Per browser, per project. */
const FOLDERS_OPEN = scoped("corko-folders-open"); // folder paths collide by name across projects

import type { Board, FieldDef, Project, TagDef } from "../state/types";
import { DraftInput } from "../ui/DraftInput";
import { collectVocab } from "./boardVocab";
import { nestUses } from "../state/nesting";
import { templatePicker } from "./TemplatePicker";
import { confirmDialog } from "../ui/confirmDialog";
import { storedStills } from "./stills";
import { boardOnlyStills, formatBytes } from "../state/stillPurge";
import { storedKey } from "../state/access";

/* ------------------------------------------------------------------ *
 *  The Boards menu (Phase 4): the project's version shelf. A topbar
 *  dropdown listing every board -- click to switch, plus per-board
 *  rename / duplicate / export and delete, and the two ways boards
 *  enter the project: "New board..." (template picker) and "Load
 *  board..." (import a .corko.json as a NEW board). Board files are
 *  the durable backup layer, so export/import lives here rather than
 *  buried in Options.
 * ------------------------------------------------------------------ */

function downloadJson(data: unknown, name: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const slug = (s: string, fallback: string) =>
  (s || fallback).replace(/[^\w-]+/g, "-").toLowerCase();

/* A board file carries the tag definitions AND metadata categories its
 * cards actually use, so it can be loaded into a project that has never
 * seen them (ADR 0002). Without them the file's cards would arrive with tag
 * ids and value keys resolving to nothing -- invisible weight the repair
 * pass then strips.
 *
 * "Use" is collectVocab's definition, on purpose: it counts a category
 * placed in a display SLOT even when no value is filled in yet. This
 * payload used to walk tags + values itself and missed exactly that case,
 * so a layout-only placement exported without its definition and the
 * receiving project's repair pass deleted the placement on arrival. One
 * shared walk means the legend's notion of "this board uses it" and the
 * file's cannot drift apart again. */
export function boardFilePayload(board: Board, tags: TagDef[], fields: FieldDef[]): Board {
  const used = collectVocab(board);
  return {
    ...board,
    /* the board's own defaults, plus only the project overrides its cards
       wear (ADR 0006) -- the projected legend carries the whole palette,
       and a file of one board should not ship the project's every color */
    legend: board.legend.filter((e) => e.tier || e.role || used.colorIds.has(e.id)),
    tags: tags.filter((t) => used.tagIds.has(t.id)),
    fields: fields.filter((f) => used.fieldIds.has(f.id)),
  };
}

export function exportBoardFile(board: Board, tags: TagDef[], fields: FieldDef[]) {
  const file = boardFilePayload(board, tags, fields);
  downloadJson(file, `${slug(board.title, "corko-board")}.corko.json`);
}

/* The whole project in one file -- every board, the durable backup.
 * Loads back through "Load project..." (which ADDS the boards). */
export function exportProjectFile(project: Project) {
  downloadJson(project, `${slug(project.title, "corko-project")}.corko-project.json`);
}

/* Ascending/descending as ONE control in two states.
 *
 * lucide ships ArrowUpDown but not a variant with one arm emphasised, so
 * it is composed here exactly the way lucide composes its own modifier
 * glyphs -- and the way CornerDownLeftOff is composed in CardsLane.tsx:
 * the stock paths, with the inactive arm dropped to 0.35 opacity. Keeping
 * both arms drawn is the point. A control that swapped to a different
 * symbol per state would read as two different buttons, whereas a dimmed
 * arm reads as "this way, not that way". */
function SortDirIcon({ dir, size = 13 }: { dir: SortDir; size?: number }) {
  const up = dir === "asc";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g opacity={up ? 1 : 0.35}>
        <path d="m3 8 4-4 4 4" />
        <path d="M7 4v16" />
      </g>
      <g opacity={up ? 0.35 : 1}>
        <path d="m21 16-4 4-4-4" />
        <path d="M17 20V4" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 *  THE SHELF ITSELF, and it has TWO HOSTS (2026-09-10): the pane bar's
 *  dropdown (BoardsMenu, below) and the OPEN BOARD DOOR that boots after
 *  time away (board/OpenBoardDoor.tsx). One component, so what you can
 *  do to a board never depends on which door you came through --
 *  duplicate, file, rename, delete, export, load, new folder, all of it,
 *  in both. The alternative was a second, thinner list for the door, and
 *  the two would have drifted the way every pair in this codebase has.
 *
 *  MOUNTING IT IS OPENING IT. Everything transient here -- the
 *  selection, a rename in flight, a new-folder draft -- used to be reset
 *  by an effect watching a closed flag; now it simply unmounts. Only
 *  which folders are rolled up outlives that, and it lives in
 *  localStorage because it is about you rather than about this opening.
 *
 *  `onClose` is what each host means by closing: the dropdown shuts, the
 *  door lets you through to the board behind it. The shelf never assumes
 *  which. It DOES own Escape, because the first Escape inside a rename
 *  field belongs to that field -- a rule about this shelf's own inputs,
 *  which no host can state for it. Dismissal by clicking elsewhere is
 *  the host's: the dropdown counts its own trigger button as inside, and
 *  the door has a scrim.
 * ------------------------------------------------------------------ */
export function BoardShelf({
  activeBoardId,
  onSelect,
  onClose,
  heading = "Boards",
}: {
  activeBoardId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  /* The one thing the two hosts say differently: the dropdown is the
   * project's Boards, the door is asking you to Open one. */
  heading?: string;
}) {
  const project = useProject();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const active = project.boards.find((b) => b.id === activeBoardId) ?? project.boards[0] ?? null;
  /* Both keys are GLOBAL, so an empty boardId reads (and writes) the
   * defaults layer directly -- which is what "about you, not about a
   * board" means in settings.ts. */
  const { boardSort, boardSortDir } = useSettings();
  /* SELECTED BOARDS -- the shelf's own selection (owner, 2026-09-01).
   *
   * Deliberately NOT board/selection.ts, which is about CARDS: that
   * store enforces a single tier because drag, range and stack need it,
   * and a board has no tier. This is a plain set of board ids, local to
   * the menu and thrown away when it closes -- it exists to point at
   * boards for one gesture, not to be a mode you can leave running.
   *
   * `anchor` is where a Shift range measures from, held apart from the
   * set for the reason keyNav holds its own cursor apart: extending a
   * range must not move the point it extends from. */
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);

  /* Which folder a dragged board is hovering, for the highlight. The
   * board id itself rides the dataTransfer rather than a store: this
   * drag is entirely local to the shelf, and touching `dragStore` would
   * put a board into the CARD drag system, whose zones would then start
   * answering for it. */
  const [overFolder, setOverFolder] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /* Which folders are rolled up. Per BROWSER, like fold.ts and
   * seenBoards.ts: how you like a shelf rolled up is about you at this
   * keyboard, not about the project. A folder that stops existing simply
   * stops being looked up -- there is nothing to prune, because the set
   * is keyed by a name nobody can collide with meaningfully. */
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(FOLDERS_OPEN);
      const arr = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(arr)) return new Set(arr.filter((v): v is string => typeof v === "string"));
    } catch {
      /* unavailable storage: everything reads as shut, which is the default */
    }
    return new Set();
  });
  // the shelf asks "is it shut?"; the answer is "not opened"
  const shut = useMemo(() => ({ has: (k: string) => !openFolders.has(k) }), [openFolders]);
  const rows = useMemo(
    () => shelfRows(project.boards, boardSort, boardSortDir, project.folders ?? [], shut),
    [project.boards, project.folders, boardSort, boardSortDir, shut],
  );
  /* THE HIGHLIGHTED FOLDER (owner, 2026-09-04, "more like a macOS click
   * flow"): a single click picks a folder and nothing else; a double
   * click, or a click on its chevron, opens or shuts it. Rename is the
   * pencil's. Picking a board lets the folder go. */
  const [pickedFolder, setPickedFolder] = useState<string | null>(null);
  useEffect(() => {
    if (sel.size) setPickedFolder(null);
  }, [sel]);
  /* The visible order of boards, which is what a Shift range spans --
   * what you see between two clicks, folders and all, rather than
   * document order. */
  const boardOrder = useMemo(
    () => rows.flatMap((r) => (r.kind === "board" ? [r.board.id] : [])),
    [rows],
  );
  /* Click SELECTS; double-click opens. Plain click replaces, Cmd/Ctrl
   * toggles one, Shift spans from the anchor -- the selection idiom
   * everything else uses, so there is nothing new to learn here. */
  const clickBoard = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }, id: string) => {
    if (e.metaKey || e.ctrlKey) {
      setSel((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      });
      setAnchorId(id);
      return;
    }
    if (e.shiftKey && anchorId) {
      const a = boardOrder.indexOf(anchorId);
      const b = boardOrder.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSel(new Set(boardOrder.slice(lo, hi + 1)));
        /* The anchor STAYS, so a second Shift-click re-measures from the
         * same place rather than growing from wherever you last landed. */
        return;
      }
    }
    setSel(new Set([id]));
    setAnchorId(id);
  };

  /* What a drag carries: the whole selection when the row you grabbed is
   * part of it, otherwise just that row -- and grabbing outside the
   * selection TAKES it, the same rule right-clicking a card follows, so
   * the thing you are dragging is always the thing that is lit. */
  const dragIds = (id: string): string[] => {
    if (sel.has(id) && sel.size > 1) return boardOrder.filter((x) => sel.has(x));
    setSel(new Set([id]));
    setAnchorId(id);
    return [id];
  };

  const toggleFolder = (f: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (!next.delete(f)) next.add(f);
      try {
        localStorage.setItem(FOLDERS_OPEN, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  /* Which row has its "file this board" chooser open. One at a time, and
   * it borrows the inline shape the rename already uses rather than
   * opening a second dropdown inside a dropdown. */
  /* A folder is renamed in place by DOUBLE-CLICKING its heading, which
   * is the same gesture that opens a card title everywhere else -- so it
   * needs no control of its own on a row that is already a button.
   * Committing an EMPTY name unfiles everything in it, which is how a
   * folder is deleted: there is no folder object to remove, only boards
   * that stop naming one. */
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  /* A RENAME THAT LOSES ITS ROW ENDS (owner-reported 2026-09-05: "got me
   * into a text entry mode for the name of a folder and wouldn't leave
   * it. even if i collapsed the parent folder, when i expanded it again
   * it was still in that state"). The field leaves on blur, but a row
   * that UNMOUNTS -- its parent folder shut, the menu closed -- never
   * blurs, so the state outlived the field and re-armed it on the next
   * sight. So: a rename or a new-folder draft ends whenever its row is
   * not on the shelf, and everything transient ends when the menu
   * closes. */
  useEffect(() => {
    if (renamingFolder && !rows.some((r) => r.kind === "folder" && r.key === renamingFolder)) setRenamingFolder(null);
    if (renamingId && !rows.some((r) => r.kind === "board" && r.board.id === renamingId)) setRenamingId(null);
  }, [rows, renamingFolder, renamingId]);
  /* The arrow alone can't say what it is ordering, and "ascending" means
   * two quite different things here -- so the tooltip names the current
   * order AND what the click will do. */
  const dirWords: Record<SortDir, string> =
    boardSort === "alpha"
      ? { asc: "A to Z", desc: "Z to A" }
      : { asc: "Oldest first", desc: "Newest first" };
  const otherDir: SortDir = boardSortDir === "asc" ? "desc" : "asc";

  /* Escape in a rename or new-folder field is THAT field's (it reverts
     and blurs, which ends the edit); only a second Escape, or one from
     anywhere else, closes the shelf. Clicking elsewhere is the host's
     to answer -- see the header. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement && ref.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onLoadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    file
      .text()
      .then((txt) => {
        // deep-validate/normalize BEFORE any doc write (state/validate.ts)
        const b = sanitizeBoard(JSON.parse(txt));
        if (!b) throw new Error("bad");
        const id = ops.importBoard(b); // ADDS a board; replaces nothing
        onSelect(id);
        onClose();
      })
      .catch(() => confirmDialog.tell("That doesn't look like a Corko board file."));
  };


  /* A project file carries every board; loading one ADDS them all (fresh
   * ids), so restoring a backup never overwrites what's open. */
  const onLoadProjectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    file
      .text()
      .then((txt) => {
        const p = sanitizeProject(JSON.parse(txt));
        if (!p) throw new Error("bad");
        const ids = ops.importProject(p);
        if (ids.length) onSelect(ids[0]);
        onClose();
      })
      .catch(() => confirmDialog.tell("That doesn't look like a Corko project file."));
  };

  const del = async (b: Board) => {
    /* DELETING A BOARD THAT IS NESTED SOMEWHERE IS REFUSED, with the
     * list of where (docs/explorations/board-shapes.md, DECISIONS 3).
     * Not a confirm: the cards pointing at it would be left holding a
     * tombstone, and the fix is to go and un-nest them, which needs to
     * be findable. Undo could bring the board back, but "you can undo
     * it" is a poor answer to "you are about to break three cards you
     * cannot see from here". */
    const uses = nestUses(project).get(b.id) ?? [];
    if (uses.length) {
      const where = uses
        .slice(0, 6)
        .map((u) => `- ${u.nodeTitle.trim() || "Untitled card"} (in ${boardLabel({ title: u.boardTitle })})`)
        .join("\n");
      await confirmDialog.tell(
        `"${boardLabel(b)}" is nested in ${uses.length} ${uses.length === 1 ? "card" : "cards"}`,
        `Un-nest ${uses.length === 1 ? "it" : "them"} first, and the board can go.\n\n` +
          where +
          (uses.length > 6 ? `\n...and ${uses.length - 6} more` : ""),
      );
      return;
    }
    const counts = `${b.roots.length} top-level item${b.roots.length === 1 ? "" : "s"}`;
    /* NAME THE FRAMES, DO NOT OFFER TO DELETE THEM (owner, 2026-08-30).
     *
     * A tick-box here would weld the one irreversible deletion in the
     * app onto the one destructive gesture people press casually
     * BECAUSE it is reversible -- and the two do not undo together:
     * delete with the box ticked, press Cmd-Z, and the board returns
     * with permanently blank cards. On a deployment with a bucket the
     * frames are shared, so that would take them from everyone.
     *
     * It is also the moment the information is worth having and the
     * worst moment to act on it: deciding "no other board wants these"
     * needs the whole project present, which a peer mid-sync cannot
     * know. So the line TELLS, at the moment the orphans are created,
     * and points at the sweep -- which asks the same question
     * project-wide, with a preview, when you can see the project is
     * whole. It also catches every other way a frame goes dead (a
     * re-run import, a replaced image, an undone grab), which a
     * per-board box never could.
     *
     * Best-effort: a store that will not answer costs the sentence, not
     * the delete. */
    let frames = "";
    try {
      const stored = await storedStills(storedKey());
      if (stored) {
        const own = boardOnlyStills(project, b.id, stored);
        if (own.count) {
          frames =
            `\n\n${own.count} image${own.count === 1 ? "" : "s"} (${formatBytes(own.bytes)}) ` +
            `${own.count === 1 ? "is" : "are"} used only by this board. ` +
            `${own.count === 1 ? "It is" : "They are"} not deleted -- clear ` +
            `${own.count === 1 ? "it" : "them"} later with Purge unused card images.`;
        }
      }
    } catch {
      /* no store, no sentence */
    }
    const ok = await confirmDialog.ask({
      title: `Delete the board "${b.title || "Untitled"}"?`,
      body: `${counts[0].toUpperCase()}${counts.slice(1)}. You can undo this (Cmd/Ctrl+Z).${frames}`,
    });
    if (ok) ops.deleteBoard(b.id);
  };

  return (
    <div className="options-panel boards-panel" ref={ref}>
      <div className="options-title mono boards-title">
        <span>{heading}{project.boards.length > 1 ? ` (${project.boards.length})` : ""}</span>
        <span className="board-sort">
          <button
            className="board-row-tool tip-left"
            data-tip={
              boardSort === "alpha"
                ? "Sorted by name -- click to sort by date created"
                : "Sorted by date created -- click to sort by name"
            }
            aria-label={
              boardSort === "alpha" ? "Sort boards by date created" : "Sort boards by name"
            }
            onClick={() => setSetting("", "boardSort", boardSort === "alpha" ? "time" : "alpha")}
          >
            {boardSort === "alpha" ? (
              <span className="board-sort-az">A-Z</span>
            ) : (
              <Clock size={13} />
            )}
          </button>
          <button
            className="board-row-tool tip-left"
            /* No lower-casing the second half: it reads fine for
             * "Oldest first" and turns "Z to A" into "z to a". */
            data-tip={`${dirWords[boardSortDir]} -- click for ${dirWords[otherDir]}`}
            aria-label={`Sort boards: ${dirWords[otherDir]}`}
            onClick={() => setSetting("", "boardSortDir", otherDir)}
          >
            <SortDirIcon dir={boardSortDir} />
          </button>
        </span>
        {/* NEW FOLDER, right-justified on its own (owner, 2026-09-04:
            the sort pair centered, the label left, this at the
            right). It opens an empty folder to drag into; see
            FOLDER_DRAFTS for why an empty one is local until
            something lands. */}
        <span className="boards-title-new">
          <button
            className="board-row-tool tip-left"
            aria-label="New folder" data-tip="New folder"
            onClick={() => setCreating(true)}
          >
            <FolderPlus size={13} />
          </button>
        </span>
      </div>
      {creating && (
        <div className="options-group mono boards-folder">
          <DraftInput
            className="board-file-new boards-folder-rename"
            value=""
            placeholder="Folder name..."
            ariaLabel="New folder name"
            autoFocus
            onCommit={(v) => {
              /* Straight into the doc: an empty folder somebody made
                 is structure, and structure is shared. Always at the
                 TOP level -- nesting is the drag, so nothing typed
                 here can put a folder somewhere unexpected. */
              if (v.trim()) ops.addFolder([v.trim()]);
              setCreating(false);
            }}
          />
        </div>
      )}
      {rows.map((r) =>
        r.kind === "folder" ? (
          renamingFolder === r.key ? (
            <div
              key={r.key}
              className={"options-group mono boards-folder" + (r.depth ? " nested" : "")}
              style={{ paddingLeft: 6 + r.depth * 14 }}
            >
              <span
                className="board-row-rename-wrap"
                onBlur={() => setTimeout(() => setRenamingFolder(null), 0)}
                /* Escape ends the rename by name, not only through
                   the blur it causes -- a field that never truly
                   held focus (a background tab) blurs nothing */
                onKeyDown={(e) => {
                  if (e.key === "Escape") setTimeout(() => setRenamingFolder(null), 0);
                }}
              >
                <DraftInput
                  className="board-file-new boards-folder-rename"
                  value={r.name}
                  ariaLabel="Folder name"
                  autoFocus
                  selectAll
                  onCommit={(v) => {
                    const name = v.trim();
                    /* Committing an EMPTY name removes the folder --
                       its boards and subfolders move UP to its parent,
                       so tidying a level away never loses anything. */
                    if (!name) ops.removeFolder(r.folder);
                    else if (name !== r.name) {
                      /* The field shows the folder's NAME, so it can
                         only ever rename in place: the parent list is
                         kept and the last name replaced. Typing must
                         never silently re-parent -- that is what the
                         drag is for. */
                      ops.renameFolder(r.folder, [...r.folder.slice(0, -1), name]);
                    }
                  }}
                />
              </span>
            </div>
          ) : (
            <div key={r.key} className="boards-folder-row">
            <button
              className={
                "options-group mono boards-folder" +
                /* A NESTED heading is an item in its parent's list,
                   not the start of a new group, so it drops the
                   rule `.options-group` draws above itself -- the
                   indent already says what it is (owner,
                   2026-09-01). Top-level headings keep theirs,
                   where a divider still separates one run of the
                   shelf from the next. */
                (r.depth ? " nested" : "") +
                (overFolder === r.key ? " drop-over" : "") +
                (pickedFolder === r.key ? " picked" : "")
              }
              style={{ paddingLeft: 6 + r.depth * 14 }}
              aria-expanded={!shut.has(r.key)}
              /* NO `data-tip` HERE, and it is load-bearing rather
                 than taste (owner-reported 2026-08-31: a dragged
                 folder previewed as several rows).
                 `[data-tip]::after` is an absolutely positioned box
                 hanging BELOW the control -- 300px wide and ~27px
                 tall, taking this button's scrollHeight from 30 to
                 68 -- and the browser's default drag image is a
                 snapshot of the element AND its subtree. So the tip,
                 invisible at opacity 0, was dragged along as a big
                 empty rectangle over the rows underneath.
                 It was also an instruction ("drag onto another
                 folder to nest..."), which this app purged
                 everywhere in the 2026-08-09 sweep: a tip is a NAME.
                 A heading whose text IS its name needs neither.
                 If a tip is ever wanted back on a DRAGGABLE control,
                 it needs a custom setDragImage, not just shorter
                 words -- any tip at all re-opens this. */
              /* A folder is itself draggable, which is the ONLY way
                 to nest one now that no character means "inside". */
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData(FOLDER_DRAG, r.key);
                e.dataTransfer.effectAllowed = "move";
                shelfDragImage(e, e.currentTarget);
              }}
              onDragEnd={() => setOverFolder(null)}
              onClick={() => setPickedFolder(r.key)}
              onDoubleClick={() => toggleFolder(r.key)}
              /* Only OUR drags, and each is checked by type: a card,
                 a file, or anything else dragged over the shelf is
                 not offered a folder. */
              onDragOver={(e) => {
                const t = e.dataTransfer.types;
                if (!t.includes(BOARD_DRAG) && !t.includes(FOLDER_DRAG)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overFolder !== r.key) setOverFolder(r.key);
              }}
              onDragLeave={() => setOverFolder((f) => (f === r.key ? null : f))}
              onDrop={(e) => {
                setOverFolder(null);
                const payload = e.dataTransfer.getData(BOARD_DRAG);
                if (payload) {
                  e.preventDefault();
                  let ids: string[] = [];
                  try {
                    ids = JSON.parse(payload) as string[];
                  } catch {
                    ids = [payload]; // a lone id, from anything older
                  }
                  /* One transaction however many came along, so the
                   * whole drag is one undo step. */
                  ops.setBoardsFolder(ids, r.folder);
                  return;
                }
                const moved = e.dataTransfer.getData(FOLDER_DRAG);
                if (!moved || moved === r.key) return;
                e.preventDefault();
                const from = moved.split("\u001f");
                /* Onto itself or into its own descendant is refused
                   in the op as well -- a drop can ask for it and it
                   would rebase a subtree onto a root that no longer
                   exists. */
                ops.renameFolder(from, [...r.folder, from[from.length - 1]]);
              }}
            >
              {/* A FOLDER HAS ITS OWN SYMBOL (owner, 2026-09-02): the
                  chevron lives INSIDE the folder glyph, so the row
                  keeps its indent and the kind reads at the same
                  glance as a board's -- a bin in Avid, the same
                  vernacular the board rows took on the same day. */}
              <span
                className={"folder-glyph" + (shut.has(r.key) ? " shut" : "")}
                aria-hidden="true"
                /* the chevron alone opens and shuts on a single click */
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolder(r.key);
                }}
              >
                <Folder size={15} className="folder-glyph-body" />
                <ChevronDown
                  size={9}
                  className={"fold-caret" + (shut.has(r.key) ? " shut" : "")}
                />
              </span>
              <span className="boards-folder-name">{r.name}</span>
              <span className="boards-folder-count">{r.count}</span>
            </button>
            {/* A FOLDER'S TOOLS, at the right like a board's (owner,
                2026-09-02): rename and duplicate. Filing is the drag. */}
            <span className="board-row-tools boards-folder-tools">
              <button
                className="board-row-tool tip-left"
                aria-label="Rename folder" data-tip="Rename"
                onClick={() => setRenamingFolder(r.key)}
              >
                <Pencil size={12} />
              </button>
              <button
                className="board-row-tool tip-left"
                aria-label="Duplicate folder" data-tip="Duplicate"
                onClick={async () => {
                  const { boards: n, subfolders: m } = folderContents(project.boards, project.folders ?? [], r.folder);
                  /* Past a handful of boards this is a real amount of
                     shared doc to mint, so it asks first. */
                  if (n > 10) {
                    const ok = await confirmDialog.ask({
                      title: `Duplicate "${r.name}"?`,
                      body: `About to duplicate ${n} boards in ${m} subfolder${m === 1 ? "" : "s"}. Proceed?`,
                      confirmLabel: "Duplicate",
                      danger: false,
                    });
                    if (!ok) return;
                  }
                  ops.duplicateFolder(r.folder);
                }}
              >
                <Copy size={12} />
              </button>
            </span>
            </div>
          )
        ) : (
          (() => {
        const b = r.board;
        const leaf = b.levels.length - 1;
        const beats = b.roots.reduce((sum, root) => sum + leafDescendants(root, 0, leaf), 0);
        const isActive = b.id === active?.id;
        return (
          <Fragment key={b.id}>
          <div
            /* Not while a field is open in this row, or a drag from
               the words would start instead of a text selection --
               the same rule a card title has. */
            draggable={renamingId !== b.id}
            onDragStart={(e) => {
              const ids = dragIds(b.id);
              /* JSON, so the payload is one shape whether it carries
                 one board or nine -- a joined string would need a
                 separator, and this file just spent a round removing
                 the last one of those. */
              e.dataTransfer.setData(BOARD_DRAG, JSON.stringify(ids));
              e.dataTransfer.effectAllowed = "move";
              /* Same reason as the folder heading: a row's five tool
                 buttons each own a tooltip box hanging below it. */
              shelfDragImage(e, e.currentTarget, ids.length);
            }}
            onDragEnd={() => setOverFolder(null)}
            className={
              "board-row" +
              (isActive ? " active" : "") +
              (sel.has(b.id) ? " picked" : "") +
              (r.depth ? " indented" : "")
            }
            /* INDENTED BY DEPTH, on the same 14px step the headings
               use, so a board always sits inside its own folder.
               A flat indent was wrong the moment folders nested: a
               board two levels down drew LESS indented than the
               heading above it. Depth 0 keeps its zero, so a shelf
               with nothing filed looks exactly as it always has. */
            style={r.depth ? { paddingLeft: 6 + r.depth * 14 } : undefined}
          >
            {renamingId === b.id ? (
              /* Done when the field loses focus, however that happens
                 (Enter, Tab, a click away); DraftInput commits on the
                 same blur. Exiting only from onCommit left the field
                 up after an unchanged Enter (owner, 2026-09-02). */
              <span className="board-row-rename-wrap" onBlur={() => setTimeout(() => setRenamingId(null), 0)}>
                <DraftInput
                  className="board-row-rename"
                  value={b.title}
                  ariaLabel="Board name"
                  autoFocus
                  selectAll
                  onCommit={(v) => ops.setBoardTitle(b.id, v)}
                />
              </span>
            ) : (
              <button
                className="board-row-name"
                aria-label={isActive ? "This board is open" : "Open this board"}
                /* The tip carries the GESTURE because the gesture
                   changed (owner, 2026-09-01): a single click used
                   to open, and now selects. Still a name rather than
                   an instruction -- "Open" is what the row does. */
                data-tip={isActive ? "This board is open" : "Open (double-click)"}
                onClick={(e) => clickBoard(e, b.id)}
                onDoubleClick={() => {
                  onSelect(b.id);
                  onClose();
                }}
              >
                {isActive && <Check size={12} className="board-row-check" />}
                {/* THE KIND, as the symbol the picker and a nested card
                    already use -- a bin's item icons in Avid, and the
                    same idea (owner, 2026-09-02). The check stays; the
                    icon is part of the name. */}
                <span className="board-row-type" aria-hidden="true">
                  <TypeIcon id={styleOf(b.type)} size={13} />
                </span>
                <span className="board-row-title">{b.title || "Untitled board"}</span>
                <span className="mono board-row-meta">
                  {beats} {b.levels[leaf]?.name.toLowerCase() ?? "card"}
                  {beats === 1 ? "" : "s"}
                </span>
              </button>
            )}
            <span className="board-row-tools">
              <button
                className="board-row-tool tip-left"
                aria-label="Rename" data-tip="Rename"
                onClick={() => setRenamingId(renamingId === b.id ? null : b.id)}
              >
                <Pencil size={12} />
              </button>
              <button
                className="board-row-tool tip-left"
                aria-label="Duplicate" data-tip="Duplicate"
                onClick={() => {
                  const id = ops.duplicateBoard(b.id);
                  if (id) onSelect(id);
                }}
              >
                <Copy size={12} />
              </button>
              <button className="board-row-tool tip-left" aria-label="Export (.json)" data-tip="Export (.json)" onClick={() => exportBoardFile(b, project.tags, project.fields)}>
                <Download size={12} />
              </button>
              <button className="board-row-tool danger tip-left" aria-label="Delete board" data-tip="Delete board" onClick={() => del(b)}>
                <Trash2 size={12} />
              </button>
            </span>
          </div>
          </Fragment>
            );
          })()
        ),
      )}
      <div className="boards-panel-actions">
        <button
          className="options-structure-btn"
          onClick={() => {
            onClose();
            // the new board opens in THIS pane
            templatePicker.open(onSelect);
          }}
        >
          <Plus size={13} /> New board...
        </button>
        <button className="options-structure-btn" onClick={() => fileRef.current?.click()}>
          <Upload size={13} /> Load board...
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onLoadFile} />
      </div>
      <div className="options-group mono">Whole project ({project.boards.length} board
        {project.boards.length === 1 ? "" : "s"})</div>
      <div className="boards-panel-actions">
        <button className="options-structure-btn" onClick={() => exportProjectFile(project)}>
          <Package size={13} /> Export project...
        </button>
        <button className="options-structure-btn" onClick={() => projectFileRef.current?.click()}>
          <Upload size={13} /> Load project...
        </button>
        <input
          ref={projectFileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onLoadProjectFile}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  THE PANE BAR'S DOOR ONTO THE SHELF: a button naming the board this
 *  column shows, and the shelf under it. Thin on purpose -- everything
 *  the shelf can do lives in the shelf, so the OPEN BOARD DOOR
 *  (board/OpenBoardDoor.tsx) offers exactly the same things without
 *  either place knowing about the other.
 *
 *  The outside-click is HERE rather than in the shelf because "outside"
 *  means something different per host: this one's trigger button counts
 *  as inside, or clicking it while open would close and reopen in one
 *  gesture and the menu would never shut.
 * ------------------------------------------------------------------ */
export function BoardsMenu({
  activeBoardId,
  onSelect,
}: {
  activeBoardId: string | null;
  onSelect: (id: string) => void;
}) {
  const project = useProject();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = project.boards.find((b) => b.id === activeBoardId) ?? project.boards[0] ?? null;
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="options boards-menu" ref={ref}>
      <button
        className={"board-switcher-btn" + (open ? " active" : "")}
        aria-label="Boards in this project" data-tip="Boards in this project"
        onClick={() => setOpen((o) => !o)}
      >
        {/* the kind's symbol ahead of the name, as its row in the list
            shows it (owner, 2026-09-04) */}
        {active && (
          <span className="board-row-type board-switcher-type" aria-hidden="true">
            <TypeIcon id={styleOf(active.type)} size={13} />
          </span>
        )}
        <span className="board-switcher-name">{active ? active.title || "Untitled board" : "Boards"}</span>
        <ChevronDown size={13} className="fold-caret" />
      </button>
      {open && <BoardShelf activeBoardId={activeBoardId} onSelect={onSelect} onClose={close} />}
    </div>
  );
}
