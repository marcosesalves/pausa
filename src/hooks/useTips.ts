import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Tip } from "../lib/types";

/** The tip on Home. (What was shown before lives in the backend: see useHistory.) */
export function useTips() {
  const [currentTip, setCurrentTip] = useState<Tip | null>(null);

  const fetchNextTip = useCallback(async () => {
    try {
      const tip = await invoke<Tip | null>("get_next_tip");
      if (tip) setCurrentTip(tip);
      return tip;
    } catch (err) {
      console.error("Failed to fetch next tip:", err);
      return null;
    }
  }, []);

  const triggerReminderNow = useCallback(async () => {
    try {
      const tip = await invoke<Tip | null>("trigger_reminder_now");
      if (tip) setCurrentTip(tip);
      return tip;
    } catch (err) {
      console.error("Failed to trigger reminder:", err);
      return null;
    }
  }, []);

  // A reminder fired in the background: show that tip
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<Tip>("reminder-tick", (event) => setCurrentTip(event.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  return { currentTip, fetchNextTip, triggerReminderNow };
}
