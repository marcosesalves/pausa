import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Settings as SettingsType } from "../lib/types";
import { CATEGORIES, INTERVALS, POSTURE_INTERVALS, WATER_INTERVALS, categoryLabel } from "../lib/types";
import { THEME_OPTIONS } from "../lib/theme";
import { useClickSettings } from "../hooks/useClickSettings";
import { everyLabel, nudgePhrase } from "../hooks/useNextNudge";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "../lib/links";
import { isMac, isWindows, platformName, trayName } from "../lib/platform";
import { CategoryPicker } from "./CategoryPicker";
import { Icon } from "./Icon";

interface SettingsProps {
  settings: SettingsType;
  onUpdate: (settings: SettingsType) => void;
  /** When the next reminder is due (Unix seconds), so a changed interval can say what it did. */
  nextNudgeAt: number | null;
  /** Open straight on the categories picker (from Home's "Choose categories"). */
  startInCategories?: boolean;
  onOpenFeedback: (kind: "bug" | "feedback") => void;
}

/** One of the small reminders: a switch, and its rhythm once it is on. */
function ReminderRow({
  label,
  hint,
  on,
  onToggle,
  intervals,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
  intervals: readonly { label: string; short: string; value: number }[];
  value: number;
  onChange: (minutes: number) => void;
}) {
  return (
    <>
      <div className="toggle-row">
        <span className="toggle-row__label">{label}</span>
        <button className="toggle" role="switch" aria-label={label} aria-checked={on} onClick={onToggle} />
      </div>
      {on && (
        <div className="segmented" role="radiogroup" aria-label={`${label}: how often`}>
          {intervals.map((interval) => (
            <button
              key={interval.value}
              className="segmented__opt"
              role="radio"
              aria-checked={value === interval.value}
              aria-label={interval.label}
              onClick={() => onChange(interval.value)}
            >
              {interval.short}
            </button>
          ))}
        </div>
      )}
      <p className="note">{hint}</p>
    </>
  );
}

