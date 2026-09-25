import { useEffect, useMemo, useRef, useState } from "react";
import { edlImport, useEdlImport } from "./edlImport";
import { edlFieldCounts, edlFieldDefs, edlSummary } from "../state/edlBoard";
import { RATES } from "../state/timecode";
import { contactSample, defaultStartFrames, planGrabs } from "../state/shotGrab";
import { grabStills, loadProxy, releaseProxy } from "./stills";

/* ------------------------------------------------------------------ *
 *  The EDL import step. See edlImport.ts for why it is its own dialog
 *  rather than a confirm, and why it is the shell Phase B's contact
 *  sheet lands in.
 *
 *  Rendered ONCE by App, above the panes, for ConfirmDialogPopover's
 *  reason: it is modal, so it must not sit inside a pane's look scope or
 *  it would inherit one board's backdrop attributes.
 *
 *  It borrows `.confirm-*` for the shell (backdrop, panel, actions) and
 *  adds only what is genuinely new -- the rate row. That keeps one modal
 *  look in the app rather than a second one that drifts, and it means
 *  the dark-chrome override block already covers everything but the two
 *  new classes.
 * ------------------------------------------------------------------ */
export function EdlImportPopover() {
  const req = useEdlImport();
  const okRef = useRef<HTMLButtonElement>(null);
  /* The rate and the ticked categories are held HERE rather than in the
   * store: both are drafts, only meaningful while the dialog is open,
   * and both are reset per dialog below so a second import never opens
   * showing the last one's choices. */
  const [rateLabel, setRateLabel] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  /* The proxy, its contact sheet, and the one number that corrects the
   * whole board. The video element is a ref rather than state: it is a
   * live decoder, not something to render, and putting it in state would
   * re-run the sheet on every unrelated keystroke. */
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoErr, setVideoErr] = useState<string | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [nudge, setNudge] = useState(0);
  /* The LIVE nudge, because two quick clicks both read `nudge` from the
   * same render and the second would throw the first away. */
  const nudgeRef = useRef(0);
  const nudgeTimer = useRef<number | null>(null);
  const [sheet, setSheet] = useState<{ url: string; n: number; secs: number }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* Bumped on every cancel/close, so an in-flight sheet or grab knows to
   * stop and to throw away what it has -- a run that finishes after its
   * dialog closed must not write anything. */
  const runId = useRef(0);

  const rate = RATES.find((r) => r.label === rateLabel) ?? req?.parse.suggestedRate ?? RATES[0];

  /* How many shots each category would actually fill, at the CURRENT
   * rate -- Duration is the one that depends on it, since a rate the
   * timecodes cannot be read at yields no duration at all. So this
   * re-counts when the picker moves, and a category that stops being
   * fillable says so immediately. */
  const counts = useMemo(
    () => (req ? edlFieldCounts(req.parse, rate) : {}),
    [req, rate],
  );

  /* Everything the proxy produced, dropped together. Called on close and
   * whenever a new file is picked, so there is never a sheet on screen
   * belonging to a video that is gone. */
  const dropVideo = () => {
    runId.current++;
    releaseProxy(videoRef.current);
    videoRef.current = null;
    setSheet((prev) => {
      prev.forEach((s) => URL.revokeObjectURL(s.url));
      return [];
    });
    setBusy(null);
  };

  useEffect(() => {
    if (!req) {
      setRateLabel(null);
      dropVideo();
      setVideoFile(null);
      setVideoErr(null);
      setNudge(0);
      nudgeRef.current = 0;
      setAspect(null);
      return;
    }
    setRateLabel(req.parse.suggestedRate.label);
    /* Tick what this file can fill. A category with nothing in it is
     * left OFF rather than hidden: seeing the format's whole set with a
     * 0 beside two of them is what says "this list has no reel names",
     * which is worth knowing and invisible if the row is not there. */
    const c = edlFieldCounts(req.parse, req.parse.suggestedRate);
    setPicked(new Set(edlFieldDefs().map((f) => f.id).filter((id) => (c[id] ?? 0) > 0)));
    /* a proxy handed in with the request (the player's open video) is
       picked at once, so the contact sheet builds without a second
       file dialog; "Choose a different video..." still stands */
    if (req.proxy) void pickVideo(req.proxy);
  }, [req]);

  /* Build the contact sheet at a given nudge.
   *
   * A SPREAD ACROSS THE WHOLE LIST, not the first twelve -- see
   * shotGrab.ts `contactSample`. The first twelve of a 500-shot board
   * are its first two minutes, and the two mistakes this exists to catch
   * look different at distance: a head offset is constant, a wrong RATE
   * compounds, so it is invisible early and obvious at the end. */
  const buildSheet = async (v: HTMLVideoElement, at: number) => {
    if (!req) return;
    const mine = ++runId.current;
    setBusy("Reading frames...");
    const rateNow = RATES.find((r) => r.label === rateLabel) ?? req.parse.suggestedRate;
    const start = defaultStartFrames(req.parse.events, rateNow);
    const plans = planGrabs(req.parse.events, { rate: rateNow, startFrames: start, nudgeFrames: at });
    const sample = contactSample(plans, 12).map((x) => x.item);
    const got = await grabStills(v, sample, { cancelled: () => runId.current !== mine });
    if (runId.current !== mine) return; // a newer run, or the dialog closed
    /* The object URLs are made OUT HERE, not inside the state updater --
     * React may call an updater twice (StrictMode does in dev), and
     * minting URLs in one is a side effect that leaks a whole set. */
    const secs = new Map(sample.map((p) => [p.index, p.seconds]));
    const next = got
      .sort((a, b) => a.index - b.index)
      .map((g) => ({
        url: URL.createObjectURL(g.blob),
        n: g.index + 1,
        secs: secs.get(g.index) ?? 0,
      }));
    setSheet((prev) => {
      prev.forEach((x) => URL.revokeObjectURL(x.url));
      return next;
    });
    setBusy(null);
  };

  const pickVideo = async (file: File) => {
    dropVideo();
    setVideoErr(null);
    setVideoFile(file);
    setBusy("Opening video...");
    try {
      const v = await loadProxy(file);
      videoRef.current = v;
      /* Measured off the decoded video rather than guessed, so 4:3
         archival and a scope master come out as their own shape. */
      setAspect(v.videoHeight > 0 ? v.videoWidth / v.videoHeight : null);
      await buildSheet(v, nudge);
    } catch (e) {
      setBusy(null);
      setVideoFile(null);
      /* The aspect goes with the video it was measured from -- without
       * this, a failed SECOND pick left the first proxy's aspect behind,
       * and an import with no video carried a measured shape. */
      setAspect(null);
      setVideoErr(e instanceof Error ? e.message : "That video could not be read.");
    }
  };

  /* THE RATE MOVES THE SHEET. Half the sheet's reason to exist is that a
   * wrong rate compounds with distance -- so correcting the rate must
   * re-grab, or the person is judging their fix against frames taken at
   * the rate they just rejected (it shipped that way: the sheet only
   * rebuilt on a nudge). Guarded on the video, so the initial rateLabel
   * set when the dialog opens builds nothing. */
  useEffect(() => {
    if (!videoRef.current || !req) return;
    void buildSheet(videoRef.current, nudgeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateLabel]);

  /* NUDGE: THE READOUT MOVES AT ONCE, THE FRAMES CATCH UP.
   *
   * Owner-reported 2026-08-28: "the nudge doesn't appear to be doing
   * anything". Two causes, and the first was mine to see -- I hit it in
   * testing and read past it. The buttons were DISABLED while a re-grab
   * ran, so a second click inside a second or two was swallowed
   * entirely; on real footage a grab takes long enough that this is most
   * clicks. And on real footage one frame looks very like the next, so
   * the only fast, unambiguous confirmation that a click landed is the
   * NUMBER changing.
   *
   * So: the buttons stay live, the count updates synchronously, and the
   * re-grab is debounced to whatever you have landed on. Holding +1 six
   * times is one grab at +6 rather than six grabs, which also stops the
   * decoder thrashing. */
  const nudgeBy = (d: number) => {
    const next = nudgeRef.current + d;
    nudgeRef.current = next;
    setNudge(next);
    if (!videoRef.current) return;
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(() => {
      nudgeTimer.current = null;
      if (videoRef.current) void buildSheet(videoRef.current, nudgeRef.current);
    }, 200);
  };

  useEffect(() => {
    if (!req) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      /* Modal, so captured and stopped -- nothing behind it may act on
       * these keys. Enter is deliberately NOT bound: the panel holds a
       * <select>, where Enter belongs to the control, and importing a
       * board is not a thing to do by accident while changing the rate. */
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        edlImport.cancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req]);

  /* THE FULL GRAB RUNS HERE, BEFORE THE DIALOG CLOSES -- not in the
   * caller after it. This is where the progress a minutes-long job needs
   * has a surface to land on (the sheet's own busy overlay), where
   * Cancel already works (runId), and where the proxy is already loaded
   * and decoded -- the caller used to re-open the file from scratch and
   * run the whole grab with nothing on screen saying anything was
   * happening. Nothing is written to any store here; the caller writes
   * the returned blobs, so a cancel mid-grab leaves no orphans. */
  const onImport = async () => {
    const r = req;
    if (!r) return;
    const v = videoRef.current;
    if (!v) {
      edlImport.accept({ rate, fields: picked });
      return;
    }
    const mine = ++runId.current;
    const start = defaultStartFrames(r.parse.events, rate);
    const plans = planGrabs(r.parse.events, {
      rate,
      startFrames: start,
      nudgeFrames: nudgeRef.current,
    });
    setBusy(`Grabbing frames... 0/${plans.length}`);
    const got = await grabStills(v, plans, {
      cancelled: () => runId.current !== mine,
      onProgress: (d, t) => setBusy(`Grabbing frames... ${d}/${t}`),
    });
    if (runId.current !== mine) return; // cancelled, or the dialog closed
    setBusy(null);
    if (!got.length && plans.length) {
      /* Every seek failed -- say so IN the dialog, where the person can
       * still decide, rather than importing a silently pictureless
       * board. Dropping the video is what makes the next Import press a
       * clean text-only import instead of a retry loop. */
      dropVideo();
      setVideoFile(null);
      setAspect(null);
      setVideoErr(
        "No frames could be grabbed from that video. Import again for the board without pictures.",
      );
      return;
    }
    edlImport.accept({ rate, fields: picked, stills: got, aspect: aspect ?? undefined });
  };

  if (!req) return null;
  const { parse, fileName } = req;
  const name = parse.title || fileName;
  const defs = edlFieldDefs();
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) edlImport.cancel();
      }}
    >
      <div className="confirm-panel edl-panel" role="dialog" aria-modal="true" aria-label="Import EDL">
        <div className="confirm-title">Import {name}?</div>
        <div className="confirm-body">{edlSummary(parse)}</div>

        <div className="edl-row">
          <label className="edl-label" htmlFor="edl-rate">
            Frame rate
          </label>
          <select
            id="edl-rate"
            className="edl-select"
            value={rate.label}
            onChange={(e) => setRateLabel(e.target.value)}
          >
            {RATES.map((r) => (
              <option key={r.label} value={r.label}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {/* Said plainly because it is the one number nothing in the file
            can confirm -- an EDL states drop-frame and never states its
            rate, so this is a guess from the largest frame field used. */}
        <div className="edl-note">
          Guessed from the timecodes &mdash; an EDL does not state its rate. Durations are read at
          this rate.
        </div>

        <div className="edl-fields-head">
          Import these categories
          <button
            className="edl-all"
            onClick={() => {
              /* All-or-nothing on the FILLABLE ones only: ticking a
                 category with nothing in it writes nothing and leaves a
                 dead row in everyone's panel. */
              const fillable = defs.filter((f) => (counts[f.id] ?? 0) > 0).map((f) => f.id);
              setPicked(picked.size >= fillable.length ? new Set() : new Set(fillable));
            }}
          >
            {/* The label is what the CLICK does -- with 3 of 7 ticked it
                says "all", because that is what pressing it selects. It
                used to say "none" for any non-empty set while doing the
                opposite. */}
            {picked.size >= defs.filter((f) => (counts[f.id] ?? 0) > 0).length ? "none" : "all"}
          </button>
        </div>
        <div className="edl-fields">
          {defs.map((f) => {
            const n = counts[f.id] ?? 0;
            return (
              <label key={f.id} className={"edl-field" + (n ? "" : " empty")}>
                <input
                  type="checkbox"
                  checked={picked.has(f.id)}
                  disabled={!n}
                  onChange={() => toggle(f.id)}
                />
                <span className="edl-field-name">{f.name}</span>
                {/* The count is what makes this a choice rather than a
                    guess: a category reading 0 is one you can see is
                    pointless BEFORE importing it. */}
                <span className="edl-field-count">{n ? n : "none"}</span>
              </label>
            );
          })}
        </div>

        <div className="edl-fields-head">
          Frames from a proxy
          <span className="edl-optional">optional</span>
        </div>
        <div className="edl-video">
          <button className="edl-pick" onClick={() => fileRef.current?.click()}>
            {videoFile ? "Choose a different video..." : "Choose an H.264 .mp4..."}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/quicktime,video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void pickVideo(f);
            }}
          />
          {videoFile && <span className="edl-video-name">{videoFile.name}</span>}
        </div>
        {videoErr && <div className="edl-error">{videoErr}</div>}
        {!videoFile && !videoErr && (
          <div className="edl-note">
            The whole sequence, no slate or countdown &mdash; anything on the head shifts every
            card. Skip this and you get the cards without pictures.
          </div>
        )}

        {(sheet.length > 0 || busy) && (
          <>
            {/* THE OFFSET CHECK. An offset error is UNIFORM -- a
                mis-stated sequence start or a slate on the head shifts
                every shot by the same amount -- so one control fixes the
                whole board. Look at twelve, nudge once, and all of them
                are right. */}
            <div className="edl-sheet">
              {sheet.map((f) => (
                <figure key={f.url} className="edl-frame">
                  <img src={f.url} alt="" />
                  {/* THE SHOT, AND WHERE IN THE PROXY IT WAS TAKEN.
                    The time is here because of the owner's report that
                    the nudge "doesn't really work" (2026-08-28): on real
                    footage a frame or two apart looks identical, so the
                    picture alone cannot show that anything moved. The
                    number can, and it moves on every single nudge. */}
                <figcaption>
                  <span className="edl-frame-n">{f.n}</span>
                  <span className="edl-frame-t">{f.secs.toFixed(2)}s</span>
                </figcaption>
                </figure>
              ))}
              {busy && <div className="edl-busy">{busy}</div>}
            </div>
            <div className="edl-row edl-nudge">
              <span className="edl-label">Nudge</span>
              <button className="edl-step" onClick={() => nudgeBy(-10)}>
                -10
              </button>
              <button className="edl-step" onClick={() => nudgeBy(-1)}>
                -1
              </button>
              <span className="edl-nudge-val">{nudge > 0 ? `+${nudge}` : nudge} f</span>
              <button className="edl-step" onClick={() => nudgeBy(1)}>
                +1
              </button>
              <button className="edl-step" onClick={() => nudgeBy(10)}>
                +10
              </button>
              {nudge !== 0 && (
                <button className="edl-step" onClick={() => nudgeBy(-nudgeRef.current)}>
                  reset
                </button>
              )}
            </div>
            <div className="edl-note">
              Each frame is numbered by its shot. If they are all showing the shot BEFORE, nudge
              forward.
            </div>
          </>
        )}

        <div className="confirm-actions">
          <button
            className="confirm-btn"
            onClick={() => {
              dropVideo();
              edlImport.cancel();
            }}
          >
            Cancel
          </button>
          <button
            ref={okRef}
            className="confirm-btn confirm-go"
            disabled={!!busy}
            onClick={() => void onImport()}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
