import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ClickSettings } from "../lib/types";

/** How the Mac is set to click. Anywhere else, or until it is known, nothing needs explaining. */
export function useClickSettings(): ClickSettings {
  const [click, setClick] = useState<ClickSettings>({ secondaryClick: true, tapToClick: true });

  useEffect(() => {
    invoke<ClickSettings>("get_click_settings").then(setClick).catch(() => {});
  }, []);

  return click;
}
