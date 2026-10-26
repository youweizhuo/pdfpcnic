// Planned times from speaker notes, and how the talk keeps to them.
//
// A note may open with the times the talk should reach on its slide, as
// TokenSlides writes them into the .pdfpc file:
//
//   **01:22 → 01:58** · 36 s     the slide's window, m:ss from the start
//   **01:22**                    a slide planned to take no time
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

/** Takes the planned window off the front of a note. */
export function splitPlan(note: string): { plan: Plan | null; note: string } {
  const m = HEAD.exec(note.trimStart());
  if (!m) return { plan: null, note };
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = m[3] === undefined ? start : Number(m[3]) * 60 + Number(m[4]);
  if (end < start) return { plan: null, note };
  return { plan: { start, end }, note: note.trimStart().slice(m[0].length).trimStart() };
}

export type Tone = "early" | "on" | "late";

/**
 * Where `at` seconds into the talk stand against a slide's window. Anywhere
 * inside it is on time; `offset` is how far past its end (positive) or short
 * of its start (negative), and `fill` how much of it has gone by.
 */
export function against(plan: Plan, at: number): { offset: number; fill: number; tone: Tone } {
  const offset = at - Math.min(Math.max(at, plan.start), plan.end);
  const span = plan.end - plan.start;
  const fill = span > 0 ? Math.min(1, Math.max(0, (at - plan.start) / span)) : at >= plan.start ? 1 : 0;
  return { offset, fill, tone: offset > 0 ? "late" : offset < 0 ? "early" : "on" };
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
