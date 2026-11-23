import type { Settings } from "./types";

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

/** Mirrors is_quiet_hours in src-tauri/src/scheduler.rs. */
export function isQuietNow(settings: Settings, now: Date = new Date()): boolean {
  if (!settings.quiet_hours_enabled) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(settings.quiet_hours_start);
  const end = toMinutes(settings.quiet_hours_end);
  return start <= end ? current >= start && current < end : current >= start || current < end;
}
