// A CodeMirror 6 editor configured for "live" markdown editing: you type plain
// markdown (## heading, **bold**, - lists) and it styles itself in place, with
// the syntax markers kept but visually de-emphasized — Obsidian "source mode".
//
// Colors come from the app's theme CSS variables. Font size / line height /
// family are fed in as concrete values via a reconfigurable compartment — the
// editor owns its font metrics and re-measures when they change, which is how
// real editors keep click-to-position accurate across font sizes.
import { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { Compartment, EditorSelection, type ChangeSpec } from "@codemirror/state";
import { EditorView, keymap, type Command } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { tags } from "@lezer/highlight";
import { getEditorMetrics, type EditorMetrics } from "../lib/themes";
import { livePreview } from "../lib/livePreview";

// How each markdown token is styled live in the editor.
const folioHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.7em", fontWeight: "700", lineHeight: "1.3" },
  { tag: tags.heading2, fontSize: "1.4em", fontWeight: "700", lineHeight: "1.3" },
  { tag: tags.heading3, fontSize: "1.2em", fontWeight: "700" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--accent)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", color: "var(--accent)" },
  { tag: tags.quote, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: tags.contentSeparator, color: "var(--text-muted)" },
  // The raw syntax markers (#, *, >, -, `): keep them but make them faint.
  { tag: tags.processingInstruction, color: "var(--text-muted)", opacity: "0.5" },
]);

/** Build the editor theme for a concrete set of font metrics. */
function buildTheme(m: EditorMetrics) {
  return EditorView.theme({
    "&": {
      backgroundColor: "var(--bg-input)",
      color: "var(--text)",
      height: "100%",
      fontSize: `${m.fontSize}px`,
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: m.fontFamily,
      lineHeight: `${m.lineHeight}px`,
      overflow: "auto",
      // Vertical breathing room lives on the scroller, NOT on .cm-content:
      // content padding shifts the text origin and offsets click-to-position.
      padding: "22px 0",
    },
    ".cm-content": {
      fontFamily: m.fontFamily,
      fontSize: `${m.fontSize}px`,
      lineHeight: `${m.lineHeight}px`,
      padding: "0 26px",
      caretColor: "var(--accent)",
      maxWidth: "820px",
    },
    ".cm-line": { padding: "0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    "::selection": { backgroundColor: "var(--selection)" },
    ".cm-placeholder": { color: "var(--text-muted)" },
  });
}

/**
 * Toggle a symmetric inline marker (e.g. `**` for bold) around each selection.
 * Adds the markers when absent, strips them when already present, and for an
 * empty selection inserts the pair with the cursor between them.
 */
function toggleWrap(marker: string): Command {
  const len = marker.length;
  return (view) => {
    const { state } = view;
    const tr = state.changeByRange((range) => {
      const before = state.doc.sliceString(Math.max(0, range.from - len), range.from);
      const after = state.doc.sliceString(range.to, Math.min(state.doc.length, range.to + len));
      // Markers sit just outside the selection → unwrap them.
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - len, to: range.from },
            { from: range.to, to: range.to + len },
          ],
          range: EditorSelection.range(range.from - len, range.to - len),
        };
      }
      const text = state.doc.sliceString(range.from, range.to);
      // Markers are inside the selection → unwrap them.
      if (text.length >= len * 2 && text.startsWith(marker) && text.endsWith(marker)) {
        const inner = text.slice(len, text.length - len);
        return {
          changes: { from: range.from, to: range.to, insert: inner },
          range: EditorSelection.range(range.from, range.from + inner.length),
        };
      }
      // Otherwise wrap the selection (or drop an empty pair at the cursor).
      return {
        changes: { from: range.from, to: range.to, insert: marker + text + marker },
        range: range.empty
          ? EditorSelection.cursor(range.from + len)
          : EditorSelection.range(range.from + len, range.to + len),
      };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

/** Wrap the selection as a markdown link, selecting the placeholder URL. */
const insertLink: Command = (view) => {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.doc.sliceString(range.from, range.to);
    const insert = `[${text}](url)`;
    const urlFrom = range.from + 1 + text.length + 2; // after "[text]("
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlFrom, urlFrom + 3),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

// One leading block marker (heading / quote / task / bullet / ordered list).
const LEADING_BLOCK = /^(?:>\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/;

/** Apply `fn` to every line touched by the selection, in one transaction. */
function editLines(view: EditorView, fn: (text: string) => string): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const next = fn(line.text);
      if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
    }
  }
  if (changes.length) {
    view.dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input" }));
  }
  return true;
}

