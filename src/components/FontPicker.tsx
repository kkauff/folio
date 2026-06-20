import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { FONTS } from "../lib/themes";

interface Props {
  value: string;
  onChange: (id: string) => void;
}

/**
 * Themed font dropdown. Unlike a native <select>, the trigger and each option
 * render in their own font (so you can preview before choosing) and the popup
 * follows the app theme.
 */
export function FontPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = FONTS.find((f) => f.id === value) ?? FONTS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="select-dropdown" ref={rootRef}>
      <button
        type="button"
        className="select-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontFamily: current.stack }}>{current.name}</span>
        <ChevronDown size={14} className="select-caret" />
      </button>

      {open && (
        <div className="select-panel">
          {FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`select-option ${f.id === value ? "active" : ""}`}
              style={{ fontFamily: f.stack }}
              onClick={() => {
                onChange(f.id);
                setOpen(false);
              }}
            >
              <span>{f.name}</span>
              {f.id === value && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
