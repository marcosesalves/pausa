import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isMac } from "../lib/platform";
import { Companion } from "./Companion";
import { Icon } from "./Icon";

/** What the rest of the app asks for: the tray menu and Settings open the form as a bug report or as feedback. */
export type FeedbackKind = "bug" | "feedback";

/** What the person picks in the form. The server knows only two kinds, so "other" is sent as feedback (see send). */
type Topic = "idea" | "bug" | "other";

interface FeedbackContext {
  configured: boolean;
  appVersion: string;
  osVersion: string;
  settings: Record<string, unknown>;
  logTail: string;
}

interface FeedbackProps {
  initialKind: FeedbackKind;
  onBack: () => void;
  showCompanion: boolean;
  stage: number;
}

type Status = "idle" | "sending" | "sent" | "error";

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE = 2000;

const topicFor = (kind: FeedbackKind): Topic => (kind === "bug" ? "bug" : "idea");

/** Report a bug / give feedback. Everything that will be sent is visible, and each extra can be switched off. */
export function Feedback({ initialKind, onBack, showCompanion, stage }: FeedbackProps) {
  const [topic, setTopic] = useState<Topic>(topicFor(initialKind));
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [includeVersion, setIncludeVersion] = useState(true);
  const [includeSettings, setIncludeSettings] = useState(true);
  const [includeLog, setIncludeLog] = useState(true);
  const [screenshot, setScreenshot] = useState<{ name: string; base64: string } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [context, setContext] = useState<FeedbackContext | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The tray menu can reopen this view with the other kind
  useEffect(() => setTopic(topicFor(initialKind)), [initialKind]);

  useEffect(() => {
    invoke<FeedbackContext>("get_feedback_context").then(setContext).catch(console.error);
  }, []);

  const pickScreenshot = (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setError("Please choose a PNG or JPEG image.");
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setError("That image is larger than 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      setScreenshot({ name: file.name, base64: result.slice(result.indexOf(",") + 1) });
    };
    reader.readAsDataURL(file);
  };

  const notConfigured = context?.configured === false;
  const canSend = message.trim().length > 0 && status !== "sending" && !notConfigured;

  const send = async () => {
    if (!canSend) return;
    setStatus("sending");
    setError("");
    try {
      await invoke("submit_feedback", {
        input: {
          // The server accepts "bug" and "feedback" only. "Something else" goes as feedback, marked in the
          // text so the team can tell it apart without a server change.
          kind: topic === "bug" ? "bug" : "feedback",
          message: topic === "other" ? `[Something else] ${message}` : message,
          contact: contact.trim() || null,
          includeVersion,
          includeSettings,
          includeLog,
          screenshotBase64: screenshot?.base64 ?? null,
        },
      });
      setStatus("sent");
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div className="empty" role="status">
        <Companion state="cheering" size={110} hidden={!showCompanion} stage={stage} />
        <p className="empty__title">Thank you.</p>
        <p className="empty__text">
          {topic === "bug" ? "Your report is on its way to the team." : "Your feedback is on its way to the team."}
        </p>
        <button className="btn btn--primary btn--lg" onClick={onBack}>
          Done
        </button>
      </div>
    );
  }

  const preview = {
    ...(includeVersion && context ? { app_version: context.appVersion, os_version: context.osVersion } : {}),
    ...(includeSettings && context ? { settings: context.settings } : {}),
    ...(includeLog && context ? { log_tail: context.logTail || "(empty)" } : {}),
    ...(screenshot ? { screenshot: screenshot.name } : {}),
  };

  // "26.0" on macOS is only a number, so name the system; Windows already comes as "Windows 11 (build ...)"
  const systemLine = context
    ? `${isMac && /^\d/.test(context.osVersion) ? `macOS ${context.osVersion}` : context.osVersion} · Pausa ${context.appVersion}`
    : "";

  return (
    <>
      <div className="view-head">
        <h2 className="view-title">{topic === "bug" ? "Report a bug" : "Give feedback"}</h2>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Type of report">
        {(
          [
            ["idea", "Idea"],
            ["bug", "Bug"],
            ["other", "Something else"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className="segmented__opt"
            role="radio"
            aria-checked={topic === value}
            onClick={() => setTopic(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <textarea
        className="field__input"
        rows={5}
        maxLength={MAX_MESSAGE}
        value={message}
        aria-label={topic === "bug" ? "What happened?" : "What is on your mind?"}
        placeholder={
          topic === "bug"
            ? "What did you do, what did you expect, what happened instead?"
            : "What is on your mind? A sentence is plenty."
        }
        onChange={(e) => setMessage(e.target.value)}
        // Ctrl+Enter (Cmd+Enter on a Mac) sends
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            send();
          }
        }}
      />

      <label className="field">
        <span className="field__label">Reply to (optional)</span>
        <input
          className="field__input"
          type="text"
          maxLength={200}
          value={contact}
          placeholder="you@example.com"
          onChange={(e) => setContact(e.target.value)}
        />
      </label>

      <section className="bento-card bento-card--wide" style={{ gap: 8 }}>
        <div className="toggle-row">
          <span className="toggle-row__label">Include system details</span>
          <button
            className="toggle"
            role="switch"
            aria-label="Include system details"
            aria-checked={includeVersion}
            onClick={() => setIncludeVersion(!includeVersion)}
          />
        </div>
        <p className="note">{systemLine}</p>
        <details className="note">
          <summary style={{ cursor: "pointer" }}>
            More that can be included ({[includeSettings, includeLog].filter(Boolean).length} of 2) and what is sent
          </summary>
          {(
            [
              ["Settings (no companion name)", includeSettings, setIncludeSettings],
              ["Recent app log (events only)", includeLog, setIncludeLog],
            ] as const
          ).map(([label, on, set]) => (
            <div className="toggle-row" key={label} style={{ marginTop: 8 }}>
              <span style={{ font: "600 13px/1.2 var(--font-display)" }}>{label}</span>
              <button className="toggle" role="switch" aria-label={label} aria-checked={on} onClick={() => set(!on)} />
            </div>
          ))}
          <pre className="field__preview">{JSON.stringify(preview, null, 2)}</pre>
        </details>
      </section>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={(e) => {
            pickScreenshot(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {screenshot ? (
          <>
            <span className="pill" style={{ minWidth: 0, flex: 1 }}>
              <Icon name="i-check" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {screenshot.name}
              </span>
            </span>
            <button className="btn btn--ghost" onClick={() => setScreenshot(null)}>
              Remove
            </button>
          </>
        ) : (
          <button className="btn btn--soft" onClick={() => fileRef.current?.click()}>
            Attach a screenshot
          </button>
        )}
      </div>

      <p className="note">Goes to the Pausa test team. Please don't include customer or personal data in text or screenshots.</p>

      {/* Pinned to the bottom, so Send, and the reason it may be off, stay visible while the form scrolls */}
      <div className="sticky-actions pinned-bar">
        {notConfigured && (
          <p className="note bar-note" role="alert">
            This build can't send feedback: it was made without the feedback address. A development
            build never has it; an installer built for release does.
          </p>
        )}
        {error && (
          <p className="note bar-note" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--ghost" onClick={onBack}>
          Cancel
        </button>
        <button className="btn btn--primary btn--lg" disabled={!canSend} onClick={send}>
          {status === "sending"
            ? "Sending…"
            : notConfigured
              ? "Sending isn't set up in this build"
              : topic === "bug"
                ? "Send report"
                : "Send feedback"}
        </button>
      </div>
    </>
  );
}
