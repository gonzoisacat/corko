import { defaultLegend } from "../colors";
import { dieHardBoard } from "./dieHard";
import { uid } from "./ids";
import {
  DEFAULT_LEVELS,
  FILM_LEVELS,
  SERIES_LEVELS,
  SIMPLE_LEVELS,
  type BoardTemplate,
} from "./template";
import type { Board, LevelDef, Node } from "./types";

/* ------------------------------------------------------------------ *
 *  Sample content for the starter templates.
 *
 *  NOTHING HERE MAY COME FROM A REAL PRODUCTION. This file previously
 *  seeded the Documentary template with an actual shooting day from a
 *  real show -- named guests, real segment titles, real dates. That shipped in the
 *  repo and in every build, so a tool whose whole point is that anyone can
 *  self-deploy it was handing strangers a client's unreleased material.
 *  Sample content has to be either invented or drawn from a work that is
 *  already public and widely analyzed.
 *
 *  So there is exactly ONE populated template, and it is The Godfather --
 *  a film taken apart in screenwriting classes for fifty years, described
 *  here in plain beats of our own words. Plot events are facts about a
 *  public work; no dialogue is reproduced. Every other template gets a
 *  skeleton ("Act 1 / Cold Open / Title sequence") that shows the tiers
 *  without pretending to be anyone's cut.
 * ------------------------------------------------------------------ */

/* Color ids come from the default legend (colors.ts COLORS):
 *   yellow  Beat (the default)      blue   B-roll / visual
 *   green   Confirmed               pink   Needs review
 *   orange  Music / archival
 * The samples use them the way an editor would -- to mark a kind of
 * material, not to decorate. */
const beat = (text: string, color = "yellow"): Node => ({
  id: uid("b"),
  title: text,
  color,
  collapsed: false,
  children: [],
});

const scene = (title: string, beats: Node[]): Node => ({
  id: uid("s"),
  title,
  collapsed: false,
  children: beats,
});

const group = (title: string, children: Node[]): Node => ({
  id: uid("g"),
  title,
  collapsed: false,
  children,
});

/* ---- the skeleton every non-example template starts from ---------- *
 * One node per tier, named from the ladder itself, ending in a handful of
 * placeholder cards -- "Act 1 / Cold Open / Title sequence". Enough to show
 * what the tiers ARE without pretending to be anyone's actual cut. */
const STARTER_CARDS = ["Title sequence", "Opening image", "First scene"];

export function starterBoard(levels: LevelDef[], title: string): Board {
  const leaf = levels.length - 1;
  const build = (depth: number): Node => {
    // the leaf-PARENT is the cards lane, so it gets the cards
    if (depth === leaf - 1) {
      // ...unless the ladder is only two tiers, where that is also the root
      const name = depth === 0 ? `${levels[depth].name} 1` : "Cold Open";
      return group(name, STARTER_CARDS.map((c) => beat(c)));
    }
    return group(`${levels[depth].name} 1`, [build(depth + 1)]);
  };
  return { id: uid("bd"), title, levels, legend: defaultLegend(levels), roots: [build(0)] };
}

/* ---- The Godfather (1972): Act -> Scene -> Beat -------------------- *
 * The standard three-act reading taught in screenwriting classes. Beats
 * are one-line descriptions of what happens, written here rather than
 * quoted -- this is a structural example, not a copy of the screenplay.
 *
 * It earns its place as sample content: the turning points are famous
 * enough that anyone opening the board can immediately see what a beat
 * board is FOR, and it exercises the tiers with real dramatic shape
 * instead of lorem ipsum. */
