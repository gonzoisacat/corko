import { Image as ImageIcon, ImageOff } from "lucide-react";
import { setSetting, useSettings, type CardImages } from "../state/settings";

/* ------------------------------------------------------------------ *
 *  THE CARD IMAGES' SWITCH (owner, 2026-09-08): "the ability to turn on
 *  and off card images ... on the legend row grouped with the buttons
 *  on the top right of that, just add a new one and it's the traditional
 *  images icon in a button. it turns on/off the images and the text
 *  formatting for images on all cards that exist on the board." Then a
 *  third state: "no words, just images. i guess the icon should either
 *  change to like an Aa with a line through it in that state?" --
 *  "(keep overlays regardless)".
 *
 *  Three states, cycled by a click: ON (the image icon) -> ONLY (an Aa
 *  struck through, drawn here since the icon set has none: a pictured
 *  card hides its words and keeps its tags, dots, pins and values) ->
 *  OFF (the crossed image, dimmed: no pictures, and a pictured card's
 *  text overrides go with them). Per board per browser
 *  (settings.cardImages). The pane stamps `data-images` and CSS does
 *  the hiding by one rule per state; the four card faces read the
 *  tier's text for a hidden picture (board/cardText.ts `plain`). First
 *  in the corner group, before the dots switch.
 * ------------------------------------------------------------------ */
const NEXT: Record<CardImages, CardImages> = { on: "only", only: "off", off: "on" };

export function CardImagesToggle({ boardId }: { boardId: string }) {
  const { cardImages } = useSettings(boardId);
  return (
    <button
      className={"card-images-btn tip-left" + (cardImages !== "off" ? " on" : "")}
      data-state={cardImages}
      aria-label="Card image visibility"
      data-tip="Card image visibility"
      onClick={() => setSetting(boardId, "cardImages", NEXT[cardImages])}
    >
      {cardImages === "on" ? (
        <ImageIcon size={14} />
      ) : cardImages === "only" ? (
        <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
          <text x="1" y="11.5" fontSize="11" fontWeight="600" fontFamily="inherit" fill="currentColor">
            Aa
          </text>
          <line x1="1.5" y1="13" x2="14.5" y2="1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ) : (
        <ImageOff size={14} />
      )}
    </button>
  );
}
