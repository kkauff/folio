// Theme system. A theme is just a set of color tokens applied to the document
// root as CSS custom properties, so any component can reference `var(--bg)` etc.
// Users can pick a built-in theme or craft fully custom ones (VS Code style).
//
// Theme preferences are NOT secret (they reveal nothing about journal content),
// so they live in localStorage rather than the encrypted vault.

export interface ThemeColors {
  bg: string;          // app background
  bgElevated: string;  // sidebar / panels
  bgInput: string;     // inputs, editor surface
  text: string;        // primary text
  textMuted: string;   // secondary text
  border: string;      // dividers, input borders
  accent: string;      // primary accent (buttons, active state)
  accentText: string;  // text on top of accent
  danger: string;      // destructive actions
  selection: string;   // selected list row
  codeBg: string;      // inline/code block background
}

export interface Theme {
  id: string;
  name: string;
  builtin: boolean;
  colors: ThemeColors;
}

export const LIGHT: Theme = {
  id: "light",
  name: "Light",
  builtin: true,
  colors: {
    bg: "#ffffff",
    bgElevated: "#f5f6f8",
    bgInput: "#ffffff",
    text: "#1c1e21",
    textMuted: "#6b7280",
    border: "#e3e6ea",
    accent: "#3b6ef5",
    accentText: "#ffffff",
    danger: "#d8453a",
    selection: "#e7efff",
    codeBg: "#f0f2f5",
  },
};

export const DARK: Theme = {
  id: "dark",
  name: "Dark",
  builtin: true,
  colors: {
    bg: "#1b1d22",
    bgElevated: "#23262d",
    bgInput: "#15171b",
    text: "#e6e8ec",
    textMuted: "#9aa0ab",
    border: "#33373f",
    accent: "#5b8bff",
    accentText: "#0c0e12",
    danger: "#f06a5d",
    selection: "#2c3340",
    codeBg: "#15171b",
  },
};

export const SEPIA: Theme = {
  id: "sepia",
  name: "Sepia",
  builtin: true,
  colors: {
    bg: "#f4ecd8",
    bgElevated: "#ece2c8",
    bgInput: "#fbf6e9",
    text: "#433422",
    textMuted: "#8a765a",
    border: "#dcceac",
    accent: "#a9743b",
    accentText: "#fbf6e9",
    danger: "#b0432f",
    selection: "#e4d4ab",
    codeBg: "#ece2c8",
  },
};

export const BUILTIN_THEMES: Theme[] = [LIGHT, DARK, SEPIA];

// ---- Typography (font + scale) ----------------------------------------------
// Applied app-wide (not per-theme) and stored separately in localStorage.

export interface FontOption {
  id: string;
  name: string;
  /** CSS font-family stack. */
  stack: string;
}

export const FONTS: FontOption[] = [
  {
    id: "serif",
    name: "Serif",
    stack: 'ui-serif, "New York", Georgia, "Iowan Old Style", Palatino, serif',
  },
  {
    id: "sans",
    name: "Sans",
    stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },
  {
    id: "humanist",
    name: "Humanist",
    stack: '"Optima", "Gill Sans", "Segoe UI", Candara, sans-serif',
  },
  {
    id: "rounded",
    name: "Rounded",
    stack: '"SF Pro Rounded", ui-rounded, "Nunito", "Segoe UI", system-ui, sans-serif',
  },
  {
    id: "mono",
    name: "Monospace",
    stack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  },
];

const FONT_KEY = "folio.font.v1";
const SCALE_KEY = "folio.scale.v1";

/** Allowed reading-scale range (multiplier applied to the whole UI). */
export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.4;

export function findFont(id: string): FontOption {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

export function getFontId(): string {
  return localStorage.getItem(FONT_KEY) ?? FONTS[0].id;
}

export function setFontId(id: string) {
  localStorage.setItem(FONT_KEY, id);
}

export function getScale(): number {
  const v = parseFloat(localStorage.getItem(SCALE_KEY) ?? "");
  if (!Number.isFinite(v)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, v));
}

export function setScale(n: number) {
  localStorage.setItem(SCALE_KEY, String(n));
}

