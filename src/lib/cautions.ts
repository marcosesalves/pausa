/** Safety notes shown with a tip. The tag lives in src/data/tips.json (`caution`). */
export type Caution = "breath-hold" | "movement" | "eyes-closed";

export const CAUTION_TEXT: Record<Caution, string> = {
  "breath-hold":
    "Stop if you feel dizzy. Skip the breath holds if you have a heart or breathing condition.",
  movement: "Only if it feels comfortable for you.",
  "eyes-closed": "Keep your eyes open if this isn't a safe place to close them.",
};

/** The note for a tip's caution tag, or null when it has none (or an unknown one). */
export function cautionText(caution: string | undefined): string | null {
  return caution && caution in CAUTION_TEXT ? CAUTION_TEXT[caution as Caution] : null;
}
