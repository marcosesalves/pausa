/** The Breathe tab remembers the technique last picked, so the breath before or after a pause uses the same one. */
const KEY = "pausa-breathe-pattern";

export function getStoredPattern(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function storePattern(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // storage can be blocked: the picker still works, it just forgets
  }
}
