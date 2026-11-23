import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Progress } from "../lib/types";

/** Total pauses taken, kept in sync with the backend (including pauses finished in the focus window). */
export function useProgress() {
  const [progress, setProgress] = useState<Progress>({ total_pauses: 0 });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    invoke<Progress>("get_progress").then(setProgress).catch(console.error);
    listen<Progress>("progress-changed", (e) => setProgress(e.payload)).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  return progress;
}
