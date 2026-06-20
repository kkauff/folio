import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ALL_ICON_NAMES, DEFAULT_FOLDER_ICON, iconByName } from "../lib/icons";

interface Props {
  /** Currently selected icon name, or null for the default. */
  value: string | null;
  onChange: (name: string) => void;
}

/** Max icons rendered at once (the full set is ~1700; rendering all is wasteful). */
const MAX_RESULTS = 90;

/**
 * A compact icon button that opens a searchable dropdown of every Lucide icon.
 * Shows the chosen icon (or a notebook by default) next to the folder title.
 */
export function IconPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const Current = iconByName(value) ?? DEFAULT_FOLDER_ICON;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const names = q
      ? ALL_ICON_NAMES.filter((n) => n.toLowerCase().includes(q))
      : ALL_ICON_NAMES;
    return names.slice(0, MAX_RESULTS);
  }, [query]);

  // Close on outside click or Escape.
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
    <div className="icon-dropdown" ref={rootRef}>
      <button
        type="button"
        className="icon-current"
        title="Choose an icon"
        onClick={() => setOpen((o) => !o)}
      >
        <Current size={20} />
        <ChevronDown size={13} className="icon-current-caret" />
      </button>

      {open && (
        <div className="icon-dropdown-panel">
          <input
            className="icon-search"
            autoFocus
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="icon-results">
            {results.map((name) => {
              const Icon = iconByName(name)!;
              return (
                <button
                  key={name}
                  type="button"
                  className={`icon-choice ${value === name ? "active" : ""}`}
                  title={name}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                >
                  <Icon size={18} />
                </button>
              );
            })}
            {results.length === 0 && (
              <div className="icon-empty">No icons match “{query}”.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
