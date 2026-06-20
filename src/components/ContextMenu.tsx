import { useEffect } from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Greyed-out, non-interactive item. */
  disabled?: boolean;
  /** Run onClick but leave the menu open (e.g. to swap into a submenu stage). */
  keepOpen?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** A small floating menu shown at (x, y); closes on outside click or Escape. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu inside the viewport.
  const left = Math.min(x, window.innerWidth - 170);
  const top = Math.min(y, window.innerHeight - items.length * 36 - 8);

  return (
    <div
      className="context-menu"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className={`context-menu-item ${item.danger ? "danger" : ""}`}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            if (!item.keepOpen) onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
