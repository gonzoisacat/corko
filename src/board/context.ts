import { createContext, useContext } from "react";
import { settingsFor, type Settings } from "../state/settings";
import type { NestInfo } from "../state/nesting";
import type { PaneSlot } from "./paneFocus";

/* Ambient state the deep row tree needs from its PANE: which board the
 * pane shows (root-level ops, legend lookups and the move-vs-copy drag
 * rule all need it), the active (lowercased) search query for match
 * highlighting, and that board's effective look. Everything a pane-less
 * overlay needs -- the just-added card (board/autoEdit.ts), the open
 * menus, the selection -- lives in module stores instead, since those
 * render above the panes.
 *
 * `settings` rides here rather than being read per component because
 * looks went PER BOARD (state/settings.ts) and the two panels can show
 * different boards: a `useSettings()` inside Card would resolve against
 * the wrong one. It is also the cheap way round -- the Overview is not
 * virtualized, so a subscription per card is thousands of subscriptions,
 * the same reason `tags` and `noteDots` are threaded down ProxyNode. One
 * subscription per pane, in BoardPane. */
export interface BoardUI {
  boardId: string;
  /* Every board in the project, by id, for the nesting cards to read
   * (state/nesting.ts `boardIndex` -- identity-stable until a board is
   * added, removed, renamed or re-typed, so it never churns this value). */
  nests: Map<string, NestInfo>;
  query: string;
  matchCase: boolean; // the search bar's Aa toggle, per panel
  /* CONNECTIONS MODE (Free Grid): selecting a card lights its strings
   * and the cards they join, dimming the rest. Per PANE, like the
   * query -- a way of reading a board right now, not a fact about it. */
  connections: boolean;
  settings: Settings;
  /* Which PANEL this is. The legend needs it because the highlight is per
   * pane (board/legendHighlight.ts) -- hovering a tag in one panel must
   * not dim the other, which may be a different board with different
   * tags. */
  slot: PaneSlot;
}

const NO_NESTS: Map<string, NestInfo> = new Map();

export const BoardUIContext = createContext<BoardUI>({
  boardId: "",
  nests: NO_NESTS,
  query: "",
  matchCase: false,
  connections: false,
  settings: settingsFor(""),
  slot: "a",
});

export const useBoardUI = (): BoardUI => useContext(BoardUIContext);
