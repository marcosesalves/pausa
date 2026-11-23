import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BreatheAround, Progress, Settings, Tip } from "../lib/types";
import { BREATH_AROUND_SECONDS, CATEGORY_IDLE, categoryLabel } from "../lib/types";
import { growthFor, pausesLabel } from "../lib/growth";
import { CAUTION_TEXT, cautionText } from "../lib/cautions";
import { getStoredPattern } from "../lib/breathePrefs";
import { isWindows } from "../lib/platform";
import { applyTheme } from "../lib/theme";
import { Icon, Spot } from "./Icon";
import { BreathingOrb, cyclesFor, findPattern } from "./BreathingOrb";
import { Companion, type CompanionState } from "./Companion";

interface FocusPayload {
  tip: Tip;
  dockInset: number;
}

/**
 * tip: the card as it arrives. doing: the pause itself. done: the completion card.
 * breath-before and breath-after: the breath the person added around the pause, in this same card.
 */
type Phase = "tip" | "breath-before" | "doing" | "breath-after" | "done";

const LEAVE_MS = 440; // matches card-sink + scrim-out in styles.css
const DOCK_GAP = 28; // space between the Dock and the card

/** The water and posture cards are reminders, not pauses: one button, no timer, nothing counted. */
const REMINDER_DONE: Record<string, string> = { water: "Had some", posture: "Done" };
const isReminder = (category: string) => category in REMINDER_DONE;

const NO_BREATH: BreatheAround = { before: false, after: false };

/** "Breathe 1 min" for the breath around a pause. */
const BREATH_LABEL = `Breathe ${Math.round(BREATH_AROUND_SECONDS / 60)} min`;

/** The breath uses the technique last picked in the Breathe tab, or the gentle Coherent before any choice. */
function breathPattern() {
  return findPattern(getStoredPattern() ?? "coherent") ?? findPattern("coherent")!;
}

/** The primary button names the order, so nobody is surprised by what it starts. */
function primaryLabel(around: BreatheAround): string {
  if (around.before) return "Breathe, then begin";
  if (around.after) return "Begin, then breathe";
  return "Take a moment";
}

/** 24 -> "0:24", 72 -> "1:12". */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "30s" -> 30, "1m" / "2 min" -> 60 / 120. Falls back to 30. */
function durationSeconds(duration: string): number {
  const m = duration.match(/(\d+)\s*(s|sec|m|min)/i);
  if (!m) return 30;
  const n = Number(m[1]);
  return /^m/i.test(m[2]) ? n * 60 : n;
}

