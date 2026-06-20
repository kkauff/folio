// Pure helpers for the "750 words a day" tracker. Everything is derived from a
// diary folder's entry summaries: because a diary keeps exactly one page per
// calendar day, each summary's word_count *is* that day's word count.
import type { EntrySummary } from "./api";

/** Local calendar day as "YYYY-MM-DD" (the key used for diary day-pages). */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Day-page title in "16 June 2026" format (day month year). */
export function formatDayTitle(date: Date = new Date()): string {
  return `${date.getDate()} ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

/** Parse "YYYY-MM-DD" into a local Date at noon (DST-safe for day math). */
function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Shift a "YYYY-MM-DD" string by `n` days (may be negative). */
function addDays(day: string, n: number): string {
  const date = parseDay(day);
  date.setDate(date.getDate() + n);
  return localDay(date);
}

/** Map of day -> words written, built from a diary folder's summaries. */
export function dailyWords(summaries: EntrySummary[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of summaries) {
    if (!s.day) continue;
    map.set(s.day, (map.get(s.day) ?? 0) + s.word_count);
  }
  return map;
}

const met = (words: number | undefined, goal: number) =>
  (words ?? 0) >= goal && goal > 0;

/**
 * Consecutive goal-met days ending today (or yesterday, so a not-yet-written
 * today doesn't break an active streak).
 */
export function currentStreak(
  words: Map<string, number>,
  goal: number,
  today: string = localDay()
): number {
  let cursor = met(words.get(today), goal) ? today : addDays(today, -1);
  let streak = 0;
  while (met(words.get(cursor), goal)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Longest run of consecutive goal-met calendar days, ever. */
export function longestStreak(words: Map<string, number>, goal: number): number {
  const days = [...words.keys()]
    .filter((d) => met(words.get(d), goal))
    .sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export interface HeatCell {
  day: string;
  words: number;
  met: boolean;
  future: boolean;
}

/**
 * GitHub-style grid: `weeks` columns of 7 days (Sun..Sat), ending with the
 * week containing today. Cells after today are flagged `future`.
 */
export function heatmapWeeks(
  words: Map<string, number>,
  goal: number,
  weeks = 17,
  today: string = localDay()
): HeatCell[][] {
  // End on the Saturday of this week so today's column is the last one.
  const todayDate = parseDay(today);
  const endOfWeek = addDays(today, 6 - todayDate.getDay());
  const start = addDays(endOfWeek, -(weeks * 7 - 1));

  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      const count = words.get(day) ?? 0;
      col.push({
        day,
        words: count,
        met: met(count, goal),
        future: day > today,
      });
    }
    cols.push(col);
  }
  return cols;
}
