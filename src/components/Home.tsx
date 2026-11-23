import { Companion, type CompanionState } from "./Companion";
import { Icon } from "./Icon";
import { TipDisplay } from "./TipDisplay";
import { growthFor } from "../lib/growth";
import { everyLabel, nudgePhrase } from "../hooks/useNextNudge";
import type { Settings, Tip } from "../lib/types";

/** What Home is showing. The first match wins: paused, quiet hours, no categories, loading, a tip. */
export type HomeState = "paused" | "quiet" | "no-categories" | "loading" | "tip";

export function homeStateOf(settings: Settings, quiet: boolean, fetching: boolean): HomeState {
  if (settings.paused) return "paused";
  if (quiet) return "quiet";
  if (settings.selected_categories.length === 0) return "no-categories";
  if (fetching) return "loading";
  return "tip";
}

interface HomeProps {
  state: HomeState;
  settings: Settings;
  tip: Tip | null;
  /** When the next reminder is due (Unix seconds), or null if not known yet. */
  nextNudgeAt: number | null;
  totalPauses: number;
  showCompanion: boolean;
  stage: number;
  onNextTip: () => void;
  /** Take a moment on the tip that is showing (inside the tip card). */
  onTakeAMoment: (tip: Tip) => void;
  /** Take a moment from the screens that have no tip on show; it fetches one first. */
  onTakeAMomentNow: () => void;
  onResume: () => void;
  onChangeHours: () => void;
  onChooseCategories: () => void;
  onOpenGarden: () => void;
}

/**
 * Home: Pip and the current tip on the left, and from 640 px wide the "Next nudge" and Garden cards on
 * the right. The buttons sit inside the tip card; the screens without a tip (paused, quiet hours, no
 * categories) carry their own under their text. Recent tips is an icon in the header, set by the page.
 */
export function Home({
  state,
  settings,
  tip,
  nextNudgeAt,
  totalPauses,
  showCompanion,
  stage,
  onNextTip,
  onTakeAMoment,
  onTakeAMomentNow,
  onResume,
  onChangeHours,
  onChooseCategories,
  onOpenGarden,
}: HomeProps) {
  const name = settings.companion_name || "Pip";
  const growth = growthFor(totalPauses);
  const end = settings.quiet_hours_end;

  // The screens without a tip use the tip's own compact layout: Pip beside the headline, then the buttons.
  // The state is the headline (a sleeping Pip, a Resume button and a sleeping sprout in the header already say
  // "paused", so no separate banner row is needed), and the whole thing costs about as much height as a tip.
  const compact = (pip: CompanionState, line: string, sub: string, actions: React.ReactNode) => (
    <div role="status">
      <div className="companion-hero">
        <Companion state={pip} size={72} hidden={!showCompanion} stage={stage} />
        <div>
          <p className="companion-hero__line">{line}</p>
          <p className="companion-hero__sub">{sub}</p>
        </div>
      </div>
      <div className="home-actions">{actions}</div>
    </div>
  );

  let body: React.ReactNode;
  if (state === "paused") {
    // Take a moment works even while paused, so it is always here
    body = compact(
      "sleepy",
      "Reminders paused",
      "I will be here. Pick back up whenever you like.",
      <>
        <button className="btn btn--primary" onClick={onResume}>
          Resume reminders
        </button>
        <button className="btn btn--soft" onClick={onTakeAMomentNow}>
          Take a moment
        </button>
      </>
    );
  } else if (state === "quiet") {
    body = compact(
      "sleepy",
      "Resting till morning.",
      `Quiet hours, ${settings.quiet_hours_start} to ${end}. ${name} won't bother you until then.`,
      <>
        <button className="btn btn--primary" onClick={onTakeAMomentNow}>
          Take a moment
        </button>
        <button className="btn btn--soft" onClick={onChangeHours}>
          Change hours
        </button>
      </>
    );
  } else if (state === "no-categories") {
    body = compact(
      "calm",
      "No categories picked",
      "I will use Breathing until you choose.",
      <>
        <button className="btn btn--primary" onClick={onTakeAMomentNow}>
          Take a moment
        </button>
        <button className="btn btn--soft" onClick={onChooseCategories}>
          Choose categories
        </button>
      </>
    );
  } else if (state === "loading") {
    body = (
      <div className="empty" role="status" aria-busy="true">
        <Companion state="focused" size={88} hidden={!showCompanion} stage={stage} />
        <span className="loader" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <p className="empty__text">Finding a tip for you…</p>
      </div>
    );
  } else {
    body = (
      <TipDisplay
        currentTip={tip}
        onNextTip={onNextTip}
        onTakeAMoment={onTakeAMoment}
        showCompanion={showCompanion}
        stage={stage}
        waitingSub={nextNudgeAt ? `Next nudge ${nudgePhrase(nextNudgeAt)}.` : undefined}
      />
    );
  }

  // The "Next nudge" card
  let big: string;
  let sub: string;
  if (state === "paused") {
    big = "Paused";
    sub = "Reminders are off until you resume.";
  } else if (state === "quiet") {
    big = `at ${end}`;
    sub = `Quiet hours until ${end}.`;
  } else {
    big = nextNudgeAt ? nudgePhrase(nextNudgeAt) : "soon";
    sub = `${everyLabel(settings.interval_minutes)}.${
      settings.quiet_hours_enabled ? ` Quiet ${settings.quiet_hours_start} to ${end}.` : ""
    }`;
  }

  return (
    <div className="home">
      <div className="home__main">
        {/* One white card holds everything in the main area: Pip, the headline, the tip and its buttons */}
        <section className="home-main-card">{body}</section>
      </div>

      <aside className="home__side" aria-label="At a glance">
        <section className="home-card">
          <h3>Next nudge</h3>
          <p className="home-card__big">{big}</p>
          <p className="home-card__sub">{sub}</p>
        </section>
        <button className="home-card home-card--link" onClick={onOpenGarden}>
          <h3>
            <Icon name="i-leaf" />
            Garden
          </h3>
          <p className="home-card__strong">
            {growth.remaining > 0
              ? `${growth.remaining} more ${growth.remaining === 1 ? "pause" : "pauses"} to grow`
              : growth.stage.line}
          </p>
          <span className="home-meter" aria-hidden="true">
            <span style={{ width: `${Math.round(growth.fraction * 100)}%` }} />
          </span>
        </button>
      </aside>
    </div>
  );
}

