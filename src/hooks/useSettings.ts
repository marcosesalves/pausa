import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Settings } from "../lib/types";

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<Settings>("get_settings")
      .then((s) => {
        setSettings(s);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });

    // Another window changed a setting (the focus card remembers "breathe first / after"): stay in step,
    // so a later change here cannot write an old value back over it
    let unlisten: (() => void) | undefined;
    listen<Settings>("settings-changed", (e) => setSettings(e.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  const updateSettings = useCallback(
    async (newSettings: Settings) => {
      try {
        await invoke("update_settings", { settings: newSettings });
        setSettings(newSettings);
        setError(null);
      } catch (err) {
        setError(String(err));
      }
    },
    []
  );

  return { settings, loading, error, updateSettings };
}
