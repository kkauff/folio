import { Check, X } from "lucide-react";
import type { EntrySummary, Folder } from "../lib/api";
import {
  currentStreak,
  dailyWords,
  heatmapWeeks,
  localDay,
  longestStreak,
} from "../lib/stats";

interface Props {
  folder: Folder;
  /** All summaries; this component filters to the folder's entries. */
  entries: EntrySummary[];
  onClose: () => void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Progress view for a folder: totals always, plus a heatmap + goal stats when
 *  the folder has a daily word goal. */
export function DiaryStats({ folder, entries, onClose }: Props) {
  const goal = folder.settings.word_goal ?? 0;
  const inFolder = entries.filter((e) => e.folder_id === folder.id);

  // Universal stats (any folder).
  const totalPages = inFolder.length;
  const totalWords = inFolder.reduce((sum, e) => sum + e.word_count, 0);

  // Goal stats (folders with a daily word goal, computed from dated day-pages).
  const words = dailyWords(inFolder);
  const today = localDay();
  const todayWords = words.get(today) ?? 0;
  const streak = currentStreak(words, goal, today);
  const best = longestStreak(words, goal);
  const counts = [...words.values()];
  const daysWritten = counts.filter((w) => w > 0).length;
  const daysHit = counts.filter((w) => w >= goal).length;
  const hitRate = goal > 0 && daysWritten ? Math.round((daysHit / daysWritten) * 100) : 0;
  const weeks = heatmapWeeks(words, goal, 18, today);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal diary-stats" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{folder.name} · progress</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="diary-stats-body">
          <div className="stat-row">
            <div className="stat">
              <span className="stat-value">{totalWords.toLocaleString()}</span>
              <span className="stat-label">Total words</span>
            </div>
            <div className="stat">
              <span className="stat-value">{totalPages}</span>
              <span className="stat-label">{totalPages === 1 ? "Page" : "Pages"}</span>
            </div>
          </div>

          {goal > 0 ? (
            <>
              <div className="stat-row">
                <div className="stat">
                  <span className="stat-value">
                    {todayWords}
                    <span className="stat-sub"> / {goal}</span>
                    {todayWords >= goal ? <Check size={18} className="stat-check" /> : null}
                  </span>
                  <span className="stat-label">Today</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{hitRate}%</span>
                  <span className="stat-label">Goal hit rate</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{streak}</span>
                  <span className="stat-label">Current streak</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{best}</span>
                  <span className="stat-label">Best streak</span>
                </div>
              </div>

              <div className="heatmap">
                {weeks.map((col, i) => {
                  const firstOfMonth = col.find((c) => c.day.endsWith("-01"));
                  const monthLabel = firstOfMonth
                    ? MONTHS[Number(firstOfMonth.day.slice(5, 7)) - 1]
                    : "";
                  return (
                    <div className="heatmap-col" key={i}>
                      <span className="heatmap-month">{monthLabel}</span>
                      {col.map((cell) => {
                        const cls = cell.future
                          ? "future"
                          : cell.met
                          ? "met"
                          : cell.words > 0
                          ? "partial"
                          : "empty";
                        return (
                          <span
                            key={cell.day}
                            className={`heatmap-cell ${cls}`}
                            title={
                              cell.future
                                ? cell.day
                                : `${cell.day}: ${cell.words} words${cell.met ? " ✓" : ""}`
                            }
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              <p className="hint">
                Goal: {goal} words/day. A square turns green the day you hit it; hit
                rate is the share of days you wrote that reached the goal.
              </p>
            </>
          ) : (
            <p className="hint">
              No daily word goal set for this folder. Add one in Settings to track a
              calendar heatmap and hit rate.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
