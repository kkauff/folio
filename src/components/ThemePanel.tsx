import { useState } from "react";
import { Plus, X } from "lucide-react";
import { FontPicker } from "./FontPicker";
import {
  allThemes,
  applyTheme,
  applyTypography,
  deleteCustomTheme,
  findTheme,
  getFontId,
  getScale,
  newCustomThemeFrom,
  saveCustomTheme,
  SCALE_MAX,
  SCALE_MIN,
  setActiveThemeId,
  setFontId,
  setScale,
  type Theme,
  type ThemeColors,
} from "../lib/themes";

interface Props {
  activeId: string;
  onActiveChange: (id: string) => void;
  onClose: () => void;
}

// Human labels for each editable color token.
const COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: "bg", label: "Background" },
  { key: "bgElevated", label: "Panel" },
  { key: "bgInput", label: "Editor surface" },
  { key: "text", label: "Text" },
  { key: "textMuted", label: "Muted text" },
  { key: "border", label: "Borders" },
  { key: "accent", label: "Accent" },
  { key: "accentText", label: "Accent text" },
  { key: "selection", label: "Selection" },
  { key: "codeBg", label: "Code background" },
  { key: "danger", label: "Danger" },
];

export function ThemePanel({ activeId, onActiveChange, onClose }: Props) {
  const [themes, setThemes] = useState<Theme[]>(allThemes());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fontId, setFontIdState] = useState(getFontId());
  const [scale, setScaleState] = useState(getScale());

  const editing = editingId ? themes.find((t) => t.id === editingId) ?? null : null;

  function changeFont(id: string) {
    setFontIdState(id);
    setFontId(id);
    applyTypography();
  }

  function changeScale(n: number) {
    setScaleState(n);
    setScale(n);
    applyTypography();
  }

  function select(id: string) {
    applyTheme(findTheme(id));
    setActiveThemeId(id);
    onActiveChange(id);
  }

  function startNewTheme() {
    const base = findTheme(activeId);
    const fresh = newCustomThemeFrom(base);
    const updated = saveCustomTheme(fresh);
    setThemes(updated);
    setEditingId(fresh.id);
    select(fresh.id);
  }

  function updateEditing(patch: { name?: string; colors?: Partial<ThemeColors> }) {
    if (!editing) return;
    const next: Theme = {
      ...editing,
      name: patch.name ?? editing.name,
      colors: { ...editing.colors, ...(patch.colors ?? {}) },
    };
    const updated = saveCustomTheme(next);
    setThemes(updated);
    if (next.id === activeId) applyTheme(next);
  }

  function removeTheme(id: string) {
    const updated = deleteCustomTheme(id);
    setThemes(updated);
    if (editingId === id) setEditingId(null);
    if (activeId === id) select("light");
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal theme-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Appearance</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="theme-panel-body">
          <div className="typography-section">
            <div className="field">
              <span>Font</span>
              <FontPicker value={fontId} onChange={changeFont} />
            </div>

            <div className="field">
              <span>
                Text size <em className="scale-readout">{Math.round(scale * 100)}%</em>
              </span>
              <div className="scale-control">
                <span className="scale-end small-a">A</span>
                <input
                  type="range"
                  className="scale-slider"
                  min={SCALE_MIN}
                  max={SCALE_MAX}
                  step={0.05}
                  value={scale}
                  onChange={(e) => changeScale(parseFloat(e.target.value))}
                />
                <span className="scale-end large-a">A</span>
              </div>
            </div>
          </div>

          <div className="theme-grid">
            {themes.map((t) => (
              <div
                key={t.id}
                className={`theme-card ${t.id === activeId ? "active" : ""}`}
              >
                <button
                  className="theme-swatch"
                  onClick={() => select(t.id)}
                  style={{ background: t.colors.bg, borderColor: t.colors.border }}
                  title={`Use ${t.name}`}
                >
                  <span className="swatch-dot" style={{ background: t.colors.accent }} />
                  <span className="swatch-bar" style={{ background: t.colors.text }} />
                  <span
                    className="swatch-bar short"
                    style={{ background: t.colors.textMuted }}
                  />
                </button>
                <div className="theme-card-footer">
                  <span className="theme-name">{t.name}</span>
                  {!t.builtin && (
                    <span className="theme-card-actions">
                      <button
                        className="link tiny"
                        onClick={() => setEditingId(t.id)}
                      >
                        Edit
                      </button>
                      <button
                        className="link tiny danger"
                        onClick={() => removeTheme(t.id)}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
              </div>
            ))}

            <button className="theme-card new" onClick={startNewTheme}>
              <span className="plus">
                <Plus size={20} />
              </span>
              <span>New theme</span>
            </button>
          </div>

          {editing && (
            <div className="theme-editor">
              <label className="field">
                <span>Theme name</span>
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => updateEditing({ name: e.target.value })}
                />
              </label>

              <div className="color-fields">
                {COLOR_FIELDS.map(({ key, label }) => (
                  <label key={key} className="color-field">
                    <input
                      type="color"
                      value={editing.colors[key]}
                      onChange={(e) =>
                        updateEditing({ colors: { [key]: e.target.value } as Partial<ThemeColors> })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <p className="hint">Changes apply live and save automatically.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
