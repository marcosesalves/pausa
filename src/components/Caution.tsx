import { Icon } from "./Icon";

/** A safety note. It uses a warning icon, not an info "i", because it is a real warning. */
export function Caution({ children }: { children: React.ReactNode }) {
  return (
    <p className="caution-note" role="note">
      <Icon name="i-warn" />
      <span>{children}</span>
    </p>
  );
}
