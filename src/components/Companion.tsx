export type CompanionState =
  | "calm"
  | "waiting"
  | "hello"
  | "breathe"
  | "focused"
  | "proud"
  | "sleepy"
  | "cheering";

interface CompanionProps {
  state?: CompanionState;
  size?: number;
  /** Growth stage 1-5. */
  stage?: number;
  /** Breathing pattern for state="breathe": box | 478 | coherent | sigh. */
  pattern?: string;
  /** One-shot reaction, e.g. "wiggle". */
  react?: string;
  /** Hide entirely (the "Show companion" setting is off). */
  hidden?: boolean;
}

/**
 * The companion (see src/lib/companion.js and section 16 of styles.css).
 * Always decorative: every message it accompanies also exists as text.
 */
export function Companion({
  state = "calm",
  size = 72,
  stage = 3,
  pattern,
  react,
  hidden,
}: CompanionProps) {
  if (hidden) return null;
  return (
    <span className="companion-ground" aria-hidden="true">
      <pausa-companion
        state={state}
        size={size}
        stage={stage}
        pattern={pattern}
        react={react}
      />
    </span>
  );
}
