import { useEffect, useRef, useState } from "react";
import { Check, Lock } from "lucide-react";
import { saveEntry, type Entry } from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";

interface Props {
  entry: Entry;
  /** Bumped by the parent when the entry is changed externally (e.g. renamed). */
  syncKey: number;
  /** Daily word goal for the entry's folder; null/undefined hides the tracker. */
  goal?: number | null;
  /** True when the entry is encrypted and currently locked. */
  locked?: boolean;
  /** Open the password prompt to unlock encrypted folders. */
  onUnlock?: () => void;
  onSaved: (entry: Entry) => void;
}

type Status = "idle" | "saving" | "saved";

/** Whitespace-delimited word count, mirroring the backend's `split_whitespace`. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function Editor({ entry, syncKey, goal, locked, onUnlock, onSaved }: Props) {
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const [status, setStatus] = useState<Status>("idle");
  const loadedId = useRef(entry.id);

  // Load values when the selected entry changes, or when it's externally edited
  // (e.g. renamed from the sidebar), without triggering a save loop.
  useEffect(() => {
    loadedId.current = entry.id;
    setTitle(entry.title);
    setContent(entry.content);
    setStatus("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, syncKey]);

  // Debounced autosave whenever the title or body changes.
  useEffect(() => {
    if (title === entry.title && content === entry.content) return;
    setStatus("saving");
    const id = loadedId.current;
    const handle = setTimeout(async () => {
      try {
        const updated = await saveEntry(id, title, content);
        if (loadedId.current === id) setStatus("saved");
        onSaved(updated);
      } catch {
        setStatus("idle");
      }
    }, 600);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content]);

  if (locked) {
    return (
      <section className="editor">
        <div className="editor-locked">
          <div>
            <div className="locked-mark">
              <Lock size={40} />
            </div>
            <h2>This folder is locked</h2>
            <p>Enter your password to view and edit its contents.</p>
            <button className="primary" onClick={onUnlock}>
              Unlock
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="editor">
      <div className="editor-toolbar">
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
        />
        <div className="toolbar-right">
          {goal ? <WordGoal words={countWords(content)} goal={goal} /> : null}
          <span className="save-status">
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
          </span>
        </div>
      </div>

      <div className="editor-body">
        <MarkdownEditor value={content} onChange={setContent} />
      </div>
    </section>
  );
}

/** Live word count vs the daily goal, with a progress bar and green check. */
function WordGoal({ words, goal }: { words: number; goal: number }) {
  const done = words >= goal;
  const pct = Math.min(100, Math.round((words / goal) * 100));
  return (
    <div className={`word-goal ${done ? "done" : ""}`} title={`${words} / ${goal} words`}>
      <div className="word-goal-bar">
        <div className="word-goal-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="word-goal-label">
        {words} / {goal} {done ? <Check size={13} /> : null}
      </span>
    </div>
  );
}
