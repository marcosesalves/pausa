import type { HistoryItem } from "../lib/types";
import { categoryLabel } from "../lib/types";
import { pausesLabel } from "../lib/growth";
import { Companion } from "./Companion";
import { Icon, Spot } from "./Icon";

interface TipHistoryProps {
  items: HistoryItem[];
  /** Pauses taken in all, so the list and the garden can be read together. */
  totalPauses: number;
  onBack: () => void;
  onGetTip: () => void;
  showCompanion: boolean;
  stage: number;
}

/** "Today 14:02", "Yesterday 09:30" or "12 Nov 18:45". */
function when(atSecs: number): string {
  const d = new Date(atSecs * 1000);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

const OUTCOME: Record<HistoryItem["outcome"], string> = {
  done: "Taken",
  skipped: "Skipped",
  shown: "Seen",
};

export function TipHistory({ items, totalPauses, onBack, onGetTip, showCompanion, stage }: TipHistoryProps) {
  const taken = items.filter((i) => i.outcome === "done").length;

  return (
    <>
      <div className="view-head">
        <button className="btn btn--back" onClick={onBack}>
          <Icon name="i-back" />
          Back
        </button>
      </div>
      <h2 className="view-title">Recent tips</h2>

      {items.length === 0 ? (
        <div className="empty">
          {showCompanion ? (
            <Companion state="waiting" size={112} stage={stage} />
          ) : (
            <Spot name="moon" idle="idle--float" size={96} />
          )}
          <p className="empty__title">No pauses yet</p>
          <p className="empty__text">Your last ten tips will gather here.</p>
          <button className="btn btn--soft" onClick={onGetTip}>
            Get a Tip
          </button>
        </div>
      ) : (
        <>
          {/* Said in one line, so the list and the garden's count can be read together */}
          <p className="note">
            {taken} of the last {items.length} taken. {pausesLabel(totalPauses)} in all.
          </p>
          <ul className="history-list">
            {items.map((item, index) => {
              const category = item.tip?.category ?? "breathing";
              const text = item.tip?.text ?? item.title ?? "Breathing session";
              return (
                <li
                  key={`${item.at}-${index}`}
                  className={`history-item cat cat--${category}`}
                  style={{ "--i": index } as React.CSSProperties}
                >
                  <span className="history-item__icon">
                    <Icon name={`c-${category}`} />
                  </span>
                  <div className="history-item__body">
                    <p className="history-text">{text}</p>
                    <span className="history-item__meta">
                      {item.tip ? categoryLabel(category) : "Breathing session"}
                      {item.tip?.duration && ` · ${item.tip.duration}`} · {when(item.at)}
                    </span>
                  </div>
                  <span className={`history-item__state history-item__state--${item.outcome}`}>
                    {item.outcome === "done" && <Icon name="i-check" />}
                    {OUTCOME[item.outcome]}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
