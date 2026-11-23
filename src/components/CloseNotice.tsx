import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  /** Close the dialog without leaving the window (used after the choice is sent to the backend). */
  onDone: () => void;
}

/**
 * Shown the first time the window's close button is pressed. Closing only hides Pausa to the tray,
 * and this says so. Esc picks "Keep running"; Tab order is the checkbox, Keep running, Quit Pausa.
 */
export function CloseNotice({ onDone }: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  const keepRunning = () => {
    invoke("close_to_tray", { dontShowAgain }).catch(console.error);
    onDone();
  };
  const quit = () => {
    invoke("quit_app").catch(console.error);
  };

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        keepRunning();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dontShowAgain]);

  return (
    <div className="close-notice" role="presentation">
      <div
        className="close-notice__card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-notice-title"
        aria-describedby="close-notice-text"
      >
        <h2 id="close-notice-title" className="close-notice__title">
          Pausa keeps running
        </h2>
        <p id="close-notice-text" className="close-notice__text">
          Closing the window hides it. Pip stays in the tray, so your reminders keep coming. To quit,
          use the tray menu or Settings.
        </p>
        <label className="close-notice__check">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          <span>Don't show this again</span>
        </label>
        <div className="close-notice__actions">
          <button ref={keepRef} className="btn btn--primary" onClick={keepRunning}>
            Keep running
          </button>
          <button className="btn btn--soft" onClick={quit}>
            Quit Pausa
          </button>
        </div>
      </div>
    </div>
  );
}
