import { defaultLegend } from "../colors";
import { uid } from "./ids";
import { FILM_LEVELS } from "./template";
import type { Board, FieldDef, Node, TagDef } from "./types";

/* ------------------------------------------------------------------ *
 *  Die Hard (1988) -- a scene-by-scene beat breakdown, and the worked
 *  example of how the 15-beat structure sits on top of a real film.
 *
 *  SCENES ARE SLUGLINES. A new scene starts wherever the screenplay would
 *  cut to a new INT./EXT. and location -- which is why there are so many
 *  of them, and why some hold two beats and some hold six. The exception
 *  is rapid intercutting (the roof and the plaza during the finale), where
 *  cutting back and forth every few seconds would produce scenes with one
 *  beat each and lose the shape; those stay as one scene.
 *
 *  ON THE STRUCTURAL LABELS. The fifteen landmark names come from Blake
 *  Snyder's "Save the Cat!", which is a trademarked brand and an
 *  identifiable branded method. The METHOD isn't copyrightable -- systems
 *  never are -- but the names are his, so every one is written IN QUOTES
 *  in its metadata value, both to mark it as a quotation and so the whole
 *  set can be found and renamed in one pass if this ever ships wider. The
 *  category itself is called "Structure" rather than the brand.
 *
 *  No dialogue is reproduced anywhere here. Every beat is a description of
 *  what happens, in our own words -- plot events are facts about a public
 *  work, and this is the analysis every screenwriting class does.
 * ------------------------------------------------------------------ */

/* One tag, not fifteen. ADR 0002: a tag is a MEMBERSHIP you scan the board
 * for, and its whole value is that every card carrying it draws the same
 * mark in the same place. Fifteen tags each applied to a single card would
 * be fifteen legend entries with nothing to scan. So: one "Structure" tag
 * marks every landmark, and hovering it in the legend lights the film's
 * skeleton at a glance. WHICH landmark it is, is a value (below). */
export const STRUCTURE_TAG: TagDef = {
  id: "tag-structure",
  name: "Structure",
  color: "#c2493f",
  pos: 0.5, // bottom edge, clear of the scene label and the note dot
  reach: 14,
  span: 30,
  offset: 0,
  shape: "ribbon",
  visible: true,
};

/* ...and the landmark's NAME is a metadata value, which is what ADR 0003
 * says values are for. showLabel is off: the value reads as a label
 * already, and "Structure: "Midpoint"" on a card face is noise. */
export const STRUCTURE_FIELD: FieldDef = { id: "fld-structure", name: "Structure", showLabel: false };

const beat = (title: string, color = "yellow"): Node => ({
  id: uid("b"),
  title,
  color,
  collapsed: false,
  children: [],
});

/* A landmark beat: the Structure tag, the quoted landmark name as its
 * value, and the value placed in the card's top band so it reads as a
 * heading on the beat it marks. */
const mark = (title: string, landmark: string, color = "pink"): Node => ({
  ...beat(title, color),
  tags: [STRUCTURE_TAG.id],
  values: { [STRUCTURE_FIELD.id]: `"${landmark}"` },
  slots: { header: STRUCTURE_FIELD.id },
});

const scene = (title: string, beats: Node[]): Node => ({
  id: uid("s"),
  title,
  collapsed: false,
  children: beats,
});

const act = (title: string, scenes: Node[]): Node => ({
  id: uid("a"),
  title,
  collapsed: false,
  children: scenes,
});

