export interface Pattern {
  id: string;
  /** Modifier class defined in styles.css (.orb--box, .orb--478, ...). */
  cls: string;
  name: string;
  rhythm: string;
  inhale: string;
  hold: string;
  /** Seconds in one full breath cycle (matches the CSS variables in styles.css). */
  cycleSeconds: number;
  /** Polyline for the little breath-shape preview (viewBox 0 0 100 22). */
  wave: string;
  hint: string;
  /** Safety note tag when the pattern holds the breath. */
  caution?: "breath-hold";
  /** Full label for the picker and session header ("Box breathing"; `name` stays short for "<name> breathing"). */
  title: string;
  /** The rhythm in words, e.g. "In 4 · Hold 4 · Out 4 · Hold 4". */
  steps: string;
  /** One short line on what the technique feels like. */
  blurb: string;
  /** The phases of one cycle, in order. Their seconds add up to cycleSeconds and mirror the CSS timings. */
  phases: { say: string; secs: number }[];
}

export const PATTERNS: Pattern[] = [
  { id: "box", cls: "orb--box", name: "Box", rhythm: "4 · 4 · 4 · 4", inhale: "Breathe in…", hold: "Hold…", cycleSeconds: 16,
    wave: "2,19 25,3 50,3 75,19 98,19", hint: "Steady and even. Good for focus.", caution: "breath-hold" ,
    title: "Box breathing", steps: "In 4 · Hold 4 · Out 4 · Hold 4", blurb: "Even and steady",
    phases: [{ say: "Breathe in…", secs: 4 }, { say: "Hold…", secs: 4 }, { say: "Breathe out…", secs: 4 }, { say: "Hold…", secs: 4 }] },
  { id: "478", cls: "orb--478", name: "Relax", rhythm: "4 · 7 · 8", inhale: "Breathe in…", hold: "Hold…", cycleSeconds: 19,
    wave: "2,19 20,3 58,3 98,19", hint: "A long exhale to wind down.", caution: "breath-hold" ,
    title: "4-7-8", steps: "In 4 · Hold 7 · Out 8", blurb: "Slow and winding down",
    phases: [{ say: "Breathe in…", secs: 4 }, { say: "Hold…", secs: 7 }, { say: "Breathe out…", secs: 8 }] },
  { id: "longexhale", cls: "orb--longexhale", name: "Long exhale", rhythm: "4 · 6", inhale: "Breathe in…", hold: "", cycleSeconds: 10,
    wave: "2,19 40,3 98,19", hint: "A longer breath out, to settle." ,
    title: "Long exhale", steps: "In 4 · Out 6", blurb: "A longer breath out, to settle",
    phases: [{ say: "Breathe in…", secs: 4 }, { say: "Breathe out…", secs: 6 }] },
  { id: "triangle", cls: "orb--triangle", name: "Triangle", rhythm: "4 · 4 · 4", inhale: "Breathe in…", hold: "Hold…", cycleSeconds: 12,
    wave: "2,19 35,3 66,3 98,19", hint: "In, hold, out. Simple and steady.", caution: "breath-hold" ,
    title: "Triangle", steps: "In 4 · Hold 4 · Out 4", blurb: "Simple and steady",
    phases: [{ say: "Breathe in…", secs: 4 }, { say: "Hold…", secs: 4 }, { say: "Breathe out…", secs: 4 }] },
  { id: "coherent", cls: "orb--coherent", name: "Coherent", rhythm: "5.5 · 5.5", inhale: "Breathe in…", hold: "", cycleSeconds: 11,
    wave: "2,19 50,3 98,19", hint: "Smooth waves, no pauses." ,
    title: "Coherent", steps: "In 5.5 · Out 5.5", blurb: "Gentle, about 5 breaths a minute",
    phases: [{ say: "Breathe in…", secs: 5.5 }, { say: "Breathe out…", secs: 5.5 }] },
  { id: "sigh", cls: "orb--sigh", name: "Sigh", rhythm: "2 · 1 · 6", inhale: "Breathe in…", hold: "Sip in again…", cycleSeconds: 10,
    wave: "2,19 20,9 30,3 90,19 98,19", hint: "A double inhale, then a slow sigh out." ,
    title: "Sigh", steps: "In 2 · Top up 1 · Out 6", blurb: "A long, loosening exhale",
    phases: [{ say: "Breathe in…", secs: 2 }, { say: "Sip in again…", secs: 1 }, { say: "Breathe out…", secs: 6 }, { say: "Hold…", secs: 1 }] },
];

export function findPattern(id: string | undefined): Pattern | undefined {
  return PATTERNS.find((p) => p.id === id);
}

/** Number of cycles that fill roughly `seconds` (at least 3). */
export function cyclesFor(pattern: Pattern, seconds: number): number {
  return Math.max(3, Math.round(seconds / pattern.cycleSeconds));
}

interface BreathingOrbProps {
  pattern: Pattern;
  cycles: number;
  size: number;
  /** Space reserved under the orb for the "Cycle n of m" counter. */
  marginBottom?: number;
  /** Draw only the orb and its ring: no label inside it and no cycle counter under it (the Breathe session shows those itself). */
  bare?: boolean;
  /** Hold the orb still at its small size until the session begins. */
  rest?: boolean;
  /** Freeze every animation where it is. */
  paused?: boolean;
}

/** The labelled breathing orb with progress ring and cycle counter. */
export function BreathingOrb({ pattern, cycles, size, marginBottom = 30, bare = false, rest = false, paused = false }: BreathingOrbProps) {
  return (
    <div
      // key restarts every animation when the pattern changes
      key={pattern.id}
      className={`orb ${pattern.cls}${rest ? " is-rest" : ""}${paused ? " is-paused" : ""}`}
      role="img"
      aria-label={`${pattern.name} breathing`}
      style={{ "--size": `${size}px`, "--cycles": cycles, marginBottom } as React.CSSProperties}
    >
      <svg className="orb__progress" viewBox="0 0 100 100">
        <circle className="orb__track" cx="50" cy="50" r="48" />
        <circle className="orb__bar" cx="50" cy="50" r="48" pathLength={100} />
      </svg>
      <div className="orb__breath">
        <span className="orb__ring" />
        <span className="orb__ring orb__ring--2" />
        <span className="orb__blob orb__blob--3" />
        <span className="orb__blob orb__blob--2" />
        <span className="orb__blob" />
      </div>
      {!bare && (
        <div className="orb__label" aria-live="off">
          <span className="orb__say orb__say--in">{pattern.inhale}</span>
          <span className="orb__say orb__say--hold">{pattern.hold}</span>
          <span className="orb__say orb__say--out">Breathe out…</span>
          <span className="orb__static">Breathe</span>
        </div>
      )}
      {!bare && (
        <div className="orb__count">
          Cycle <span className="orb__n" /> of {cycles}
        </div>
      )}
    </div>
  );
}