/** Base editor font size (px) at 100% scale. */
const EDITOR_BASE_PX = 16;
const EDITOR_LINE_RATIO = 1.75;

export interface EditorMetrics {
  /** Integer px font size. */
  fontSize: number;
  /** Integer px line height. */
  lineHeight: number;
  /** CSS font-family stack. */
  fontFamily: string;
}

/**
 * Concrete editor metrics for the current font + scale. Integer pixels so
 * CodeMirror's per-line height measurement is exact (no rounding drift), and
 * fed directly into the editor's own theme config (not via CSS variables) so
 * the editor re-measures when they change — the way real editors handle this.
 */
export function getEditorMetrics(): EditorMetrics {
  const scale = getScale();
  const fontSize = Math.round(EDITOR_BASE_PX * scale);
  return {
    fontSize,
    lineHeight: Math.round(fontSize * EDITOR_LINE_RATIO),
    fontFamily: findFont(getFontId()).stack,
  };
}

/** Apply the saved content font and reading scale to the document. */
export function applyTypography() {
  const root = document.documentElement;
  const scale = getScale();
  root.style.setProperty("--font-content", findFont(getFontId()).stack);
  // Generic multiplier used by non-editor content (reading view, title).
  root.style.setProperty("--scale", String(scale));
  // (Deliberately NOT CSS `zoom`/`transform`, which break click-to-position.)
  root.style.removeProperty("zoom");
  // The editor reads its metrics from getEditorMetrics() and reconfigures itself.
  window.dispatchEvent(new Event("folio:typography"));
}

const STORAGE_KEY = "folio.themes.v1";
const ACTIVE_KEY = "folio.activeTheme.v1";

interface StoredThemeState {
  custom: Theme[];
}

function load(): StoredThemeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredThemeState;
  } catch {
    /* ignore corrupt storage */
  }
  return { custom: [] };
}

function persist(state: StoredThemeState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** All themes: built-ins followed by the user's custom themes. */
export function allThemes(): Theme[] {
  return [...BUILTIN_THEMES, ...load().custom];
}

export function getActiveThemeId(): string {
  return localStorage.getItem(ACTIVE_KEY) ?? "light";
}

export function setActiveThemeId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function findTheme(id: string): Theme {
  return allThemes().find((t) => t.id === id) ?? LIGHT;
}

/** Apply a theme's colors to the document as CSS variables. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const c = theme.colors;
  root.style.setProperty("--bg", c.bg);
  root.style.setProperty("--bg-elevated", c.bgElevated);
  root.style.setProperty("--bg-input", c.bgInput);
  root.style.setProperty("--text", c.text);
  root.style.setProperty("--text-muted", c.textMuted);
  root.style.setProperty("--border", c.border);
  root.style.setProperty("--accent", c.accent);
  root.style.setProperty("--accent-text", c.accentText);
  root.style.setProperty("--danger", c.danger);
  root.style.setProperty("--selection", c.selection);
  root.style.setProperty("--code-bg", c.codeBg);
  // Hint native form controls / scrollbars to match.
  root.style.colorScheme = isDark(c.bg) ? "dark" : "light";
}

/** Rough luminance check so we can set `color-scheme` appropriately. */
function isDark(hex: string): boolean {
  const m = hex.replace("#", "").trim();
  if (m.length < 6) return false;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Save a custom theme (insert or update) and return the new list. */
export function saveCustomTheme(theme: Theme): Theme[] {
  const state = load();
  const idx = state.custom.findIndex((t) => t.id === theme.id);
  if (idx >= 0) state.custom[idx] = theme;
  else state.custom.push(theme);
  persist(state);
  return allThemes();
}

export function deleteCustomTheme(id: string): Theme[] {
  const state = load();
  state.custom = state.custom.filter((t) => t.id !== id);
  persist(state);
  if (getActiveThemeId() === id) setActiveThemeId("light");
  return allThemes();
}

/** Create a new custom theme seeded from an existing one. */
export function newCustomThemeFrom(base: Theme): Theme {
  return {
    id: `custom-${Date.now()}`,
    name: `${base.name} (custom)`,
    builtin: false,
    colors: { ...base.colors },
  };
}
