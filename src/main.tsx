import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { FocusNotification } from "./components/FocusNotification";
import { isMac, isWindows } from "./lib/platform";
import { applyStoredTheme } from "./lib/theme";
import "./lib/icons.js"; // injects the SVG icon + illustration sprite
import "./lib/companion.js"; // injects the companion sprite and the <pausa-companion> element
import "./styles.css";
import "./App.css";

// Light, dark or system as last chosen, before anything is drawn (the saved settings follow shortly)
applyStoredTheme();

// Lets the stylesheet adapt per system (the Windows overlay has no blur, so its tint is stronger)
document.documentElement.dataset.platform = isWindows ? "windows" : isMac ? "macos" : "other";

// The same bundle serves two windows: the main window and the focus overlay.
const isFocusWindow = new URLSearchParams(window.location.search).get("window") === "focus";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isFocusWindow ? <FocusNotification /> : <App />}</React.StrictMode>
);
