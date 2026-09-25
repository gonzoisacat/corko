import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  ChevronDown,
  ChevronRight,
  FilmIcon,
  ListVideo,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  X,
  ClipboardPaste,
  Copy,
} from "lucide-react";
import { openNew } from "./autoEdit";
import { playerDrive } from "./cardPanels";
import { ops, useFields, useNode, useTags } from "../state/useBoard";
import { RATES, DEFAULT_RATE, formatTC, framesToSeconds, parseTC } from "../state/timecode";
import { parseAny } from "../state/tcCalc";
import { copyText, readClipboard } from "./TcCalcPopover";
import { fileReader, readEmbeddedTC, type EmbeddedTC } from "../state/mp4tc";
import { captureStamps, displayTC, formatRuntime, type CaptureVerb } from "../state/player";
import { setPlayerPref, usePlayerPrefs } from "../state/playerPrefs";
import type { Board } from "../state/types";
import { captureFrame } from "./stills";
import { applyCapture, writeCapture } from "./capture";
import { useSelectionIds } from "./selection";
import { TagSwatch } from "./TagSwatch";
import { tagPanel } from "./tagPanel";
import { newTags } from "./newTags";
import { importEdlFile } from "./edlImport";

/* ------------------------------------------------------------------ *
 *  PLAYER MODE's panel (owner, 2026-09-06): a proxy from disk beside
 *  the Beat Map, and one button -- "Create [tier] card from frame" --
 *  that mints a card at the end of the board wearing the frame and
 *  stamped with its timecode. A board-populating tool, not a notes
 *  tool ("more for populating a board that would then be used for
 *  notes"): you capture the first frame of a scene as a Scene, type its
 *  beats by hand in the board pane while the film plays, and capture
 *  the next scene when it comes. state/player.ts is the rule; the knobs
 *  are per board per browser (state/playerPrefs.ts).
 *
 *  THE FILE NEVER LEAVES THE MACHINE. It plays from an object URL, the
 *  same way the EDL import reads a proxy; only the captured stills go
 *  to the blob store. H.264 in an .mp4, for board/stills.ts's reason.
 *
 *  TWO VERBS on the one button (owner, 2026-09-06): CREATE a new card
 *  of a tier, or APPLY the frame to the card selected on the board --
 *  "retroactively apply an image from a video to an existing board".
 *  The verb is the button's first word, a dropdown; the sentence after
 *  it follows the verb. (An automatic seek on selecting a card was
 *  built and cut the same day: it fought Apply, and "may be
 *  unnecessary" -- his words. state/player.ts keeps the arithmetic.)
 * ------------------------------------------------------------------ */

