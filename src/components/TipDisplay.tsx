import { useEffect, useState } from "react";
import type { Tip } from "../lib/types";
import { categoryLabel } from "../lib/types";
import { cautionText } from "../lib/cautions";
import { Caution } from "./Caution";
import { Companion } from "./Companion";
import { Icon } from "./Icon";

interface TipDisplayProps {
  currentTip: Tip | null;
  onNextTip: () => void;
  onTakeAMoment: (tip: Tip) => void;
  showCompanion: boolean;
  stage: number;
  /** Show the Take a moment / Next Tip buttons inside the card. The window shell pins them in its own bar instead. */
  showActions?: boolean;
  /** What Pip says under "Ready when you are." Defaults to "A small one for right now." */
  waitingSub?: string;
}

/** Split into sentences so each one can fade in in turn. */
function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g)?.map((s) => s.trim()) ?? [text];
}

export function TipDisplay({
  currentTip,
  onNextTip,
  onTakeAMoment,
  showCompanion,
  stage,
  showActions = true,
  waitingSub,
}: TipDisplayProps) {
  // The companion says hello when a new tip arrives, then settles into waiting.
  const [greeting, setGreeting] = useState(true);
  const tipId = currentTip?.id;
  useEffect(() => {
    setGreeting(true);
    const t = window.setTimeout(() => setGreeting(false), 4000);
    return () => window.clearTimeout(t);
  }, [tipId]);

  // The white card around all of this is Home's; nothing here draws a card of its own, so cards never nest
  if (!currentTip) {
    return (
      <>
        <div className="empty">
          <Companion state="waiting" size={96} hidden={!showCompanion} stage={stage} />
          <p className="empty__title">Open your mind to a new perspective</p>
        </div>
        <button className="btn btn--primary btn--lg btn--block" onClick={onNextTip}>
          <Icon name="i-sparkle" />
          Get a Tip
        </button>
      </>
    );
  }

  return (
    <>
      {showCompanion && (
        <div className="companion-hero">
          <Companion state={greeting ? "hello" : "waiting"} size={72} stage={stage} />
          <div>
            <p className="companion-hero__line">{greeting ? "Oh, hello." : "Ready when you are."}</p>
            <p className="companion-hero__sub">
              {greeting ? "Something small for right now." : (waitingSub ?? "A small one for right now.")}
            </p>
          </div>
        </div>
      )}

      {/* `key` replays the entrance animation for every new tip */}
      <article key={currentTip.id} className={`tip-card tip-card--bare cat cat--${currentTip.category}`}>
        <div style={{ display: "flex", gap: 6 }}>
          <span className="badge">
            <Icon name={`c-${currentTip.category}`} />
            {categoryLabel(currentTip.category)}
          </span>
          {currentTip.duration && (
            <span className="pill">
              <Icon name="i-clock" />
              {currentTip.duration}
            </span>
          )}
        </div>

        <p className="tip-text">
          {sentences(currentTip.text).map((s, i) => (
            <span key={i} style={{ "--i": i } as React.CSSProperties}>
              {s}{" "}
            </span>
          ))}
        </p>

        {cautionText(currentTip.caution) && <Caution>{cautionText(currentTip.caution)}</Caution>}

        {showActions && (
          <div className="tip-card__actions">
            <button className="btn btn--primary" onClick={() => onTakeAMoment(currentTip)}>
              Take a moment
            </button>
            <button className="btn btn--soft" style={{ flex: "none" }} onClick={onNextTip}>
              Next Tip
            </button>
          </div>
        )}
      </article>
    </>
  );
}
