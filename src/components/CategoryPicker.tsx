import { CATEGORIES, categoryLabel } from "../lib/types";
import { Icon } from "./Icon";

/** What each category is, and what choosing it adds, so nobody has to guess what "Body scan" means. */
const INFO: Record<string, { blurb: string; adds: string }> = {
  breathing: { blurb: "Slow breaths to settle down.", adds: "Adds guided breathing tips" },
  gratitude: { blurb: "Notice what is going well.", adds: "Adds thank-you prompts" },
  "body-scan": { blurb: "Check in with how you feel.", adds: "Adds posture and tension checks" },
  "present-moment": { blurb: "Come back to what is here.", adds: "Adds look-and-listen tips" },
  compassion: { blurb: "Be kind to yourself.", adds: "Adds gentle self-talk" },
  movement: { blurb: "Stretch and shake it loose.", adds: "Adds 30-second stretches" },
  nature: { blurb: "Look outside for a moment.", adds: "Adds sky and plant tips" },
  journaling: { blurb: "Put one thought on paper.", adds: "Adds one-line writing prompts" },
  focus: { blurb: "Reset before the next task.", adds: "Adds single-task resets" },
  "letting-go": { blurb: "Release what is weighing on you.", adds: "Adds unclenching tips" },
};

interface CategoryPickerProps {
  /** Heading: "Categories" in Settings, "Pick what you like" in the welcome. */
  title: string;
  /** The line under the heading. */
  intro: string;
  selected: string[];
  onChange: (selected: string[]) => void;
}

/**
 * Pick any number of categories. Multi-select is said in the header and shown by checkbox squares;
 * a chosen card has a thick outline, a tinted fill and a filled check, so it never relies on colour alone.
 */
export function CategoryPicker({ title, intro, selected, onChange }: CategoryPickerProps) {
  const toggle = (category: string) =>
    onChange(selected.includes(category) ? selected.filter((c) => c !== category) : [...selected, category]);

  return (
    <>
      <div className="view-head">
        <h2 className="view-title">{title}</h2>
        <span className="count-pill" role="status">
          {selected.length} selected
        </span>
      </div>
      <p className="cat-picker__intro">{intro}</p>
      <div className="cat-picker__actions">
        <button className="btn btn--soft btn--sm" onClick={() => onChange([...CATEGORIES])}>
          Select all
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => onChange([])}>
          Clear
        </button>
      </div>

      <div className="cat-grid" role="group" aria-label="Categories">
        {CATEGORIES.map((category) => {
          const on = selected.includes(category);
          const info = INFO[category];
          return (
            <button
              key={category}
              className={`cat-card cat cat--${category}`}
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(category)}
            >
              <span className="cat-card__head">
                <span className="cat-card__icon" aria-hidden="true">
                  <Icon name={`c-${category}`} />
                </span>
                <span className="cat-card__name">{categoryLabel(category)}</span>
                <span className="cat-card__box" aria-hidden="true">
                  {on && <Icon name="i-check" />}
                </span>
              </span>
              <span className="cat-card__blurb">{info?.blurb}</span>
              <span className="cat-card__adds">{info?.adds}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
