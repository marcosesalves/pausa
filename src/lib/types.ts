export interface Tip {
  id: number;
  text: string;
  category: string;
  timeOfDay: string[];
  duration: string;
  /** Guided breathing pattern id ("box" | "478" | "coherent" | "sigh" | "longexhale" | "triangle"). */
  technique?: string;
  /** Safety note to show: "breath-hold" | "movement" | "eyes-closed". */
  caution?: string;
}

/** One line of History: a tip (or a Breathe session's title), when, and what became of it. */
export interface HistoryItem {
  tip: Tip | null;
  /** Set for a Breathe session, which has no tip. */
  title: string | null;
  /** Seconds since the Unix epoch. */
  at: number;
  /** "shown" (seen, not acted on), "done" (a pause was taken) or "skipped". */
  outcome: "shown" | "done" | "skipped";
}

/** "system" follows the computer's light or dark mode; the others force one. */
export type Theme = "system" | "light" | "dark";

/** How the Mac is set to click (macOS only; other systems report both as true). */
export interface ClickSettings {
  /** A secondary click is possible: two fingers, a trackpad corner, or a two-button mouse. */
  secondaryClick: boolean;
  /** A light tap on the trackpad counts as a click. */
  tapToClick: boolean;
}

export interface Settings {
  interval_minutes: number;
  selected_categories: string[];
  launch_at_login: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  paused: boolean;
  /** What the window's close button does: "tray" keeps Pausa running, "quit" exits. */
  close_behavior: "tray" | "quit";
  close_notice_seen: boolean;
  onboarded: boolean;
  companion_name: string;
  show_companion: boolean;
  theme: Theme;
  /** A separate reminder to drink water, on its own rhythm. */
  water_reminder: boolean;
  water_interval_minutes: number;
  /** A separate reminder to check your posture, on its own rhythm. */
  posture_reminder: boolean;
  posture_interval_minutes: number;
  /** In the tip card: "Add a breath" before and/or after the pause, remembered per category id. */
  breathe_around: Record<string, BreatheAround>;
}

/** A breath (a short Breathe session in the Pausa window) before and/or after the pause. */
export interface BreatheAround {
  before: boolean;
  after: boolean;
}

/** How long the breath before or after a pause lasts, in seconds. */
export const BREATH_AROUND_SECONDS = 60;

/** The rhythms offered for the two small reminders, in minutes. */
export const WATER_INTERVALS = [
  { label: "30 minutes", short: "30m", value: 30 },
  { label: "1 hour", short: "1h", value: 60 },
  { label: "1 and a half hours", short: "1.5h", value: 90 },
  { label: "2 hours", short: "2h", value: 120 },
] as const;

export const POSTURE_INTERVALS = [
  { label: "20 minutes", short: "20m", value: 20 },
  { label: "30 minutes", short: "30m", value: 30 },
  { label: "45 minutes", short: "45m", value: 45 },
  { label: "1 hour", short: "1h", value: 60 },
] as const;

export interface Progress {
  total_pauses: number;
}

/** Names offered in onboarding. */
export const COMPANION_NAMES = ["Pip", "Sprig", "Fern"] as const;

export const CATEGORIES = [
  "breathing", "gratitude", "body-scan", "present-moment",
  "compassion", "movement", "nature", "journaling", "focus", "letting-go"
] as const;

export const INTERVALS = [
  { label: "15 minutes", short: "15m", value: 15 },
  { label: "30 minutes", short: "30m", value: 30 },
  { label: "1 hour", short: "1h", value: 60 },
  { label: "2 hours", short: "2h", value: 120 },
  { label: "4 hours", short: "4h", value: 240 },
] as const;

/** Human label for a category id, e.g. "body-scan" -> "Body scan". */
export function categoryLabel(category: string): string {
  const spaced = category.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Idle animation class for each category's spot illustration. */
export const CATEGORY_IDLE: Record<string, string> = {
  breathing: "idle--breathe",
  gratitude: "idle--sprout",
  "body-scan": "idle--glow",
  "present-moment": "idle--ripple",
  compassion: "idle--glow",
  movement: "idle--float",
  nature: "idle--sway",
  journaling: "idle--float",
  focus: "idle--float",
  "letting-go": "idle--drift",
};