/** Toggle an ATX heading of `level` on each line (re-press to remove). */
function toggleHeading(level: number): Command {
  const prefix = "#".repeat(level) + " ";
  return (view) =>
    editLines(view, (t) => {
      const m = t.match(/^(#{1,6})\s+/);
      if (m) return m[1].length === level ? t.slice(m[0].length) : prefix + t.slice(m[0].length);
      return prefix + t.replace(LEADING_BLOCK, "");
    });
}

/** Toggle a leading block marker (quote / list / task) on each line. */
function toggleBlock(test: RegExp, add: string): Command {
  return (view) =>
    editLines(view, (t) => (test.test(t) ? t.replace(test, "") : add + t.replace(LEADING_BLOCK, "")));
}

// Markdown formatting shortcuts (placed before defaults so they win).
const markdownKeymap = [
  { key: "Mod-b", run: toggleWrap("**"), preventDefault: true },
  { key: "Mod-i", run: toggleWrap("*"), preventDefault: true },
  { key: "Mod-Shift-x", run: toggleWrap("~~"), preventDefault: true },
  { key: "Mod-e", run: toggleWrap("`"), preventDefault: true },
  { key: "Mod-k", run: insertLink, preventDefault: true },
  { key: "Mod-Alt-1", run: toggleHeading(1), preventDefault: true },
  { key: "Mod-Alt-2", run: toggleHeading(2), preventDefault: true },
  { key: "Mod-Alt-3", run: toggleHeading(3), preventDefault: true },
  { key: "Mod-Shift-.", run: toggleBlock(/^>\s+/, "> "), preventDefault: true },
  { key: "Mod-Shift-8", run: toggleBlock(/^[-*+]\s+(?!\[)/, "- "), preventDefault: true },
  { key: "Mod-Shift-7", run: toggleBlock(/^\d+\.\s+/, "1. "), preventDefault: true },
  { key: "Mod-Shift-9", run: toggleBlock(/^[-*+]\s+\[[ xX]\]\s+/, "- [ ] "), preventDefault: true },
];

// The typography theme is swapped in/out through this compartment so changing
// font/size reconfigures the editor (triggering a full re-measure).
const themeCompartment = new Compartment();

const baseExtensions = [
  history(),
  EditorView.lineWrapping,
  markdown({ base: markdownLanguage, extensions: [GFM] }),
  syntaxHighlighting(folioHighlight),
  livePreview(),
  keymap.of(markdownKeymap),
  keymap.of([...defaultKeymap, ...historyKeymap]),
];

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function MarkdownEditor({ value, onChange }: Props) {
  const viewRef = useRef<EditorView | null>(null);

  // Initial extensions include the current typography theme in its compartment.
  const extensions = useMemo(
    () => [...baseExtensions, themeCompartment.of(buildTheme(getEditorMetrics()))],
    []
  );

  // When the user changes font/size (or fonts finish loading), reconfigure the
  // theme compartment with fresh concrete metrics. Reconfiguring makes
  // CodeMirror re-measure its geometry, so click-to-position stays exact.
  useEffect(() => {
    const reconfigure = () => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: themeCompartment.reconfigure(buildTheme(getEditorMetrics())),
      });
      view.requestMeasure();
    };
    window.addEventListener("folio:typography", reconfigure);
    if (document.fonts?.ready) document.fonts.ready.then(reconfigure).catch(() => {});
    return () => window.removeEventListener("folio:typography", reconfigure);
  }, []);

  return (
    <CodeMirror
      className="cm-host"
      value={value}
      onChange={onChange}
      height="100%"
      basicSetup={false}
      // Disable the library's built-in light theme (hard-codes a white bg); our
      // theme drives colors from CSS variables instead.
      theme="none"
      onCreateEditor={(view) => {
        viewRef.current = view;
        // Re-measure after the flex layout settles so the height model matches.
        requestAnimationFrame(() => view.requestMeasure());
      }}
      extensions={extensions}
      placeholder="Write in markdown…  # heading, **bold**, - lists, > quotes"
    />
  );
}