export function Settings({ settings, onUpdate, nextNudgeAt, startInCategories = false, onOpenFeedback }: SettingsProps) {
  const name = settings.companion_name || "Pip";
  const click = useClickSettings();
  const [editingCategories, setEditingCategories] = useState(startInCategories);
  const [draft, setDraft] = useState<string[]>(settings.selected_categories);
  const [showPin, setShowPin] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // The breath around pauses, per category. A category with neither chosen is simply left out of the list.
  const setBreath = (category: string, next: { before: boolean; after: boolean }) => {
    const map = { ...(settings.breathe_around ?? {}) };
    if (next.before || next.after) map[category] = next;
    else delete map[category];
    onUpdate({ ...settings, breathe_around: map });
  };
  const withBreath = Object.keys(settings.breathe_around ?? {}).length;

  const handleToggle = (key: keyof SettingsType, value: boolean) => {
    onUpdate({ ...settings, [key]: value });
  };

  const setClose = (behavior: "tray" | "quit") =>
    onUpdate({ ...settings, close_behavior: behavior, close_notice_seen: true });

  // ---- The categories picker (Edit categories) -----------------------------------------------
  if (editingCategories) {
    return (
      <>
        <CategoryPicker
          title="Categories"
          intro={`Choose any you like. ${name} picks tips from these.`}
          selected={draft}
          onChange={setDraft}
        />
        <div className="sticky-actions pinned-bar">
          <button
            className="btn btn--primary btn--lg"
            onClick={() => {
              onUpdate({ ...settings, selected_categories: draft });
              setEditingCategories(false);
            }}
          >
            Save · {draft.length} selected
          </button>
        </div>
      </>
    );
  }

  // What the interval means right now, announced politely when it changes
  const every = everyLabel(settings.interval_minutes);
  const intervalNote = settings.paused
    ? `${every}. Reminders are paused.`
    : nextNudgeAt
      ? `${every}. Next nudge ${nudgePhrase(nextNudgeAt, true)}.`
      : `${every}.`;

  return (
    <>
      <div className="view-head">
        <h2 className="view-title">Settings</h2>
      </div>

      <div className="settings">
        <section className="bento-card bento-card--wide">
          <h3 className="settings-heading">
            Remind me every
            <Icon name="i-clock" />
          </h3>
          <div className="segmented" role="radiogroup" aria-label="Reminder frequency">
            {INTERVALS.map((interval) => (
              <button
                key={interval.value}
                className="segmented__opt"
                role="radio"
                aria-checked={settings.interval_minutes === interval.value}
                aria-label={interval.label}
                onClick={() => onUpdate({ ...settings, interval_minutes: interval.value })}
              >
                {interval.short}
              </button>
            ))}
          </div>
          <p className="status-pill" role="status">
            {intervalNote}
          </p>
        </section>

        <section id="settings-reminders" className="bento-card bento-card--wide">
          <h3 className="settings-heading">
            Small reminders
            <Icon name="c-water" />
          </h3>
          <ReminderRow
            label="Drink water"
            hint={`${name} gives you a gentle nudge to have some water.`}
            on={settings.water_reminder}
            onToggle={() => handleToggle("water_reminder", !settings.water_reminder)}
            intervals={WATER_INTERVALS}
            value={settings.water_interval_minutes}
            onChange={(minutes) => onUpdate({ ...settings, water_interval_minutes: minutes })}
          />
          <ReminderRow
            label="Check my posture"
            hint="A reminder to drop your shoulders, unclench your jaw and sit comfortably."
            on={settings.posture_reminder}
            onToggle={() => handleToggle("posture_reminder", !settings.posture_reminder)}
            intervals={POSTURE_INTERVALS}
            value={settings.posture_interval_minutes}
            onChange={(minutes) => onUpdate({ ...settings, posture_interval_minutes: minutes })}
          />
          <p className="note">
            These are separate from your pauses: they stay quiet while Pausa is paused and during quiet hours,
            and they do not count towards your garden.
          </p>
        </section>

        <section id="settings-breath" className="bento-card bento-card--wide">
          <h3 className="settings-heading">
            Add a breath
            <Icon name="c-breathing" />
          </h3>
          <p className="note">
            On a tip card you can add a one-minute breath before or after the pause. It is off unless you choose
            it, and it is remembered for each category. You can set it here too.
          </p>
          <details>
            <summary className="note" style={{ cursor: "pointer" }}>
              Choose for each category ({withBreath} of {CATEGORIES.length} have a breath)
            </summary>
            <div className="breath-rows">
              {CATEGORIES.map((category) => {
                const a = settings.breathe_around?.[category] ?? { before: false, after: false };
                return (
                  <div className="breath-row" key={category}>
                    <span className={`cat cat--${category} cat-card__icon`} aria-hidden="true">
                      <Icon name={`c-${category}`} />
                    </span>
                    <span className="breath-row__name">{categoryLabel(category)}</span>
                    <button
                      type="button"
                      className="chip-toggle"
                      role="checkbox"
                      aria-checked={a.before}
                      aria-label={`${categoryLabel(category)}: breathe before`}
                      onClick={() => setBreath(category, { ...a, before: !a.before })}
                    >
                      <Icon name={a.before ? "i-check" : "c-breathing"} />
                      Before
                    </button>
                    <button
                      type="button"
                      className="chip-toggle"
                      role="checkbox"
                      aria-checked={a.after}
                      aria-label={`${categoryLabel(category)}: breathe after`}
                      onClick={() => setBreath(category, { ...a, after: !a.after })}
                    >
                      <Icon name={a.after ? "i-check" : "c-breathing"} />
                      After
                    </button>
                  </div>
                );
              })}
            </div>
          </details>
        </section>

        <section
          id="settings-quiet-hours"
          className={`bento-card bento-card--wide${settings.quiet_hours_enabled ? "" : " is-off"}`}
        >
          <h3 className="settings-heading">
            Quiet hours
            <Icon name="i-moon" />
          </h3>
          <div className="toggle-row">
            <span className="toggle-row__label">Rest at night</span>
            <button
              className="toggle"
              role="switch"
              aria-label="Rest at night"
              aria-checked={settings.quiet_hours_enabled}
              onClick={() => handleToggle("quiet_hours_enabled", !settings.quiet_hours_enabled)}
            />
          </div>
          {settings.quiet_hours_enabled && (
            <>
              <div className="quiet-hours-times">
                <label className="time-input">
                  <span>From</span>
                  <input
                    type="time"
                    value={settings.quiet_hours_start}
                    onChange={(e) => onUpdate({ ...settings, quiet_hours_start: e.target.value })}
                  />
                </label>
                <label className="time-input">
                  <span>Until</span>
                  <input
                    type="time"
                    value={settings.quiet_hours_end}
                    onChange={(e) => onUpdate({ ...settings, quiet_hours_end: e.target.value })}
                  />
                </label>
              </div>
              <p className="note">
                {name} stays quiet between {settings.quiet_hours_start} and {settings.quiet_hours_end}.
              </p>
            </>
          )}
        </section>

        <section className="bento-card bento-card--wide">
          <h3 className="settings-heading">
            Appearance
            <Icon name="i-sun" />
          </h3>
          <div className="segmented" role="radiogroup" aria-label="Light or dark">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                className="segmented__opt"
                role="radio"
                aria-checked={settings.theme === option.value}
                onClick={() => onUpdate({ ...settings, theme: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="note">
            {settings.theme === "system"
              ? `Pausa follows ${platformName}'s light or dark mode.`
              : `Pausa stays ${settings.theme}, whatever ${platformName} is set to.`}
          </p>
        </section>

        <section className="bento-card bento-card--wide">
          <h3 className="settings-heading">
            {platformName}
            <Icon name="i-power" />
          </h3>
          <div className="toggle-row">
            <span className="toggle-row__label">
              {isWindows ? "Launch Pausa when I sign in" : "Launch Pausa at login"}
            </span>
            <button
              className="toggle"
              role="switch"
              aria-label={isWindows ? "Launch Pausa when I sign in" : "Launch Pausa at login"}
              aria-checked={settings.launch_at_login}
              onClick={() => handleToggle("launch_at_login", !settings.launch_at_login)}
            />
          </div>
          <span className="field__label" id="close-behavior-label">
            When I close the window
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="close-behavior-label">
            <button
              className="segmented__opt"
              role="radio"
              aria-checked={settings.close_behavior !== "quit"}
              onClick={() => setClose("tray")}
            >
              Keep in {trayName}
            </button>
            <button
              className="segmented__opt"
              role="radio"
              aria-checked={settings.close_behavior === "quit"}
              onClick={() => setClose("quit")}
            >
              Quit
            </button>
          </div>
          {isMac && (
            <>
              {/* What Pausa did about the Mac's click settings, in plain words */}
              {click.secondaryClick ? (
                <p className="note">
                  Click the menu bar icon to show or hide Pausa. Secondary-click it (two fingers, or hold Control
                  and click) for its menu.
                </p>
              ) : (
                <p className="note">
                  Secondary click is off in your Mac's settings, so clicking the menu bar icon opens Pausa's menu,
                  which starts with Show Pausa. Turn it on in System Settings, Trackpad, to show or hide the window
                  with one click.
                </p>
              )}
              {!click.tapToClick && (
                <p className="note">
                  Tap to click is off in your Mac's settings, so press the trackpad until it clicks. You can turn
                  it on in System Settings, Trackpad.
                </p>
              )}
            </>
          )}
          {isWindows && (
            <>
              <div className="settings-row">
                <span className="note">Taskbar button: pin it to keep it handy.</span>
                <button
                  className="btn btn--soft btn--sm"
                  aria-expanded={showPin}
                  onClick={() => setShowPin((v) => !v)}
                >
                  How to pin
                </button>
              </div>
              {showPin && (
                <p className="note">
                  Windows tucks new icons under the ^ arrow at the right of the taskbar. Drag the Pausa icon up
                  onto the taskbar to keep it in view, or right-click Pausa's taskbar button and choose Pin to
                  taskbar.
                </p>
              )}
            </>
          )}
        </section>

        <section className="bento-card bento-card--wide">
          <h3 className="settings-heading">
            {name}
            <svg className="icon" aria-hidden="true">
              <use href="#pet-calm" />
            </svg>
          </h3>
          <div className="toggle-row">
            <span className="toggle-row__label">Show {name}</span>
            <button
              className="toggle"
              role="switch"
              aria-label={`Show ${name}`}
              aria-checked={settings.show_companion}
              onClick={() => handleToggle("show_companion", !settings.show_companion)}
            />
          </div>
          <p className="note">Turn off for a plain, character-free Pausa.</p>
          {settings.show_companion && (
            <label className="time-input">
              <span>Name</span>
              <input
                type="text"
                maxLength={12}
                value={settings.companion_name}
                placeholder="Pip"
                aria-label="Companion name"
                onChange={(e) => onUpdate({ ...settings, companion_name: e.target.value })}
                // an empty name would break "Show ___" and the copy: fall back to Pip when leaving the field
                onBlur={(e) => {
                  if (!e.target.value.trim()) onUpdate({ ...settings, companion_name: "Pip" });
                }}
              />
            </label>
          )}
        </section>

        <section id="settings-categories" className="bento-card bento-card--wide">
          <h3 className="settings-heading">
            Categories
            <Icon name="i-leaf" />
          </h3>
          {/* The same tinted icons as in the picker, so the two look alike */}
          <div className="cat-dots" role="list" aria-label="Chosen categories">
            {settings.selected_categories.map((c) => (
              <span
                key={c}
                role="listitem"
                className={`cat cat--${c} cat-card__icon`}
                title={categoryLabel(c)}
                aria-label={categoryLabel(c)}
              >
                <Icon name={`c-${c}`} />
              </span>
            ))}
          </div>
          <div className="settings-row">
            <span className="note">
              {settings.selected_categories.length} of {CATEGORIES.length} selected
            </span>
            <button
              className="btn btn--soft btn--sm"
              onClick={() => {
                setDraft(settings.selected_categories);
                setEditingCategories(true);
              }}
            >
              Edit categories
            </button>
          </div>
        </section>

        <section className="bento-card bento-card--wide">
          <details>
            <summary className="settings-heading" style={{ cursor: "pointer" }}>
              About Pausa and your wellbeing
              <Icon name="i-warn" />
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              <p className="note">
                Pausa offers small, gentle pauses. It is not a medical tool and does not give medical advice.
              </p>
              <p className="note">
                Stop any exercise that feels uncomfortable. Skip breath holds, or choose a long exhale, if you
                have a heart or breathing condition or feel dizzy.
              </p>
              <p className="note">
                If you're struggling, please talk to someone you trust or a professional. If you may be in
                danger, contact your local emergency number.
              </p>
            </div>
          </details>
        </section>

        <section className="bento-card bento-card--wide">
          <h3 className="settings-heading">
            Feedback
            <Icon name="i-sparkle" />
          </h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn--soft" style={{ flex: 1 }} onClick={() => onOpenFeedback("feedback")}>
              Give feedback
            </button>
            <button className="btn btn--soft" style={{ flex: 1 }} onClick={() => onOpenFeedback("bug")}>
              Report a bug
            </button>
          </div>
          <button
            className="btn btn--ghost"
            onClick={() => onUpdate({ ...settings, onboarded: false })}
            title="Go through the welcome steps again"
          >
            Show the welcome again
          </button>
        </section>

        <section className="bento-card bento-card--wide">
          <h3 className="settings-heading">
            Stay in touch
            <Icon name="i-leaf" />
          </h3>
          <p className="note">News and small updates about Pausa and Pip, at {INSTAGRAM_HANDLE}.</p>
          <button
            className="btn btn--soft"
            // opens in your browser; nothing from Instagram is loaded inside Pausa
            onClick={() => openUrl(INSTAGRAM_URL).catch(console.error)}
          >
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17" cy="7" r=".6" />
            </svg>
            Follow on Instagram
          </button>
        </section>

        <p className="note settings-version">
          Pausa {version} · {platformName}
        </p>
      </div>
    </>
  );
}
