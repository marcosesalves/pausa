/** Growth stages, driven only by the total number of pauses taken (never by streaks). */

export interface Stage {
  n: 1 | 2 | 3 | 4 | 5;
  name: string;
  /** Pauses needed to reach this stage. */
  at: number;
  line: string;
}

export const STAGES: Stage[] = [
  { n: 1, name: "Seed", at: 0, line: "Every garden starts here." },
  { n: 2, name: "Sprout", at: 1, line: "There you are. That counted." },
  { n: 3, name: "Seedling", at: 10, line: "Little by little, roots." },
  { n: 4, name: "Small plant", at: 30, line: "Look at us, growing." },
  { n: 5, name: "Flowering", at: 75, line: "In bloom. Thank you for the pauses." },
];

export interface GrowthInfo {
  stage: Stage;
  next: Stage | null;
  /** 0..1 progress within the current stage (1 once fully grown). */
  fraction: number;
  /** Pauses still needed for the next stage (0 when fully grown). */
  remaining: number;
}

export function growthFor(totalPauses: number): GrowthInfo {
  let index = 0;
  STAGES.forEach((s, i) => {
    if (totalPauses >= s.at) index = i;
  });
  const stage = STAGES[index];
  const next = STAGES[index + 1] ?? null;
  if (!next) return { stage, next, fraction: 1, remaining: 0 };
  const span = next.at - stage.at;
  return {
    stage,
    next,
    fraction: Math.min(1, (totalPauses - stage.at) / span),
    remaining: next.at - totalPauses,
  };
}

export function pausesLabel(n: number): string {
  return `${n} ${n === 1 ? "pause" : "pauses"}`;
}
