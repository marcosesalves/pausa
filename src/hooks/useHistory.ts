import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HistoryItem } from "../lib/types";

/** The last ten tips and Breathe sessions, newest first. Saved by the backend, so it survives a restart. */
export function useHistory(): HistoryItem[] {
  const [items, setItems] = useState<HistoryItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const read = () =>
      invoke<HistoryItem[]>("get_history")
        .then((h) => {
          if (!cancelled) setItems(h);
        })
        .catch(console.error);
    read();
    let unlisten: (() => void) | undefined;
    listen("history-changed", read).then((u) => (unlisten = u));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return items;
}
