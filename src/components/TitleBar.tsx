import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./Icon";

/**
 * The Windows title bar: the sprout, "Pausa", and only Minimise and Close (the window can't be maximised).
 * It replaces the native bar, which is switched off on Windows at start-up. Drag the bar to move the window.
 * Close does not quit: the backend hides the window to the tray and explains it the first time.
 */
export function TitleBar() {
  const win = getCurrentWindow();
  return (
    // data-tauri-drag-region makes this bar the handle for moving the window
    <header className="titlebar" data-tauri-drag-region>
      <Icon name="t-sprout" />
      <span className="titlebar__name">Pausa</span>
      <div className="titlebar__cap">
        <button aria-label="Minimise" title="Minimise" onClick={() => win.minimize().catch(console.error)}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h10" />
          </svg>
        </button>
        <button className="is-close" aria-label="Close" title="Close" onClick={() => win.close().catch(console.error)}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </div>
    </header>
  );
}
