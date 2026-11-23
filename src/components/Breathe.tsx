import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "./Icon";
import { Caution } from "./Caution";
import { BreathingOrb, PATTERNS, cyclesFor } from "./BreathingOrb";
import { Companion } from "./Companion";
import { CAUTION_TEXT } from "../lib/cautions";
import { growthFor } from "../lib/growth";
import type { Progress } from "../lib/types";
import { getStoredPattern, storePattern } from "../lib/breathePrefs";

/** The lengths offered in the picker, in seconds. */
const LENGTHS = [60, 120, 180] as const;

/** pick: choose a technique. ready: the orb rests until Begin. run: the session. done: the completion screen. */
type Step = "pick" | "ready" | "run" | "done";

interface BreatheProps {
  onBack: () => void;
  /** Tell the shell a session screen is open, so it can hide the navigation (a full-window session). */
  onSessionChange: (active: boolean) => void;
  showCompanion: boolean;
  stage: number;
  totalPauses: number;
}

export function Breathe({ onBack, onSessionChange, showCompanion, stage, totalPauses }: BreatheProps) {
  // The technique last picked here is remembered, and the breath a tip card adds before or after a pause
  // uses it too (before any choice: Box here, and the gentler Coherent in the card)
  const [patternId, setPatternIdState] = useState(() => getStoredPattern() ?? "box");
  const setPatternId = (id: string) => {
    setPatternIdState(id);
    storePattern(id);
  };
  const [seconds, setSeconds] = useState<number>(120);
  const [step, setStep] = useState<Step>("pick");
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0); // milliseconds of breathing so far
  const [totalAfter, setTotalAfter] = useState<number | null>(null);
  const pattern = PATTERNS.find((p) => p.id === patternId) ?? PATTERNS[0];
  const cycles = cyclesFor(pattern, seconds);
  const sessionMs = cycles * pattern.cycleSeconds * 1000;

  // The navigation is hidden while a session screen is open, and always restored on the way out
  const inSession = step === "ready" || step === "run";
  useEffect(() => {
    onSessionChange(inSession);
  }, [inSession, onSessionChange]);
  useEffect(() => () => onSessionChange(false), [onSessionChange]);

  // One clock for the orb, Pip, the number and the caption: it runs only while breathing and not paused
  useEffect(() => {
    if (step !== "run" || paused) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      setElapsed((e) => e + (now - last));
      last = now;
    }, 100);
    return () => window.clearInterval(id);
  }, [step, paused]);

  // The last breath was taken: count the pause and show the completion screen
  useEffect(() => {
    if (step !== "run" || elapsed < sessionMs) return;
    setStep("done");
    invoke<Progress>("record_pause", { category: "breathing", title: pattern.title })
      .then((p) => setTotalAfter(p.total_pauses))
      .catch(console.error);
  }, [step, elapsed, sessionMs]);

  // The orb grows and shrinks with the window, so a wide window is not mostly empty space
  const stageRef = useRef<HTMLDivElement>(null);
  const [orbSize, setOrbSize] = useState(190);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      // Leave room for the number, the caption and a caution note below, and for Pip beside the orb
      const byWidth = showCompanion ? width * 0.46 : width * 0.6;
      const byHeight = (height - 250) * 0.9;
      setOrbSize(Math.round(Math.max(150, Math.min(byWidth, byHeight, 360))));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [step, showCompanion]);

  // Where we are in the breath: which phase, and the seconds left in it
  const intoCycle = (elapsed / 1000) % pattern.cycleSeconds;
  let phaseStart = 0;
  let phase = pattern.phases[0];
  for (const p of pattern.phases) {
    if (intoCycle < phaseStart + p.secs) {
      phase = p;
      break;
    }
    phaseStart += p.secs;
  }
  const countdown = Math.max(1, Math.ceil(phaseStart + phase.secs - intoCycle - 0.001));
  const cycleNow = Math.min(cycles, Math.floor(elapsed / 1000 / pattern.cycleSeconds) + 1);
  const minutes = Math.max(1, Math.round((cycles * pattern.cycleSeconds) / 60));
  const lengthLabel = `${seconds / 60} min`;

  const toPicker = () => {
    setStep("pick");
    setPaused(false);
    setElapsed(0);
  };
  const toReady = () => {
    setStep("ready");
    setPaused(false);
    setElapsed(0);
    setTotalAfter(null);
  };
  const begin = () => {
    setElapsed(0);
    setPaused(false);
    setStep("run");
  };

  const caution = pattern.caution ? CAUTION_TEXT[pattern.caution] : null;
  const petState = step === "run" ? "breathe" : step === "done" ? "proud" : "focused";

  // ---- Technique picker ----------------------------------------------------------------------
  if (step === "pick") {
    return (
      <>
        <h2 className="view-title">Breathe</h2>
        <div className="pattern-grid" role="radiogroup" aria-label="Breathing technique">
          {PATTERNS.map((p, i) => {
            const selected = p.id === patternId;
            return (
              <button
                key={p.id}
                className="pattern-card"
                role="radio"
                aria-checked={selected}
                style={{ "--i": i } as React.CSSProperties}
                onClick={() => setPatternId(p.id)}
              >
                <span className="pattern-card__head">
                  <span className="pattern-card__name">{p.title}</span>
                  <span className="pattern-card__mark" aria-hidden="true">
                    {selected && <Icon name="i-check" />}
                  </span>
                </span>
                <span className="pattern-card__rhythm">{p.steps}</span>
                <span className="pattern-card__blurb">{p.blurb}</span>
                <svg className="pattern-card__wave" viewBox="0 0 100 22" preserveAspectRatio="none">
                  <polyline points={p.wave} />
                </svg>
              </button>
            );
          })}
        </div>

        <div className="field">
          <span className="field__label" id="breathe-length-label">
            Length
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="breathe-length-label">
            {LENGTHS.map((s) => (
              <button
                key={s}
                className="segmented__opt"
                role="radio"
                aria-checked={seconds === s}
                onClick={() => setSeconds(s)}
              >
                {s / 60} min
              </button>
            ))}
          </div>
        </div>

        {caution && <Caution>{caution}</Caution>}

        <div className="sticky-actions breathe-bar">
          <button className="btn btn--primary btn--lg" onClick={toReady}>
            <Icon name="i-play" />
            Begin {pattern.title}
          </button>
        </div>
      </>
    );
  }

  // ---- Completion ----------------------------------------------------------------------------
  if (step === "done") {
    const total = totalAfter ?? totalPauses + 1;
    const remaining = growthFor(total).remaining;
    return (
      <>
        <h2 className="view-title">Breathe</h2>
        <div className="breathe-stage" ref={stageRef}>
          <Companion state={petState} size={Math.round(orbSize * 0.7)} hidden={!showCompanion} stage={stage} />
          <p className="empty__title" style={{ marginTop: 14 }}>
            Well done.
          </p>
          <p className="empty__text">
            {cycles} cycles in {minutes} {minutes === 1 ? "minute" : "minutes"}. +1 pause,{" "}
            {remaining > 0 ? `${remaining} more to grow.` : "in full bloom."}
          </p>
        </div>
        <div className="sticky-actions breathe-bar">
          <button className="btn btn--primary" onClick={onBack} autoFocus>
            Back to it
          </button>
          <button className="btn btn--soft" onClick={toReady}>
            Breathe again
          </button>
        </div>
      </>
    );
  }

  // ---- Session: ready and running ------------------------------------------------------------
  const running = step === "run";
  return (
    <>
      <div className="breathe-head">
        <h2>{pattern.title}</h2>
        <span className="pill" aria-live="polite">
          {running ? `Cycle ${cycleNow} of ${cycles}` : lengthLabel}
        </span>
      </div>

      {/* data-pattern puts Pip's breathing in step with the orb; is-paused freezes the orb and Pip together */}
      <div
        className={`breathe-stage${paused ? " is-paused" : ""}`}
        ref={stageRef}
        data-pattern={pattern.id}
      >
        <div className="breathe-orbwrap">
          {showCompanion && (
            <div className="breathe-pip">
              <Companion
                state={petState}
                pattern={pattern.id}
                size={Math.round(orbSize * 0.42)}
                stage={stage}
              />
            </div>
          )}
          <BreathingOrb
            pattern={pattern}
            cycles={cycles}
            size={orbSize}
            marginBottom={0}
            bare
            rest={!running}
            paused={paused}
          />
        </div>

        <div className={`breathe-count${running ? "" : " is-idle"}`} aria-hidden="true">
          {running ? countdown : Math.ceil(pattern.phases[0].secs)}
        </div>
        {/* Fixed height, so a caption that wraps to two lines never moves the buttons */}
        <p className="breathe-caption" aria-live="off">
          {running ? phase.say : "Sit comfortably. Begin when you are ready."}
        </p>
        {!running && caution && <Caution>{caution}</Caution>}
      </div>

      <div className="sticky-actions breathe-bar">
        {running ? (
          <button className="btn btn--soft" onClick={() => setPaused((p) => !p)}>
            <Icon name={paused ? "i-play" : "i-pause"} />
            {paused ? "Resume" : "Pause"}
          </button>
        ) : (
          <button className="btn btn--primary btn--lg" onClick={begin}>
            <Icon name="i-play" />
            Begin {pattern.title}
          </button>
        )}
        <button className="btn btn--ghost" onClick={toPicker}>
          End
        </button>
      </div>
    </>
  );
}
