import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * When the next reminder is due, in seconds since the Unix epoch, or null before the scheduler has
 * started. Re-read whenever `refreshKey` changes (the interval or pause state was edited) and twice
 * a minute, so the countdown on Home stays honest.
 */
export function useNextNudge(refreshKey: string): number | null {
  const [due, setDue] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      invoke<number>("get_next_nudge")
        .then((secs) => {
          if (!cancelled) setDue(secs > 0 ? secs : null);
        })
        .catch(() => {});
    };
    read();
    // The backend restarts its wait when the interval changes, a moment after the settings are saved
    const soon = window.setTimeout(read, 500);
    const t = window.setInterval(read, 30_000);
    return () => {
      cancelled = true;
      window.clearTimeout(soon);
      window.clearInterval(t);
    };
  }, [refreshKey]);

  return due;
}

/** "42 min", "1 h 5 min", or "a moment" when it is due or overdue. */
export function untilLabel(dueSecs: number, now: number = Date.now()): string {
  const minutes = Math.ceil((dueSecs * 1000 - now) / 60_000);
  if (minutes <= 0) return "a moment";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "in 42 min" or "any moment". With `about`: "in about 42 min". */
export function nudgePhrase(dueSecs: number, about = false): string {
  const label = untilLabel(dueSecs);
  return label === "a moment" ? "any moment" : `in ${about ? "about " : ""}${label}`;
}

/** "Every hour", "Every 15 minutes", ... */
export function everyLabel(intervalMinutes: number): string {
  if (intervalMinutes === 60) return "Every hour";
  if (intervalMinutes % 60 === 0) return `Every ${intervalMinutes / 60} hours`;
  return `Every ${intervalMinutes} minutes`;
}
