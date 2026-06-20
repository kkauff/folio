// "Live preview" markdown rendering for the Write editor: hides the markdown
// syntax markers (so **bold** shows as bold, # Heading as a heading), and
// reveals the raw markers again on whichever line the caret is on — Obsidian
// "Live Preview" style. Content styling (bold/italic/heading sizes) comes from
// the existing folioHighlight; this only hides markers + styles list/quote bits.
import { syntaxTree } from "@codemirror/language";
import { type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/** Marker node names whose text should be hidden when the line is inactive. */
const HIDDEN_MARKS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "LinkMark",
  "URL",
]);

/** A rendered bullet that replaces an unordered list's `-`/`*` marker. */
class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    span.textContent = "•";
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

/** A clickable checkbox that replaces a `[ ]`/`[x]` task marker. */
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-task-checkbox";
    return box;
  }
  // Let the event reach the editor so the mousedown handler can toggle it.
  ignoreEvent() {
    return false;
  }
}

const hideMark = Decoration.replace({});
const bulletMark = Decoration.replace({ widget: new BulletWidget() });
const checkboxChecked = Decoration.replace({ widget: new CheckboxWidget(true) });
const checkboxUnchecked = Decoration.replace({ widget: new CheckboxWidget(false) });
const listMarker = Decoration.mark({ class: "cm-list-marker" });
const quoteLine = Decoration.line({ class: "cm-blockquote" });

/** Line numbers that contain any part of a selection (shown as raw markdown). */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const from = view.state.doc.lineAt(range.from).number;
    const to = view.state.doc.lineAt(range.to).number;
    for (let n = from; n <= to; n++) lines.add(n);
  }
  return lines;
}

interface Built {
  /** Everything (replaces, marks, line decorations) for rendering. */
  decorations: DecorationSet;
  /** Only the text-replacing decorations — the caret skips these. */
  atomic: DecorationSet;
}

function buildDecorations(view: EditorView): Built {
  const active = activeLines(view);
  const all: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const { doc } = view.state;

  // Hidden/replaced ranges go in both sets; color-only marks go in `all` only.
  const replace = (from: number, to: number, d: Decoration) => {
    all.push(d.range(from, to));
    atomic.push(d.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const line = doc.lineAt(node.from);
        const isActive = active.has(line.number);

        if (node.name === "QuoteMark") {
          if (!isActive) {
            const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            replace(node.from, end, hideMark);
          }
          all.push(quoteLine.range(line.from));
          return;
        }

        if (node.name === "ListMark") {
          const marker = doc.sliceString(node.from, node.to);
          const unordered = marker === "-" || marker === "*" || marker === "+";
          const isTask = /^\s*\[[ xX]\]/.test(doc.sliceString(node.to, line.to));
          if (isActive) {
            all.push(listMarker.range(node.from, node.to));
          } else if (isTask) {
            // Hide "- " so the rendered checkbox stands in for the marker.
            const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            replace(node.from, end, hideMark);
          } else if (unordered) {
            replace(node.from, node.to, bulletMark);
          } else {
            all.push(listMarker.range(node.from, node.to)); // ordered number
          }
          return;
        }

        // Render `[ ]`/`[x]` as a checkbox when inactive; raw (muted) while editing.
        if (node.name === "TaskMarker") {
          if (isActive) {
            all.push(listMarker.range(node.from, node.to));
          } else {
            const checked = /[xX]/.test(doc.sliceString(node.from, node.to));
            replace(node.from, node.to, checked ? checkboxChecked : checkboxUnchecked);
          }
          return;
        }

        if (isActive || !HIDDEN_MARKS.has(node.name)) return;

        // Only hide a URL that's the `](url)` target of a labelled link — never a
        // bare/autolink URL, which would otherwise disappear from the text.
        if (node.name === "URL" && doc.sliceString(node.from - 1, node.from) !== "(") return;

        if (node.name === "HeaderMark") {
          const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
          replace(node.from, end, hideMark);
        } else if (node.from < node.to) {
          replace(node.from, node.to, hideMark);
        }
      },
    });
  }

  // `true` lets CodeMirror sort the mixed line/mark/replace decorations.
  return {
    decorations: Decoration.set(all, true),
    atomic: Decoration.set(atomic, true),
  };
}

/** Flip the `[ ]`/`[x]` status of the task on the line containing `pos`. */
function toggleTaskAt(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos);
  const m = line.text.match(/^(\s*[-*+]\s+\[)([ xX])\]/);
  if (!m) return false;
  const at = line.from + m[1].length; // the status char inside the brackets
  view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === " " ? "x" : " " } });
  return true;
}

/** Clicking a rendered checkbox toggles the underlying `[ ]`/`[x]` markdown. */
const taskToggleHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement;
    if (target.nodeName === "INPUT" && target.classList.contains("cm-task-checkbox")) {
      return toggleTaskAt(view, view.posAtDOM(target));
    }
    return false;
  },
});

/** Live-preview extension: marker hiding + caret-skipping over hidden ranges. */
export function livePreview(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      atomic: DecorationSet;
      constructor(view: EditorView) {
        const built = buildDecorations(view);
        this.decorations = built.decorations;
        this.atomic = built.atomic;
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged) {
          const built = buildDecorations(u.view);
          this.decorations = built.decorations;
          this.atomic = built.atomic;
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      // Only the replacing decorations are atomic, so the caret skips hidden
      // markers but can still edit muted text (ordered numbers, checkboxes).
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? Decoration.none),
    }
  );
  return [plugin, taskToggleHandler];
}