export function dieHardBoard(): Board {
  return {
    id: uid("bd"),
    title: "Die Hard -- 15-Beat Breakdown",
    levels: FILM_LEVELS,
    legend: defaultLegend(FILM_LEVELS),
    tags: [STRUCTURE_TAG],
    fields: [STRUCTURE_FIELD],
    roots: [
      act("ACT ONE", [
        scene("INT. BOEING 747 - NIGHT", [
          mark("The plane touches down at LAX", "Opening Image", "blue"),
          beat("McClane's hands are white on the armrest"),
          beat("The passenger beside him spots the cop"),
          mark("Advice: make fists with your toes on the carpet", "Theme Stated", "green"),
          beat("McClane retrieves the gun; the passenger stares"),
        ]),
        scene("INT. LAX TERMINAL - NIGHT", [
          beat("Christmas crowds; McClane carries an enormous teddy bear", "blue"),
          beat("Nobody is waiting for him at the gate"),
          beat("Argyle finds him with a hand-lettered sign"),
        ]),
        scene("INT. LIMOUSINE - MOVING - NIGHT", [
          beat("Argyle admits this is his first limo job"),
          beat("Christmas music, and the wrong kind of it", "orange"),
          beat("Argyle works the story out of him"),
          beat("Holly took her maiden name back when she moved west"),
          beat("Six months apart, and neither of them moved"),
        ]),
        scene("EXT. NAKATOMI PLAZA - NIGHT", [
          beat("The tower, half-finished and lit for Christmas", "blue"),
          beat("The limo drops into the garage"),
          beat("Argyle offers to wait downstairs"),
        ]),
        scene("INT. NAKATOMI LOBBY - NIGHT", [
          beat("A single guard and a computer directory"),
          beat("He looks her up under Gennero, not McClane"),
          beat("He rides up alone"),
        ]),
        scene("INT. 30TH FLOOR - THE PARTY - NIGHT", [
          beat("The party at full volume", "blue"),
          beat("Takagi's speech: the company's long memory"),
          beat("Ellis works the room"),
          beat("Holly crosses to him; the room notices"),
          beat("Introductions, carefully casual"),
        ]),
        scene("INT. HOLLY'S OFFICE - NIGHT", [
          beat("The Rolex, a gift from the company"),
          mark("The argument about her name -- the thing that needs fixing", "Set-Up", "green"),
          beat("He says the thing he can't take back"),
          beat("She leaves to give her speech"),
        ]),
        scene("INT. HOLLY'S BATHROOM - NIGHT", [
          beat("Alone, he takes his shoes off"),
          beat("He makes fists with his toes on the carpet", "green"),
          beat("He rehearses the apology in the mirror"),
        ]),
        scene("EXT. STREET / INT. TRUCK - NIGHT", [
          beat("A truck runs the last block toward the plaza", "blue"),
          beat("Inside, men load and check weapons"),
          beat("Theo unpacks his tools"),
        ]),
        scene("INT. GARAGE - NIGHT", [
          beat("The truck seals the ramp behind it"),
          beat("Argyle waits in the limo with the radio on"),
          beat("The phone lines are cut at the box"),
        ]),
        scene("INT. NAKATOMI LOBBY - NIGHT", [
          beat("The guard is killed at his desk"),
          beat("The doors are chained"),
          beat("Theo takes over the security station"),
        ]),
        scene("INT. 30TH FLOOR - THE PARTY - NIGHT", [
          mark("The music stops and the ceiling is shot out", "Catalyst"),
          beat("The party goes down onto the floor"),
          beat("Karl and Fritz herd them into the middle"),
          beat("Hans Gruber walks in, in no hurry at all"),
        ]),
        scene("INT. HOLLY'S OFFICE - NIGHT", [
          beat("McClane hears the shots through the wall"),
          beat("He takes the gun and leaves the shoes"),
          beat("Into the stairwell, barefoot"),
        ]),
      ]),

      act("ACT TWO -- FIRST HALF", [
        scene("INT. 32ND FLOOR (UNFINISHED) - NIGHT", [
          beat("Bare studs, plastic sheeting, no lights", "blue"),
          beat("He watches the floor below through the gap"),
          beat("He counts them and comes up one short"),
        ]),
        scene("INT. 30TH FLOOR - THE PARTY - NIGHT", [
          beat("Hans addresses the hostages, almost politely"),
          beat("He picks Takagi out by the cut of his suit"),
          beat("Theo starts work on the vault"),
        ]),
        scene("INT. 32ND FLOOR - BOARDROOM - NIGHT", [
          beat("Hans walks Takagi through the vault's seven locks"),
          beat("He asks for the code as though it were a formality"),
          beat("Takagi refuses"),
          beat("Hans kills him without raising his voice", "pink"),
        ]),
        scene("INT. STAIRWELL - NIGHT", [
          beat("McClane finds the fire alarm"),
          mark("He pulls it and waits for someone else to fix this", "Debate"),
        ]),
        scene("INT. LOBBY - NIGHT", [
          beat("Theo cancels the alarm with a phone call"),
          beat("The engine company turns around at the corner"),
          beat("Nobody is coming", "pink"),
        ]),
        scene("INT. MACHINE ROOM / STAIRS - NIGHT", [
          beat("Tony hunts him through the machinery"),
          beat("The fight goes down a flight of stairs"),
          mark("McClane kills him, and it is not clean", "Break Into Two"),
          beat("He takes the machine gun and the radio"),
          beat("He writes a message to Hans on the dead man's sweatshirt"),
        ]),
        scene("INT. ELEVATOR / 30TH FLOOR - NIGHT", [
          beat("The body rides down to the party"),
          beat("Hans reads the sweatshirt"),
          beat("Karl sees whose body it is", "pink"),
        ]),
        scene("INT. 32ND FLOOR - NIGHT", [
          beat("McClane works the radio onto the police band"),
          beat("Dispatch tells him to stay off the emergency channel"),
          beat("He gives them the address anyway"),
        ]),
        scene("EXT. CONVENIENCE STORE - NIGHT", [
          mark("Sergeant Al Powell buys Twinkies for his pregnant wife", "B Story", "green"),
          beat("The call comes in: check the address"),
        ]),
        scene("EXT. NAKATOMI PLAZA - NIGHT", [
          beat("Powell drives the plaza slowly"),
          beat("Through the glass the lobby looks like Christmas"),
          beat("He starts to write it off"),
        ]),
        scene("INT. 32ND FLOOR - NIGHT", [
          beat("Hans sends Heinrich and Marco upstairs"),
          beat("A gunfight in the dark among the studs"),
          beat("McClane kills them both"),
          mark("He takes the satchel of C4 and the detonators", "Fun and Games"),
        ]),
        scene("EXT. NAKATOMI PLAZA - NIGHT", [
          beat("A body comes through the glass onto Powell's car", "pink"),
          beat("Automatic fire chases him across the plaza"),
          beat("He reverses out and calls it in for real"),
        ]),
        scene("EXT. NAKATOMI PLAZA - LATER - NIGHT", [
          beat("Black-and-whites fill the street", "blue"),
          beat("Deputy Chief Robinson takes the scene and the microphone"),
          beat("Powell tries to tell him there is someone inside"),
          beat("McClane watches the circus arrive from above"),
        ]),
        scene("INT. 32ND FLOOR / EXT. PLAZA - NIGHT", [
          beat("McClane and Powell find each other on the radio", "green"),
          beat("He feeds Powell the names and numbers"),
          beat("Robinson decides the man on the radio is one of them"),
        ]),
        scene("EXT. PLAZA - SWAT ASSAULT - NIGHT", [
          beat("SWAT crosses the lawn under the lights", "blue"),
          beat("The terrorists cut them down from above"),
          beat("The armoured car starts up the steps"),
          beat("A rocket takes its turret off", "orange"),
        ]),
        scene("INT. ELEVATOR SHAFT / 30TH FLOOR - NIGHT", [
          beat("McClane rigs the C4 to a chair and a detonator"),
          mark("He drops it down the shaft and takes out a floor", "Midpoint", "orange"),
          beat("The blast blows glass across the plaza"),
          beat("The assault stops; both sides recalculate"),
        ]),
        scene("EXT. PLAZA - NIGHT", [
          beat("The FBI arrive and take the scene from Robinson"),
          beat("Agents Johnson and Johnson, no relation"),
          beat("They order the building's power cut"),
        ]),
      ]),

      act("ACT TWO -- SECOND HALF", [
        scene("INT. 30TH FLOOR - NIGHT", [
          beat("Ellis volunteers to negotiate, certain he can close it"),
          beat("He calls McClane by his first name on an open line"),
          beat("Hans kills him when the answer is no", "pink"),
          mark("McClane learns what his name is worth in here", "Bad Guys Close In"),
        ]),
        scene("INT. 32ND FLOOR (UNFINISHED) - NIGHT", [
          beat("Hans finds him in the dark and plays a hostage"),
          beat("The accent is perfect; the shoes are wrong", "blue"),
          beat("McClane hands him an empty gun"),
          beat("Hans turns it on him and it clicks"),
          beat("Karl's men arrive; McClane goes out through the glass"),
        ]),
        scene("INT. 30TH FLOOR - NIGHT", [
          beat("Holly asks for a couch for the pregnant woman"),
          beat("Hans agrees, and files her away"),
          beat("Theo works down the last of the locks"),
        ]),
        scene("EXT. LOS ANGELES - NEWS VAN - NIGHT", [
          beat("Thornburg smells the story of the year", "blue"),
          beat("He runs the address against the payroll"),
        ]),
        scene("INT. VAULT - NIGHT", [
          beat("The sixth lock opens; the seventh is electromagnetic"),
          beat("Theo says only the feds can open it now"),
          beat("Hans is entirely calm about this", "green"),
        ]),
        scene("INT. STAIRWELL / MECHANICAL FLOOR - NIGHT", [
          beat("Karl comes for him with a length of chain", "pink"),
          beat("The fight wrecks the room"),
          beat("McClane hangs him and leaves him hanging"),
          beat("He is bleeding from both feet", "pink"),
        ]),
        scene("INT. BATHROOM - NIGHT", [
          mark("He digs the glass out of his feet with tweezers", "All Is Lost", "pink"),
          beat("He is out of ammunition and out of floors"),
          beat("Powell keeps him talking through it"),
          mark("He asks Powell to tell Holly he is sorry", "Dark Night of the Soul", "green"),
          beat("Powell tells him about the shooting that ended his street work"),
        ]),
        scene("INT. 30TH FLOOR - NIGHT", [
          beat("Thornburg's broadcast reaches the party on a TV", "blue"),
          beat("The McClane children are on the screen"),
          beat("Hans looks from the screen to Holly"),
          beat("He now knows exactly what he is holding", "pink"),
        ]),
        scene("EXT. PLAZA - NIGHT", [
          beat("The FBI cut the grid to force a surrender"),
          beat("Deep in the building, the last lock releases", "orange"),
          beat("Hans watches the vault swing open"),
        ]),
        scene("INT. VAULT - NIGHT", [
          beat("Six hundred and forty million in bearer bonds"),
          beat("The crew load it into cases"),
          beat("Hans explains the plan he has been running all night"),
          mark("The theft was always the point; the terror was cover", "Break Into Three", "orange"),
        ]),
      ]),

      act("ACT THREE", [
        scene("EXT. PLAZA / INT. ROOF - NIGHT", [
          beat("The FBI helicopter lifts off to make the rescue", "blue"),
          beat("Hans orders the hostages up to the roof"),
          beat("The roof is wired to come down with them"),
        ]),
        scene("INT. STAIRWELL - NIGHT", [
          beat("McClane climbs against the traffic"),
          beat("He takes Holly out of the line as they pass"),
          beat("Hans takes her back at gunpoint"),
        ]),
        scene("EXT. ROOF - NIGHT", [
          beat("McClane fires into the air to break the crowd", "pink"),
          beat("The hostages stampede back down the stairs"),
          beat("The helicopter crew take him for a terrorist"),
          beat("The roof goes up behind him", "orange"),
          beat("He goes off the edge on a fire hose"),
          beat("The hose stops short and he swings through a window"),
        ]),
        scene("INT. 30TH FLOOR - NIGHT", [
          beat("Hans has Holly and the last of the bonds"),
          beat("McClane comes in with his hands up"),
          beat("He plays the beaten man well enough"),
          mark("The gun taped to his back", "Finale"),
          beat("Two rounds; Hans goes through the window"),
          beat("Holly's grip on his wrist is the only thing holding him"),
          beat("The Rolex comes off and Hans falls", "pink"),
        ]),
        scene("EXT. PLAZA - NIGHT", [
          beat("They come out together into the light", "blue"),
          beat("McClane and Powell meet on the ground for the first time", "green"),
          beat("Karl comes out of the doors shooting"),
          beat("Powell draws and ends it", "pink"),
        ]),
        scene("EXT. PLAZA - CONTINUOUS - NIGHT", [
          beat("Thornburg pushes a camera into their faces"),
          beat("Holly answers him without saying a word"),
          beat("Argyle rams the limo out through the garage door"),
          mark("The two of them ride away as it starts to snow", "Final Image", "blue"),
        ]),
      ]),
    ],
  };
}
