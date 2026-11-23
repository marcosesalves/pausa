interface IconProps {
  /** Sprite id from src/lib/icons.js, e.g. "i-leaf", "c-breathing", "m-sad". */
  name: string;
  size?: "sm" | "lg";
}

export function Icon({ name, size }: IconProps) {
  return (
    <svg className={`icon${size ? ` icon--${size}` : ""}`} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}

interface SpotProps {
  /** Category id (or "moon" / "pot"). */
  name: string;
  idle?: string;
  size?: number;
}

/** 96px spot illustration, tinted by the surrounding `cat--*` scope. */
export function Spot({ name, idle, size }: SpotProps) {
  return (
    <div
      className={`spot cat cat--${name}${idle ? ` ${idle}` : ""}`}
      style={size ? ({ "--spot": `${size}px` } as React.CSSProperties) : undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 96 96">
        <use href={`#s-${name}`} />
      </svg>
    </div>
  );
}
