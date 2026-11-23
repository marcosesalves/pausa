import { STAGES, growthFor, pausesLabel } from "../lib/growth";
import { Companion } from "./Companion";

interface GardenProps {
  name: string;
  totalPauses: number;
  showCompanion: boolean;
}

/** Circular progress around the companion (or its stage symbol). */
export function GrowthRing({
  fraction,
  size,
  stroke = 4,
  children,
}: {
  fraction: number;
  size: number;
  stroke?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="growth-ring" style={{ width: size, height: size }}>
      <svg className="growth-ring__arc" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="46" style={{ stroke: "var(--line)", strokeWidth: stroke }} />
        <circle
          cx="50"
          cy="50"
          r="46"
          pathLength={100}
          style={{
            stroke: "var(--accent-mid)",
            strokeWidth: stroke,
            strokeDasharray: 100,
            strokeDashoffset: 100 - fraction * 100,
          }}
        />
      </svg>
      {children}
    </div>
  );
}

/** Where a stage stands next to the current one. */
function stageState(n: number, current: number): "Reached" | "Now" | "Next" | "Later" {
  if (n < current) return "Reached";
  if (n === current) return "Now";
  return n === current + 1 ? "Next" : "Later";
}

export function Garden({ name, totalPauses, showCompanion }: GardenProps) {
  const { stage, next, fraction, remaining } = growthFor(totalPauses);

  return (
    <>
      <div className="view-head">
        <h2 className="view-title">Garden</h2>
        <span className="pill">{pausesLabel(totalPauses)}</span>
      </div>

      {/* The remaining count is the headline, so nobody has to hunt for how close the next stage is */}
      <section className="garden-hero">
        <div
          role="img"
          aria-label={
            next
              ? `${stage.name}, ${remaining} more ${remaining === 1 ? "pause" : "pauses"} until ${next.name}`
              : `${stage.name}, fully grown`
          }
        >
          <GrowthRing fraction={fraction} size={124}>
            {showCompanion ? (
              <Companion state="calm" stage={stage.n} size={96} />
            ) : (
              <svg className="companion-static" viewBox="0 0 120 120" style={{ ["--size" as string]: "84px" }}>
                <use href={`#pet-stage-${stage.n}`} />
              </svg>
            )}
          </GrowthRing>
        </div>
        <div className="garden-hero__text">
          <h3 className="garden-hero__big">
            {next ? `${remaining} more ${remaining === 1 ? "pause" : "pauses"} to grow` : `${name} is in full bloom`}
          </h3>
          <p className="garden-hero__sub">
            {next
              ? `${stage.name} now. ${next.name} at ${pausesLabel(next.at)}.`
              : `${stage.name} reached at ${pausesLabel(stage.at)}. ${stage.line}`}
          </p>
        </div>
      </section>

      <div className="garden-meter">
        <span className="home-meter" aria-hidden="true">
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
        {next && (
          <span className="garden-meter__labels" aria-hidden="true">
            <span>{stage.at}</span>
            <span>{next.at}</span>
          </span>
        )}
      </div>

      <div className="bento-card" style={{ gap: 10 }}>
        <div className="garden">
          {STAGES.map((s) => {
            const state = stageState(s.n, stage.n);
            return (
              <div
                key={s.n}
                className={`garden__stage${s.n === stage.n ? " is-current" : s.n > stage.n ? " is-future" : ""}`}
              >
                <svg className="companion-static" viewBox="0 0 120 120" style={{ ["--size" as string]: "44px" }}>
                  <use href={`#pet-stage-${s.n}`} />
                </svg>
                <span className="garden__name">{s.name}</span>
                <span className="garden__meta">{pausesLabel(s.at)}</span>
                <span className="garden__meta">{state}</span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="note" style={{ textAlign: "center" }}>
        {name} grows with every pause you take. Days off change nothing.
      </p>
    </>
  );
}