export function FocusNotification() {
  const [payload, setPayload] = useState<FocusPayload | null>(null);
  const [phase, setPhase] = useState<Phase>("tip");
  const [leaving, setLeaving] = useState(false);
  const [run, setRun] = useState(0); // bumps on every show so animations replay
  const [settings, setSettings] = useState<Settings | null>(null);
  const [total, setTotal] = useState(0);
  const [wiggle, setWiggle] = useState(false);
  const timers = useRef<number[]>([]);
  /** True once this tip was either completed or recorded as skipped, so it is counted only once. */
  const settledRef = useRef(false);
  // The running pause or breath: how long it lasts and how many seconds are left (a ring and a clock)
  const [span, setSpan] = useState(0);
  const [left, setLeft] = useState(0);
  // "Add a breath": before and/or after this pause. Remembered per category in the settings.
  const [around, setAround] = useState<BreatheAround>(NO_BREATH);
  // Once a chip is touched, the 15 s auto-dismiss ring waits, so the card does not vanish mid-choice
  const [held, setHeld] = useState(false);
  const completeRef = useRef<() => void>(() => {});
  const skipBreathRef = useRef<() => void>(() => {});

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const show = useCallback((p: FocusPayload) => {
    clearTimers();
    settledRef.current = false;
    setPayload(p);
    setPhase("tip");
    setLeaving(false);
    setWiggle(false);
    setHeld(false);
    setRun((r) => r + 1);
    // name, "show companion", the theme, the breath choices and the growth stage can change between cards
    invoke<Settings>("get_settings")
      .then((s) => {
        setSettings(s);
        setAround(s.breathe_around?.[p.tip.category] ?? NO_BREATH);
        applyTheme(s.theme);
      })
      .catch(console.error);
    invoke<Progress>("get_progress").then((pr) => setTotal(pr.total_pauses)).catch(console.error);
  }, []);

  const dismiss = useCallback(() => {
    if (leaving) return;
    // Closed without doing it (Later, Esc, click outside, timeout): remember, quietly, to show less of this kind.
    // A water or posture reminder is not a pause, so dismissing one says nothing about a tip.
    if (payload && !settledRef.current) {
      settledRef.current = true;
      if (!isReminder(payload.tip.category)) {
        invoke("record_skip", { category: payload.tip.category, tipId: payload.tip.id }).catch(console.error);
      }
    }
    clearTimers();
    setLeaving(true);
    timers.current.push(
      window.setTimeout(() => {
        invoke("dismiss_focus").catch(console.error);
        setPayload(null);
        setLeaving(false);
      }, LEAVE_MS)
    );
  }, [leaving, payload]);

  /** "Had some" / "Done" on a reminder: close it without counting anything. */
  const acknowledge = () => {
    settledRef.current = true;
    dismiss();
  };

  // Receive tips from the backend (event) and recover one shown before we loaded (command).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<FocusPayload>("focus-show", (e) => show(e.payload)).then((u) => (unlisten = u));
    invoke<FocusPayload | null>("get_pending_focus").then((p) => p && show(p));
    return () => {
      unlisten?.();
      clearTimers();
    };
  }, [show]);

  // Esc dismisses the card; during the pause it finishes it early, and during a breath it skips it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "doing") completeRef.current();
      else if (phase === "breath-before" || phase === "breath-after") skipBreathRef.current();
      else dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss, phase]);

  // Count the running pause or breath down once a second
  const counting = phase === "doing" || phase === "breath-before" || phase === "breath-after";
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => window.clearInterval(id);
  }, [counting, phase, run]);

  const technique = findPattern(payload?.tip.technique);
  // A guided technique runs whole breath cycles, so its length comes from the pattern.
  const cycles = technique ? cyclesFor(technique, durationSeconds(payload?.tip.duration ?? "")) : 0;
  // The breath added around the pause: about a minute of whole cycles of the technique last picked in Breathe
  const breath = breathPattern();
  const breathCycles = cyclesFor(breath, BREATH_AROUND_SECONDS);
  const breathSeconds = breathCycles * breath.cycleSeconds;
  // A tip that already is a breathing technique needs no extra breath, and a reminder is not a pause
  const reminder = payload ? isReminder(payload.tip.category) : false;
  const canBreatheAround = !technique && !reminder;
  const beforeOn = canBreatheAround && around.before;
  const afterOn = canBreatheAround && around.after;

  /** The breath, in this card like the pause: a ring, a clock and a breathing Pip. */
  const startBreath = (which: "before" | "after") => {
    clearTimers();
    setWiggle(true);
    setPhase(which === "before" ? "breath-before" : "breath-after");
    setSpan(breathSeconds);
    setLeft(breathSeconds);
    timers.current.push(
      window.setTimeout(() => (which === "before" ? startPause() : setPhase("done")), breathSeconds * 1000)
    );
  };

  /** A finished pause counts once, and only here (never when dismissed with Later or Esc). */
  const complete = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    clearTimers();
    invoke<Progress>("record_pause", { category: payload?.tip.category ?? null, tipId: payload?.tip.id ?? null })
      .then((pr) => setTotal(pr.total_pauses))
      .catch(console.error);
    // The pause is counted already. A chosen breath after it comes next, then the completion card, which
    // stays until "Back to it", "Another round" or Esc (it never closes by itself).
    if (afterOn) startBreath("after");
    else setPhase("done");
  };
  completeRef.current = complete;

  /** Skip the breath: the one before leads on into the pause, the one after goes to the completion card. */
  skipBreathRef.current = () => {
    clearTimers();
    if (phase === "breath-before") startPause();
    else setPhase("done");
  };

  /** The pause itself. */
  const startPause = () => {
    if (!payload) return;
    clearTimers();
    setWiggle(true);
    setPhase("doing");
    const seconds = technique ? cycles * technique.cycleSeconds : durationSeconds(payload.tip.duration);
    setSpan(seconds);
    setLeft(seconds);
    timers.current.push(window.setTimeout(complete, seconds * 1000));
  };

  /** "Take a moment" (and "Another round"): breathe first if that was chosen, then pause. A new round can count again. */
  const begin = () => {
    if (!payload) return;
    settledRef.current = false;
    if (beforeOn) startBreath("before");
    else startPause();
  };

  /** Remember the choice for this category, and tell the settings so it is still there next time. */
  const choose = (next: BreatheAround) => {
    if (!payload) return;
    setAround(next);
    setHeld(true);
    invoke("set_breathe_around", { category: payload.tip.category, before: next.before, after: next.after }).catch(
      console.error
    );
  };

  if (!payload) return <div className="mf" />;

  const { tip, dockInset } = payload;
  // Windows: the window already stops at the taskbar, so the card sits 72 px above that edge.
  // macOS: clear the Dock (or 72 px) plus a gap.
  const cardBottom = isWindows ? 72 : Math.max(dockInset, 72) + DOCK_GAP;
  const breathing = tip.category === "breathing";
  const name = settings?.companion_name || "Pip";
  const showCompanion = settings?.show_companion ?? true;
  const growth = growthFor(total);
  const stage = growth.stage.n;

  const inBreath = phase === "breath-before" || phase === "breath-after";
  const running = phase === "doing" || inBreath;
  // What is breathing right now: the breath added around the pause, or the tip's own technique
  const active = inBreath ? breath : technique;
  const activeCycles = inBreath ? breathCycles : cycles;

  // Companion states: hello on arrival, focused while pausing, breathing in step with the orb, proud when done.
  const petState: CompanionState = phase === "done" ? "proud" : running ? (active ? "breathe" : "focused") : "hello";
  // With the companion on, breathing is shown as companion + text. Without it, the large orb.
  const orbLayout = running && !!active && !showCompanion;

  // The order of the steps, shown once a breath is chosen: Breathe 1 min, Tip 30s, Breathe 1 min
  const sequence = [
    ...(beforeOn ? [BREATH_LABEL] : []),
    `Tip ${tip.duration || ""}`.trim(),
    ...(afterOn ? [BREATH_LABEL] : []),
  ];

  return (
    <div
      key={run}
      className={`mf focus-layer${leaving ? " is-leaving" : ""}`}
      style={{ position: "fixed" }}
    >
      {/* Layer 1: tint over the native vibrancy blur. Clicking it dismisses. */}
      <div className="focus-scrim" onClick={dismiss} />

      {/* Layer 2: the card */}
      <article
        className={`focus-card glass cat cat--${tip.category}${orbLayout ? " focus-card--exercise" : ""}${held ? " is-held" : ""}`}
        data-pattern={active?.id}
        style={{ "--card-bottom": `${cardBottom}px` } as React.CSSProperties}
        role="alertdialog"
        aria-label="Pausa reminder"
        aria-live="polite"
      >
        <div className="grain" aria-hidden="true" />

        {phase === "tip" && !leaving && (
          <svg className="focus-card__timer" aria-hidden="true">
            <rect
              x="1.25"
              y="1.25"
              rx="27"
              pathLength={100}
              style={{ width: "calc(100% - 2.5px)", height: "calc(100% - 2.5px)" }}
              onAnimationEnd={dismiss}
            />
          </svg>
        )}

        <div className="focus-card__media" style={{ position: "relative", zIndex: 1 }}>
          {/* The timer ring: it drains once a second while the pause or the breath runs, and closes when it is done.
              The orb layout has its own progress ring, so it is skipped there. */}
          {(running || phase === "done") && !orbLayout && (
            <svg className="focus-card__ring" viewBox="0 0 100 100" aria-hidden="true">
              <circle className="focus-card__ring-track" cx="50" cy="50" r="48" />
              <circle
                className="focus-card__ring-bar"
                cx="50"
                cy="50"
                r="48"
                pathLength={100}
                style={{
                  strokeDashoffset: phase === "done" ? 0 : 100 - (span > 0 ? (left / span) * 100 : 0),
                }}
              />
            </svg>
          )}
          {orbLayout && active ? (
            <BreathingOrb pattern={active} cycles={activeCycles} size={170} marginBottom={0} />
          ) : showCompanion ? (
            <Companion
              state={petState}
              size={104}
              stage={stage}
              pattern={active?.id}
              react={wiggle && running ? "wiggle" : undefined}
            />
          ) : phase === "doing" && breathing ? (
            <BreathingOrb pattern={findPattern("coherent")!} cycles={99} size={84} marginBottom={0} />
          ) : (
            <Spot name={tip.category} idle={CATEGORY_IDLE[tip.category]} />
          )}
        </div>

        <div className="focus-card__body" style={{ position: "relative", zIndex: 1 }}>
          {phase === "tip" && (
            <>
              <div className="focus-card__top">
                <span className="badge">
                  <Icon name={`c-${tip.category}`} />
                  {categoryLabel(tip.category)}
                </span>
                {tip.duration && (
                  <span className="pill">
                    <Icon name="i-clock" />
                    {tip.duration}
                  </span>
                )}
                <span className="focus-card__hint">
                  <span className="kbd">esc</span> Later
                </span>
              </div>
              <p className="focus-card__text">{tip.text}</p>
              {cautionText(tip.caution) && <p className="focus-card__sub caution">{cautionText(tip.caution)}</p>}

              {/* Add a breath, before and/or after the pause. Off by default; remembered per category. */}
              {canBreatheAround && (
                <>
                  <div className="breathe-around" role="group" aria-label="Add a breath">
                    <span className="breathe-around__label">Add a breath</span>
                    <button
                      type="button"
                      className="chip-toggle"
                      role="checkbox"
                      aria-checked={around.before}
                      onClick={() => choose({ ...around, before: !around.before })}
                    >
                      <Icon name={around.before ? "i-check" : "c-breathing"} />
                      Before
                    </button>
                    <button
                      type="button"
                      className="chip-toggle"
                      role="checkbox"
                      aria-checked={around.after}
                      onClick={() => choose({ ...around, after: !around.after })}
                    >
                      <Icon name={around.after ? "i-check" : "c-breathing"} />
                      After
                    </button>
                  </div>
                  {(beforeOn || afterOn) && (
                    <ol className="breathe-seq" aria-label="Order">
                      {sequence.map((label, i) => (
                        <li key={`${label}-${i}`}>{label}</li>
                      ))}
                    </ol>
                  )}
                </>
              )}

              <div className="focus-card__actions">
                {reminder ? (
                  <button className="btn btn--primary" onClick={acknowledge} autoFocus>
                    {REMINDER_DONE[tip.category]}
                  </button>
                ) : (
                  <button className="btn btn--primary" onClick={begin} autoFocus>
                    {technique ? "Start breathing" : primaryLabel({ before: beforeOn, after: afterOn })}
                  </button>
                )}
                <button className="btn btn--ghost" onClick={dismiss}>
                  Later
                </button>
              </div>
            </>
          )}

          {running && (
            <>
              <div className="focus-card__top">
                <span className="badge">
                  <Icon name={inBreath ? "c-breathing" : `c-${tip.category}`} />
                  {inBreath
                    ? `${breath.name} breathing`
                    : technique
                      ? `${technique.name} breathing`
                      : categoryLabel(tip.category)}
                </span>
                <span className="pill" role="timer" aria-label={`${left} seconds left`}>
                  <Icon name="i-clock" />
                  {clock(left)}
                </span>
              </div>
              {active && showCompanion ? (
                <div className="breath-text" style={{ fontSize: 24 }} aria-live="off">
                  <span className="breath-text__in">{active.inhale}</span>
                  <span className="breath-text__hold">{active.hold}</span>
                  <span className="breath-text__out">Breathe out…</span>
                  <span className="breath-text__static">Breathe with {name}</span>
                </div>
              ) : (
                <p className="focus-card__text">
                  {active ? `${active.name} breathing` : breathing ? "Breathe with the orb." : "Just this moment."}
                </p>
              )}
              {!active && showCompanion && <p className="focus-card__sub">I am right here with you.</p>}
              <p className="focus-card__sub">
                {inBreath ? (phase === "breath-before" ? "A minute to settle first." : "A minute to settle after.") : technique ? technique.hint : tip.text}
              </p>
              {/* A breath that holds the breath carries its safety note, like the pause and the Breathe tab do */}
              {inBreath && breath.caution && <p className="focus-card__sub caution">{CAUTION_TEXT[breath.caution]}</p>}
              {!inBreath && cautionText(tip.caution) && (
                <p className="focus-card__sub caution">{cautionText(tip.caution)}</p>
              )}
              <div className="focus-card__actions">
                {inBreath ? (
                  <button className="btn btn--soft" onClick={() => skipBreathRef.current()} autoFocus>
                    Skip breathing
                  </button>
                ) : (
                  // One button: the pause ends by itself when the ring is empty, so this only ends it sooner
                  <button className="btn btn--primary" onClick={complete} autoFocus>
                    Finish early
                  </button>
                )}
                <span className="focus-card__hint">
                  <span className="kbd">esc</span>
                </span>
              </div>
            </>
          )}

          {phase === "done" && (
            <>
              <div className="focus-card__top">
                <span className="badge cat cat--gratitude">
                  <Icon name="i-sparkle" />
                  Complete
                </span>
                <span className="pill">
                  <Icon name="i-leaf" />+1
                </span>
              </div>
              <p className="focus-card__text">Nicely done. That counted.</p>
              <p className="focus-card__sub">
                {pausesLabel(total)}.{" "}
                {growth.remaining > 0 ? `${growth.remaining} more to grow.` : "In full bloom."}
              </p>
              <div className="focus-card__actions">
                <button className="btn btn--primary" onClick={dismiss} autoFocus>
                  Back to it
                </button>
                <button className="btn btn--soft" onClick={begin}>
                  Another round
                </button>
                <span className="focus-card__hint">
                  <span className="kbd">esc</span>
                </span>
              </div>
            </>
          )}
        </div>
      </article>
    </div>
  );
}
