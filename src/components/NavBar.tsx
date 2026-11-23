import { Icon } from "./Icon";

export type Tab = "home" | "breathe" | "garden" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "i-home" },
  { id: "breathe", label: "Breathe", icon: "i-breathe" },
  { id: "garden", label: "Garden", icon: "i-leaf" },
  { id: "settings", label: "Settings", icon: "i-settings" },
];

interface NavBarProps {
  /** "tabs" is the bottom bar (narrow window), "rail" the left column (wide window). */
  variant: "tabs" | "rail";
  active: Tab;
  onSelect: (tab: Tab) => void;
}

/**
 * Section navigation. App renders both variants and CSS shows one: the bottom tab bar below 640 px
 * wide, the left rail from 640 px up, so the layout switches live while the window is resized.
 */
export function NavBar({ variant, active, onSelect }: NavBarProps) {
  return (
    <nav className={variant} aria-label="Sections">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className="tab"
          aria-current={active === tab.id ? "page" : undefined}
          onClick={() => onSelect(tab.id)}
        >
          <span className="tab__i">
            <Icon name={tab.icon} />
          </span>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
