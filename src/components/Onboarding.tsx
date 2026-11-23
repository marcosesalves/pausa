import { useState } from "react";
import type { Settings } from "../lib/types";
import { CATEGORIES, INTERVALS } from "../lib/types";
import { everyLabel } from "../hooks/useNextNudge";
import { isWindows, platformName } from "../lib/platform";
import { THEME_OPTIONS, applyTheme } from "../lib/theme";
import { CategoryPicker } from "./CategoryPicker";
import { Companion } from "./Companion";

interface OnboardingProps {
  settings: Settings;
  onFinish: (settings: Settings) => void;
}

type StepId = "meet" | "rhythm" | "categories" | "pin";

/** Pinning to the taskbar is a Windows idea, so the Mac gets three steps. */
const STEPS: StepId[] = isWindows ? ["meet", "rhythm", "categories", "pin"] : ["meet", "rhythm", "categories"];

/** "an hour", "15 minutes": how long until the first nudge. */
function firstNudge(minutes: number): string {
  if (minutes === 60) return "an hour";
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** First launch: meet Pip, pick a rhythm, pick categories, and (on Windows) keep Pip on the taskbar. */
export function Onboarding({ settings, onFinish }: OnboardingProps) {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Settings>({ ...settings, companion_name: "Pip" });

  const step = STEPS[index];
  const name = draft.companion_name.trim() || "Pip";
  const update = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const isLast = index === STEPS.length - 1;

  const finish = () =>
    onFinish({
      ...draft,
      companion_name: name,
      onboarded: true,
      // never leave a first-time user with zero categories: Home would show "No categories picked"
      selected_categories:
        draft.selected_categories.length > 0 ? draft.selected_categories : [...CATEGORIES],
    });

  const next = () => (isLast ? finish() : setIndex((i) => i + 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  return (
    <div className="onboarding">
      <div className="onboarding__progress">
        <div className="onboarding__segs" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span key={i} className={i <= index ? "is-done" : ""} />
          ))}
        </div>
        <span className="onboarding__count">
          Step {index + 1} of {STEPS.length}
        </span>
      </div>

      <div className="onboarding__body">
        {step === "meet" && (
          <div className="onboarding__center">
            <Companion state="hello" size={132} />
            <h2 className="onboarding__title">Meet {name}</h2>
            <p className="empty__text" style={{ maxWidth: 280, fontSize: 14 }}>
              I am a small sprout. Now and then I will nudge you to pause, and I will take the pause with you.
            </p>
            {/* Light or dark, shown at once so the choice can be seen before moving on */}
            <div className="onboarding__look">
              <span className="field__label" id="onboarding-look-label">
                Light or dark?
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby="onboarding-look-label">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className="segmented__opt"
                    role="radio"
                    aria-checked={draft.theme === option.value}
                    onClick={() => {
                      update({ theme: option.value });
                      applyTheme(option.value);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="note">
                {draft.theme === "system"
                  ? `System follows ${platformName}. You can change this later in Settings.`
                  : "You can change this later in Settings."}
              </p>
            </div>
          </div>
        )}

        {step === "rhythm" && (
          <>
            <div className="companion-hero" style={{ padding: 0 }}>
              <Companion state="waiting" size={72} />
              <h2 style={{ font: "600 20px/1.2 var(--font-display)", flex: 1 }}>
                How often should I tap you on the shoulder?
              </h2>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Reminder frequency">
              {INTERVALS.map((interval) => (
                <button
                  key={interval.value}
                  className="segmented__opt"
                  role="radio"
                  aria-checked={draft.interval_minutes === interval.value}
                  aria-label={interval.label}
                  onClick={() => update({ interval_minutes: interval.value })}
                >
                  {interval.short}
                </button>
              ))}
            </div>
            <p className="status-pill" role="status">
              {everyLabel(draft.interval_minutes)}. First nudge in about {firstNudge(draft.interval_minutes)}.
            </p>
            <div className="bento-card" style={{ gap: 10 }}>
              <div className="toggle-row">
                <span className="toggle-row__label">Rest at night</span>
                <button
                  className="toggle"
                  role="switch"
                  aria-label="Rest at night"
                  aria-checked={draft.quiet_hours_enabled}
                  onClick={() => update({ quiet_hours_enabled: !draft.quiet_hours_enabled })}
                />
              </div>
              {draft.quiet_hours_enabled && (
                <div className="quiet-hours-times">
                  <label className="time-input">
                    <span>From</span>
                    <input
                      type="time"
                      value={draft.quiet_hours_start}
                      onChange={(e) => update({ quiet_hours_start: e.target.value })}
                    />
                  </label>
                  <label className="time-input">
                    <span>Until</span>
                    <input
                      type="time"
                      value={draft.quiet_hours_end}
                      onChange={(e) => update({ quiet_hours_end: e.target.value })}
                    />
                  </label>
                </div>
              )}
              <p className="note">
                {name} stays quiet between {draft.quiet_hours_start} and {draft.quiet_hours_end}
                {draft.quiet_hours_enabled ? "." : " once this is on."} You can change this later.
              </p>
            </div>
          </>
        )}

        {step === "categories" && (
          <CategoryPicker
            title="Pick what you like"
            intro="Choose any number. You can change this in Settings."
            selected={draft.selected_categories}
            onChange={(selected) => update({ selected_categories: selected })}
          />
        )}

        {step === "pin" && (
          <>
            <h2 className="onboarding__title" style={{ textAlign: "left" }}>
              Keep {name} on your taskbar
            </h2>
            <p className="note" style={{ fontSize: 13 }}>
              Windows tucks new icons under the arrow. Pinning keeps {name} one click away.
            </p>
            {/* A small picture of the ^ flyout above the taskbar, and the icon being dragged out of it */}
            <svg className="onboarding__pin" viewBox="0 0 320 150" role="img" aria-label="The tray arrow above the taskbar, with Pausa inside its flyout">
              <rect x="0" y="0" width="320" height="150" rx="14" className="onboarding__pin-bg" />
              <rect x="190" y="14" width="112" height="70" rx="10" className="onboarding__pin-fly" />
              {[0, 1, 2].map((c) =>
                [0, 1].map((r) => (
                  <rect
                    key={`${c}${r}`}
                    x={202 + c * 32}
                    y={26 + r * 28}
                    width="24"
                    height="22"
                    rx="5"
                    className={c === 0 && r === 0 ? "onboarding__pin-pip" : "onboarding__pin-cell"}
                  />
                ))
              )}
              <path d="M214 56 L186 104" className="onboarding__pin-drag" />
              <rect x="16" y="104" width="288" height="30" rx="8" className="onboarding__pin-bar" />
              {[0, 1, 2].map((i) => (
                <rect key={i} x={60 + i * 34} y="109" width="22" height="20" rx="5" className="onboarding__pin-cell" />
              ))}
            </svg>
            <ol className="onboarding__list">
              <li>
                <span className="onboarding__num">1</span>
                Select the ^ at the right of the taskbar.
              </li>
              <li>
                <span className="onboarding__num">2</span>
                Drag the Pausa icon up onto the taskbar.
              </li>
            </ol>
          </>
        )}
      </div>

      <div className="shell__bar">
        {index > 0 && step !== "pin" && (
          <button className="btn btn--ghost" onClick={back}>
            Back
          </button>
        )}
        {step === "pin" && (
          <button className="btn btn--ghost" onClick={finish}>
            Skip for now
          </button>
        )}
        {/* key restarts the autofocus on every step: Enter continues, Esc does nothing */}
        <button key={step} className="btn btn--primary btn--lg" style={{ flex: 1 }} onClick={next} autoFocus>
          {step === "pin" ? "All set" : "Continue"}
        </button>
      </div>
    </div>
  );
}