export function godfatherBoard(): Board {
  return {
    id: uid("bd"),
    title: "The Godfather -- Beat Breakdown",
    levels: FILM_LEVELS,
    legend: defaultLegend(FILM_LEVELS),
    roots: [
      group("ACT ONE -- The Family Business", [
        scene("The Wedding", [
          beat("Bonasera asks the Don for justice"),
          beat("No Sicilian can refuse a request on his daughter's wedding day"),
          beat("Connie's reception, the family on display", "blue"),
          beat("Michael arrives in uniform with Kay"),
          beat("Michael: that's my family, not me", "green"),
          beat("Johnny Fontane begs for a film role"),
          beat("The Don sends Hagen to Hollywood"),
        ]),
        scene("Hollywood", [
          beat("Hagen makes Woltz an offer"),
          beat("Woltz refuses, and insults the family"),
          beat("Woltz wakes beside the horse's head", "pink"),
        ]),
        scene("The Sollozzo Proposal", [
          beat("Sollozzo pitches narcotics, backed by the Tattaglias"),
          beat("The Don declines -- the wrong business for his politicians"),
          beat("Sonny speaks out of turn and shows a crack", "pink"),
          beat("Luca Brasi is sent to spy, and is murdered"),
        ]),
        scene("The Shooting", [
          beat("The Don buys fruit on the street", "blue"),
          beat("Vito is shot and left for dead"),
          beat("Michael learns of it from a newsstand paper"),
          beat("The family closes ranks without him"),
        ]),
      ]),
      group("ACT TWO -- Michael Crosses", [
        scene("The Hospital", [
          beat("Michael finds his father's guards gone"),
          beat("He moves the bed and hides Vito"),
          beat("Enzo stands with him on the steps, bluffing", "green"),
          beat("Michael's hands are steady -- his own surprise"),
          beat("McCluskey breaks Michael's jaw"),
        ]),
        scene("Louis Restaurant", [
          beat("Michael volunteers to kill Sollozzo and the captain"),
          beat("The family doubts he can"),
          beat("The gun is planted behind the cistern"),
          beat("The meeting, the train noise rising", "orange"),
          beat("Michael kills them both and walks out", "pink"),
        ]),
        scene("Sicily", [
          beat("Exile: Michael in the hills with bodyguards", "blue"),
          beat("He sees Apollonia and is struck"),
          beat("The courtship, the wedding"),
          beat("The car bomb meant for him kills her", "pink"),
        ]),
        scene("New York Without Him", [
          beat("Connie's marriage turns violent"),
          beat("Sonny beats Carlo in the street"),
          beat("Carlo provokes Connie again, as arranged"),
          beat("Sonny is killed at the causeway toll booth", "pink"),
        ]),
        scene("The Don Sues For Peace", [
          beat("Vito sees his son's body and stops the war"),
          beat("The meeting of the Five Families"),
          beat("He accepts the narcotics trade to bring Michael home"),
          beat("He names the traitor before anyone else sees it", "green"),
        ]),
      ]),
      group("ACT THREE -- Becoming the Don", [
        scene("The Heir", [
          beat("Michael returns and marries Kay"),
          beat("He promises the family will be legitimate in five years"),
          beat("He takes over as the Don in all but name"),
          beat("Moving the operation to Nevada", "blue"),
        ]),
        scene("Las Vegas", [
          beat("Fredo has gone native and sides with Moe Greene"),
          beat("Moe Greene refuses to sell and humiliates Fredo"),
          beat("Michael tells Fredo never to take sides against the family"),
        ]),
        scene("The Garden", [
          beat("Vito and Michael talk succession, plainly"),
          beat("The Don warns which man will bring the meeting"),
          beat("Vito plays with his grandson among the tomatoes", "blue"),
          beat("He dies in the garden", "orange"),
        ]),
        scene("The Baptism", [
          beat("Michael stands as godfather to Connie's son"),
          beat("He renounces Satan at the font", "orange"),
          beat("Barzini on the courthouse steps"),
          beat("Moe Greene in the massage room"),
          beat("Cuneo in the revolving door"),
          beat("Stracci and Tattaglia"),
          beat("The heads of the Five Families settled in one morning", "pink"),
        ]),
        scene("The Door", [
          beat("Carlo is told he is out, and confesses"),
          beat("Carlo is killed in the car"),
          beat("Connie accuses Michael in front of Kay"),
          beat("Michael lies to Kay, and she chooses to believe him"),
          beat("The men kiss his hand; the door closes on her", "green"),
        ]),
      ]),
    ],
  };
}

/* The starter templates offered at board creation (Board-structure v1).
 * Documentary and Film ship sample content; the rest seed a blank
 * scaffold on their ladder. Tier names remain fully renamable afterward. */
export const TEMPLATES: BoardTemplate[] = [
  {
    id: "documentary",
    name: "Documentary",
    description: "Reel → Section → Scene → Beat.",
    levels: DEFAULT_LEVELS,
    build: () => starterBoard(DEFAULT_LEVELS, "Untitled Cut"),
  },
  {
    id: "film",
    name: "Film / Screenplay",
    description: "Act → Scene → Beat. Three tiers.",
    levels: FILM_LEVELS,
    build: () => starterBoard(FILM_LEVELS, "Untitled Film"),
  },
  {
    id: "series",
    name: "Series",
    description: "Season → Episode → Scene → Beat.",
    levels: SERIES_LEVELS,
    build: () => starterBoard(SERIES_LEVELS, "Untitled Series"),
  },
  {
    id: "simple",
    name: "Simple",
    description: "Section → Card. A flat set of card lists.",
    levels: SIMPLE_LEVELS,
    build: () => starterBoard(SIMPLE_LEVELS, "Untitled Board"),
  },
  /* The worked examples, deliberately their OWN entries rather than riding
   * on "Film / Screenplay": someone starting a real screenplay shouldn't
   * have to delete somebody else's film first. These are picked on purpose,
   * to see what a filled-in board looks like. */
  {
    id: "godfather",
    name: "The Godfather (example)",
    description: "A worked Act → Scene → Beat breakdown to look around in.",
    levels: FILM_LEVELS,
    build: () => godfatherBoard(),
  },
  {
    id: "diehard",
    name: "Die Hard (example)",
    description: "Scene by scene, with the 15 structural landmarks marked.",
    levels: FILM_LEVELS,
    build: () => dieHardBoard(),
  },
];
