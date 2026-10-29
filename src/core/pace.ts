// Planned times from speaker notes, and how the talk keeps to them.
//
// A note may open with the times the talk should reach on its slide, as
// TokenSlides writes them into the .pdfpc file:
//
//   **01:22 → 01:58** · 36 s     the slide's window, m:ss from the start
//   **01:22**                    a slide planned to take no time
//   **45 s**                     a backup slide: its length, off the talk's clock
//
// The line has to come first, on its own; `->` works for the arrow and
// minutes may pass 59. pdfpcnic draws it in the pace panel instead of
// showing it with the note.

export interface Plan {
  /** Seconds from the start of the talk. */
  start: number;
  end: number;
}

const HEAD = /^\*\*(\d+):([0-5]\d)(?:\s*(?:→|->)\s*(\d+):([0-5]\d))?\*\*(?:\s*·\s*\d+\s*s)?[ \t]*(?:\r?\n|$)/;
const LENGTH = /^\*\*(\d+)\s*s\*\*[ \t]*(?:\r?\n|$)/;

/** Takes the planned window, or a backup slide's length in seconds, off the front of a note. */
export function splitPlan(note: string): { plan: Plan | null; length: number | null; note: string } {
  const text = note.trimStart();
  const rest = (m: RegExpExecArray) => text.slice(m[0].length).trimStart();
  const len = LENGTH.exec(text);
  if (len) return { plan: null, length: Number(len[1]), note: rest(len) };
  const m = HEAD.exec(text);
  if (!m) return { plan: null, length: null, note };
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = m[3] === undefined ? start : Number(m[3]) * 60 + Number(m[4]);
  if (end < start) return { plan: null, length: null, note };
  return { plan: { start, end }, length: null, note: rest(m) };
}

/** Each slide's planned window, from its first step's start to its last step's end; null for a slide without one. */
export function slidePlans(plans: Array<Plan | null>, slides: number[][]): Array<Plan | null> {
  return slides.map((pages) => {
    const own = pages.flatMap((p) => plans[p] ?? []);
    return own.length ? { start: Math.min(...own.map((p) => p.start)), end: Math.max(...own.map((p) => p.end)) } : null;
  });
}

/** A slide's timing line, as the notes write it: its window from the start of the talk, or a backup slide's length. */
export function timingLine(plan: Plan | null, length: number): string {
  if (!plan) return `**${Math.round(length)} s**`;
  const own = Math.round(plan.end - plan.start);
  return own ? `**${mark(plan.start)} → ${mark(plan.end)}** · ${own} s` : `**${mark(plan.start)}**`;
}

/** A span of seconds: "12 s" or "1:20". */
export function span(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A point in the talk as the notes write it: "01:22". */
export function mark(seconds: number): string {
  const s = Math.round(Math.max(0, seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * How far off is too far, in seconds (`time`) or as shares of the talk's
 * target length (`share`): being early by up to `early` passes without a
 * color; being late always shows, `serious` and `severe` mark the next levels.
 */
export interface Slack {
  unit: "time" | "share";
  early: number;
  serious: number;
  severe: number;
}

/** Defaults for each unit. */
export const SLACK: Record<Slack["unit"], Slack> = {
  time: { unit: "time", early: 60, serious: 60, severe: 120 },
  share: { unit: "share", early: 0.05, serious: 0.03, severe: 0.06 },
};

export type Grade = "early" | "on" | "late" | "serious" | "severe";

/** Grades `offset` seconds off plan (positive: late) in a talk of `target` seconds. */
export function grade(offset: number, target: number, slack: Slack): Grade {
  const limit = (v: number) => (slack.unit === "time" ? v : v * target);
  if (offset > 0) return offset >= limit(slack.severe) ? "severe" : offset >= limit(slack.serious) ? "serious" : "late";
  return -offset > limit(slack.early) ? "early" : "on";
}