export function PlayerPanel({
  board,
  onGoTo,
  onOpenBoard,
}: {
  board: Board | null;
  onGoTo: (id: string) => boolean;
  /* an imported EDL's board, to show in the board pane */
  onOpenBoard: (id: string) => void;
}) {
  const bid = board?.id ?? "";
  const prefs = usePlayerPrefs(bid);
  const fields = useFields();
  const videoRef = useRef<HTMLVideoElement>(null);
  const edlRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  /* what the container said about itself; null until read, {} when it
     said nothing (a WebM, a file with no timecode track) */
  const [embedded, setEmbedded] = useState<EmbeddedTC | null>(null);
  /* ARMED TAGS: lit chips go onto every card minted while they are lit,
     and they STAY lit across captures -- a topic runs across shots, the
     way a logger's keyword stays pressed -- until you unpress it or
     clear the lot. Session state: what you are logging right now. */
  const [armed, setArmed] = useState<Set<string>>(() => new Set());
  const tags = useTags();
  const tagsRef = useRef<HTMLDivElement>(null);

  const rate = RATES.find((r) => r.label === prefs.rateLabel) ?? DEFAULT_RATE;
  const levels = board?.levels ?? [];
  const tierDepth = Math.min(prefs.tierDepth, Math.max(0, levels.length - 1));
  const tierName = levels[tierDepth]?.name ?? "card";
  const verb: CaptureVerb = prefs.verb;

  /* APPLY needs exactly one card selected, on THIS board */
  const selected = useSelectionIds();
  const selId = selected.length === 1 ? selected[0] : null;
  const selNode = useNode(bid || null, selId);
  const canApply = !!selNode;

  /* an object URL per file, revoked when the file goes */
  useEffect(() => {
    if (!file) {
      setUrl(null);
      setEmbedded(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    setError(null);
    setTime(0);
    setDuration(0);
    setPlaying(false);
    /* READ THE FILE'S OWN TIMECODE AND RATE (state/mp4tc.ts). The rate
       the file names becomes the board's rate pref -- still yours to
       change in the select -- so the stamps count at the file's rate
       without a second thought. */
    let live = true;
    setEmbedded(null);
    void readEmbeddedTC(fileReader(file)).then((got) => {
      if (!live) return;
      setEmbedded(got);
      /* the file's rate, or "" -- Not detected -- until somebody picks
         (owner, 2026-09-06); the stamps count at the default meanwhile */
      setPlayerPref(bid, "rateLabel", got.rate ? got.rate.label : "");
    });
    return () => {
      live = false;
      URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  /* THE START, resolved: following the file, it is the file's, or the
     01:00:00:00 convention when the file has none (owner, 2026-09-06:
     "Not detected (01:00:00:00 default)"); not following, it is the
     typed box. */
  const fileStart = embedded?.startFrames !== undefined && embedded.rate ? formatTC(embedded.startFrames, rate) : null;
  const DEFAULT_START = "01:00:00:00";
  const effStart: string | null = prefs.followEmbedded ? (fileStart ?? DEFAULT_START) : prefs.startTC;
  const stampTC = prefs.stampTimecode && effStart !== null;
  /* what each dropdown reads right now, for sizing it to that */
  const rateShown =
    prefs.rateLabel === ""
      ? "Not detected (select)"
      : prefs.rateLabel + (embedded?.rate?.label === prefs.rateLabel ? " (detected)" : "");
  const startShown = !file
    ? "--"
    : embedded === null
      ? "Reading..."
      : fileStart
        ? `${fileStart} (detected)`
        : `Not detected (${DEFAULT_START} default)`;

  const pick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/mp4,video/quicktime,video/webm,video/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) setFile(f);
    };
    input.click();
  };

  const v = () => videoRef.current;
  const seekTo = useCallback((s: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(s, el.duration || s));
  }, []);
  /* SPACE IS PLAY / PAUSE while the player holds the keyboard (owner,
     2026-09-08): a mousedown inside takes it, one anywhere else gives it
     back (board/cardPanels.ts playerDrive; keyNav's menu tap and
     spacePan's hold stand aside while it is on). Both keydown and keyup
     are swallowed so a focused transport button is not pressed as well;
     a held key's repeats do not re-toggle. */
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      playerDrive.set(!!panelRef.current?.contains(e.target as Node));
    };
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      playerDrive.set(false);
    };
  }, []);
  const togglePlayRef = useRef<() => void>(() => {});
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || !playerDrive.get() || typing(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // a passive panel (ui/FloatPanel.tsx) leaves the keys to the board
      if (document.querySelector(".ctx-menu, .float-panel:not([data-passive]), .confirm-backdrop")) return;
      e.preventDefault();
      if (e.type === "keydown" && !e.repeat) togglePlayRef.current();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  const togglePlay = () => {
    const el = v();
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };
  togglePlayRef.current = togglePlay;
  const frame = 1 / rate.exact;
  /* +/- a few seconds from wherever the playhead is now; seekTo clamps */
  const jump = (s: number) => {
    const el = v();
    if (!el) return;
    seekTo(el.currentTime + s);
  };
  const step = (n: number) => {
    const el = v();
    if (!el) return;
    el.pause();
    seekTo(el.currentTime + n * frame);
  };

  /* THE CAPTURE. Works while playing: the frame you saw is the frame
     you get (board/stills.ts captureFrame). The card is written after
     the still is in the store, so it never points at nothing. */
  const capture = async () => {
    const el = v();
    if (!el || !board || busy) return;
    if (verb === "apply" && !selNode) return;
    setBusy(true);
    try {
      const at = el.currentTime;
      // no still when Capture still frame is off: the card gets the
      // stamps and tags and no picture (owner, 2026-09-08)
      const blob = prefs.still ? await captureFrame(el) : null;
      const stamps = captureStamps(at, rate, {
        startTC: effStart ?? "",
        stampTimecode: stampTC,
        stampRuntime: prefs.stampRuntime,
      });
      const tagIds = tags.filter((t) => armed.has(t.id)).map((t) => t.id);
      const stamp = stamps.timecode ?? stamps.runtime ?? "captured";
      if (verb === "apply" && selNode) {
        const { pictureShows } = await applyCapture({ node: selNode, blob, stamps, fields, tagIds });
        setFlash(pictureShows ? `${stamp} -> ${selNode.title || "the card"}` : `${stamp} written; the card keeps its pinned picture`);
        setTimeout(() => setFlash(null), 1600);
      } else {
        const id = await writeCapture({ board, tierDepth, blob, stamps, fields, tagIds });
        if (id) {
          onGoTo(id);
          // straight into its title, like a card the seam mints (owner,
          // 2026-09-08: "immediately start typing in the newly minted card")
          openNew(id);
          setFlash(stamp);
          setTimeout(() => setFlash(null), 1200);
        }
      }
    } catch (e) {
      /* a capture that fails must say so where you are looking, not in
         a console: the card may already be minted without its picture */
      setError(`The capture failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const tc = displayTC(time, rate, effStart ?? "00:00:00:00");

  return (
    <div className="player-panel" ref={panelRef}>
      <div className="notes-bar player-bar">
        <span className="notes-title mono">PLAYER</span>
        <span className="notes-count mono player-file" title={file?.name}>
          {file ? file.name : "no video loaded"}
        </span>
        <span className="pane-bar-spacer" />
        {/* THE EDL IMPORT'S SECOND FRONT DOOR (owner, 2026-09-06: "fold
            in the EDL functionality so it has a front door here as
            well"). The same import as the New Board flow's, with the
            video already open handed over as the proxy, so the shot
            board's stills come from what is playing. The new board
            opens in the board pane. */}
        <button
          className="pane-btn"
          data-tip={file ? `Stills from ${file.name}` : undefined}
          onClick={() => edlRef.current?.click()}
        >
          <ListVideo size={13} /> Import EDL...
        </button>
        <input
          ref={edlRef}
          type="file"
          accept=".edl,text/plain"
          hidden
          className="player-edl-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importEdlFile(f, onOpenBoard, file ?? undefined);
          }}
        />
        <button className="pane-btn" onClick={pick}>
          <FilmIcon size={13} /> {file ? "Change video..." : "Open video..."}
        </button>
        {file && (
          <button
            className="pane-btn icon-only tip-left"
            aria-label="Close the video"
            data-tip="Close video"
            onClick={() => setFile(null)}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* THE BLOCK: stage, transport, capture, knobs, tags -- a 16:9
          stage sized by the column's width, the whole block centered in
          whatever height is left (owner, 2026-09-06: the strip sat on
          the pane's bottom edge). The bar above stays at the top. */}
      <div className="player-body">
      {/* a file dropped on the stage opens too -- from Finder, or from
          a script driving the pane */}
      <div
        className="player-stage"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const f = e.dataTransfer.files?.[0];
          if (!f) return;
          e.preventDefault();
          setFile(f);
        }}
      >
        {url ? (
          <video
            ref={videoRef}
            className="player-video"
            src={url}
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onSeeked={(e) => setTime(e.currentTarget.currentTime)}
            /* a recorded stream can say Infinity; the scrub needs a number */
            onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
            onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
            onError={() =>
              setError(
                "That video could not be played. It needs to be H.264 in an .mp4 -- browsers cannot decode ProRes, DNxHD or MXF.",
              )
            }
            onClick={togglePlay}
          />
        ) : (
          <button className="player-empty" onClick={pick}>
            <FilmIcon size={22} />
            <span>Open a video to play beside the board</span>
            <span className="player-empty-sub">H.264 in an .mp4; it stays on this machine</span>
          </button>
        )}
        {error && <div className="player-error">{error}</div>}
        {flash && <div className="player-flash mono">{flash}</div>}
      </div>

      {/* the transport: a scrub bar, the playhead as timecode, frame
          steps either side of play/pause */}
      <div className="player-transport">
        <input
          type="range"
          className="player-scrub"
          min={0}
          max={Math.max(0.001, duration)}
          step={frame}
          value={Math.min(time, duration || time)}
          disabled={!url}
          aria-label="Scrub"
          onChange={(e) => seekTo(Number(e.target.value))}
        />
        <div className="player-buttons">
          <span className="player-tc mono">{tc}</span>
          {/* THE PLAYHEAD'S TIMECODE, OUT AND IN (owner, 2026-09-10).
              Out is the common way round -- a number you read here is
              usually wanted somewhere else -- and IN seeks the player to
              a timecode somebody copied from an NLE, which is the same
              journey backwards. Both decline quietly rather than
              complaining: a clipboard a browser will not open, or one
              holding something that is not a timecode, costs the click
              and nothing else (board/TcCalcPopover.tsx says why). */}
          <button
            className="pane-btn icon-only"
            aria-label="Copy the current timecode"
            data-tip="Copy this timecode"
            disabled={!url}
            onClick={() => void copyText(tc)}
          >
            <Copy size={12} />
          </button>
          <button
            className="pane-btn icon-only"
            aria-label="Go to a timecode from the clipboard"
            data-tip="Paste a timecode and go there"
            disabled={!url}
            onClick={async () => {
              const text = await readClipboard();
              if (text === null) return;
              const frames = parseAny(text, rate);
              if (frames === null) return; // not a timecode: stay where we are
              const from = parseTC(effStart ?? "00:00:00:00", rate) ?? 0;
              seekTo(Math.max(0, Math.min(duration, framesToSeconds(frames - from, rate))));
            }}
          >
            <ClipboardPaste size={12} />
          </button>
          <span className="pane-bar-spacer" />
          {/* THE TRANSPORT TAPERS (owner, 2026-09-08): play largest in the
              middle, then the frame steppers, then +/-3s, then +/-10s,
              then start and end -- each ring outward a step smaller. */}
          <button className="pane-btn icon-only player-end" aria-label="Go to start" data-tip="Start" disabled={!url} onClick={() => seekTo(0)}>
            <SkipBack size={12} />
          </button>
          <button className="pane-btn player-jump player-jump-10 mono" aria-label="Back ten seconds" data-tip="Back 10s" disabled={!url} onClick={() => jump(-10)}>
            -10s
          </button>
          <button className="pane-btn player-jump player-jump-3 mono" aria-label="Back three seconds" data-tip="Back 3s" disabled={!url} onClick={() => jump(-3)}>
            -3s
          </button>
          <button className="pane-btn icon-only" aria-label="Back one frame" data-tip="Back a frame" disabled={!url} onClick={() => step(-1)}>
            <StepBack size={14} />
          </button>
          <button
            className="pane-btn icon-only player-play"
            aria-label={playing ? "Pause" : "Play"}
            data-tip={playing ? "Pause" : "Play"}
            disabled={!url}
            onClick={togglePlay}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button className="pane-btn icon-only" aria-label="Forward one frame" data-tip="Forward a frame" disabled={!url} onClick={() => step(1)}>
            <StepForward size={14} />
          </button>
          <button className="pane-btn player-jump player-jump-3 mono" aria-label="Forward three seconds" data-tip="Forward 3s" disabled={!url} onClick={() => jump(3)}>
            +3s
          </button>
          <button className="pane-btn player-jump player-jump-10 mono" aria-label="Forward ten seconds" data-tip="Forward 10s" disabled={!url} onClick={() => jump(10)}>
            +10s
          </button>
          <button
            className="pane-btn icon-only player-end"
            aria-label="Go to end"
            data-tip="End"
            disabled={!url}
            onClick={() => seekTo(Math.max(0, duration - frame))}
          >
            <SkipForward size={12} />
          </button>
          <span className="pane-bar-spacer" />
          <span className="player-dur mono">{formatRuntime(duration)}</span>
        </div>
      </div>

      {/* THE CAPTURE ROW: one sentence for both jobs (owner, 2026-09-06:
          "I'd love a sentence that worked for both"). "Capture frame to
          [new Scene]" or "Capture frame to [selected card]" -- the one
          dropdown is the TARGET, the board's ladder as new cards and
          then the selected card; the verb and the tier fall out of it.
          The select is its own click, so choosing does not capture. */}
      <div className="player-capture">
        <button
          className="pane-btn player-capture-btn"
          disabled={!url || !board || busy || (verb === "apply" && !canApply)}
          onClick={() => void capture()}
        >
          <Camera size={14} />
          Capture frame to
          <select
            className="player-tier"
            aria-label="Where the frame goes"
            value={verb === "apply" ? "selected" : String(tierDepth)}
            disabled={!board}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "selected") setPlayerPref(bid, "verb", "apply");
              else {
                setPlayerPref(bid, "verb", "create");
                setPlayerPref(bid, "tierDepth", Number(v));
              }
            }}
          >
            {levels.map((l, i) => (
              <option key={l.id} value={i}>
                new {l.name}
              </option>
            ))}
            <option value="selected">selected card</option>
          </select>
        </button>
        {/* no hint once a card is selected (owner, 2026-09-06: the
            "onto Untitled" fragment struck); the space is held so the
            row does not jump */}
        <span className="player-capture-hint">
          {verb === "create" ? (
            <>
              Creates a new <b>{tierName.toLowerCase()}</b> card at the end of the board with the current image (if
              enabled) and selected metadata.
            </>
          ) : canApply ? (
            "\u00a0"
          ) : (
            "Select one card on the board to apply the current image (if enabled) and selected metadata to."
          )}
        </span>
      </div>

      {/* THE KNOBS (his shape, 2026-09-06): what a capture writes, then
          -- only while Timecode is on -- the rate and the start, a line
          each, indented a little. "(detected)" lives INSIDE each
          dropdown, in the dropdown's own size -- a smaller word beside
          it read as a run-on -- and each dropdown is as wide as what it
          shows. */}
      <div className="player-knobs">
        {/* CAPTURE STILL FRAME, alone on its own row above the metadata
            (owner, 2026-09-08): whether the capture hangs a picture on
            the card at all */}
        <div className="player-knob-row">
          <span className="player-knob">
            {/* a label like the row below's, so the two rows read as one
                list (his, 2026-09-08) */}
            <span className="player-knob-label mono">Include image</span>
            <label className="player-check">
              <input
                type="checkbox"
                checked={prefs.still}
                onChange={(e) => setPlayerPref(bid, "still", e.target.checked)}
              />
              Capture still frame
            </label>
          </span>
        </div>
        <div className="player-knob-row">
          <span className="player-knob">
            <span className="player-knob-label mono">Include metadata</span>
            <label className="player-check">
              <input
                type="checkbox"
                checked={prefs.stampTimecode}
                onChange={(e) => setPlayerPref(bid, "stampTimecode", e.target.checked)}
              />
              Timecode
            </label>
            <label className="player-check">
              <input
                type="checkbox"
                checked={prefs.stampRuntime}
                onChange={(e) => setPlayerPref(bid, "stampRuntime", e.target.checked)}
              />
              Playhead Runtime
            </label>
          </span>
        </div>
        {/* the rate and the start, each on its own line, indented a
            little, only while Timecode is on -- the panel is one row
            without them and three with (owner, 2026-09-06) */}
        {prefs.stampTimecode && (
          <>
            <div className="player-knob-row player-tc-row">
              <label className="player-knob">
                <span className="player-knob-label player-knob-label-rate mono">Frame rate</span>
                <AutoSelect
                  shown={rateShown}
                  value={prefs.rateLabel}
                  ariaLabel="Frame rate"
                  onChange={(v) => setPlayerPref(bid, "rateLabel", v)}
                >
                  {prefs.rateLabel === "" && (
                    <option value="" disabled>
                      Not detected (select)
                    </option>
                  )}
                  {RATES.map((r) => (
                    <option key={r.label} value={r.label}>
                      {r.label}
                      {embedded?.rate?.label === r.label ? " (detected)" : ""}
                    </option>
                  ))}
                </AutoSelect>
              </label>
            </div>
            <div className="player-knob-row player-tc-row">
              <span className="player-knob">
                <span className="player-knob-label mono">Starting TC</span>
                <AutoSelect
                  shown={prefs.followEmbedded ? startShown : "Set custom..."}
                  value={prefs.followEmbedded ? "embedded" : "custom"}
                  ariaLabel="Start timecode"
                  onChange={(v) => setPlayerPref(bid, "followEmbedded", v === "embedded")}
                >
                  <option value="embedded">{startShown}</option>
                  <option value="custom">Set custom...</option>
                </AutoSelect>
                {!prefs.followEmbedded && (
                  <input
                    className="notes-filter player-start mono"
                    value={prefs.startTC}
                    aria-label="Start timecode of the video"
                    placeholder="01:00:00:00"
                    onChange={(e) => setPlayerPref(bid, "startTC", e.target.value)}
                  />
                )}
              </span>
            </div>
          </>
        )}
      </div>

      {/* THE TAG STRIP (owner, 2026-09-06): the project's tags, the same
          ones the legend shows, as chips you ARM. A lit chip goes onto
          every card the button mints. "+ Add tag" mints one into the
          project (the legend's own op), opens its settings to name and
          color it, and arms it -- a tag made here is one you mean to
          use now. Rolls up like the legend. */}
      <div className={"player-tags" + (prefs.tagsOpen ? "" : " collapsed")} ref={tagsRef}>
        <div className="player-tags-head">
          <button
            className="legend-fold"
            aria-label={prefs.tagsOpen ? "Collapse the tags" : "Expand the tags"}
            data-tip={prefs.tagsOpen ? "Collapse tags" : "Expand tags"}
            aria-expanded={prefs.tagsOpen}
            onClick={() => setPlayerPref(bid, "tagsOpen", !prefs.tagsOpen)}
          >
            {prefs.tagsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <span className="notes-title mono">TAGS</span>
          {/* his line, and only while the strip is open -- rolled up,
              the head is just the word */}
          {prefs.tagsOpen && (
            <span className="player-tags-note">
              Any selected tags will be applied to new cards when created.
            </span>
          )}
          <span className="pane-bar-spacer" />
          {armed.size > 0 && (
            <button className="legend-clear" onClick={() => setArmed(new Set())}>
              <X size={11} /> clear
            </button>
          )}
        </div>
        {prefs.tagsOpen && (
          <div className="player-tags-row">
            {tags.map((t) => {
              const on = armed.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={"legend-item tag-chip player-tag" + (on ? " held" : "")}
                  aria-pressed={on}
                  aria-label={t.name || "Untitled tag"}
                  data-tip={on ? "Disarm" : "Arm"}
                  onClick={() =>
                    setArmed((a) => {
                      const next = new Set(a);
                      if (next.has(t.id)) next.delete(t.id);
                      else next.add(t.id);
                      return next;
                    })
                  }
                >
                  <TagSwatch tag={t} />
                  {t.name || <em className="legend-unnamed">unnamed</em>}
                </button>
              );
            })}
            <button
              className="legend-add"
              data-tip="Add tag"
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const id = ops.addTag({ name: "" });
                newTags.add(id); // so the legend's row shows it too
                setArmed((a) => new Set(a).add(id));
                tagPanel.open(id, r.left, r.top - 6, undefined, bid);
              }}
            >
              <Plus size={12} /> Add tag
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

/* A select as wide as the text it SHOWS, not its widest option: the
 * shown text is mirrored, invisible, in the same grid cell, and the
 * select fills the cell. */
function AutoSelect({
  shown,
  value,
  ariaLabel,
  onChange,
  children,
}: {
  shown: string;
  value: string;
  ariaLabel: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <span className="player-autosize">
      <span className="player-autosize-mirror" aria-hidden>
        {shown}
      </span>
      <select className="notes-filter player-autosize-select" value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </span>
  );
}
