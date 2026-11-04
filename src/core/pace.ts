// How long each note should take, and how the talk keeps to it.
//
// A note may open with its length, in the speaker notes' own syntax, on the
// note's first line or on a line of its own:
//
//   [36s] Good morning, everyone.
//   [1.5min]
//
// Anywhere else it's just text. pdfpcnic draws it in the pace panel instead of
// showing it with the note, and adds the lengths up into the talk's plan.

export interface Plan {
  /** Seconds from the start of the talk. */
  start: number;
  end: number;
}

/** A note read: its length, the note without it, and what tells it from another note on the same slide. */
export interface ReadNote {
  seconds: number | null;
  note: string;
  said: string;
}

const LENGTH = /^\[\s*(\d+(?:\.\d+)?)\s*(s|min)\s*\]\s*/;

/** Whether a note opens with its length. */
export const hasLength = (note: string) => LENGTH.test(note.trimStart());

/** Takes the length off the front of a note. Two notes are the same if they say the same: references don't count. */
export function readNote(note: string): ReadNote {
  const text = note.trimStart();
  const said = text.split("[ref]")[0].trim();
  const m = LENGTH.exec(text);
  if (!m) return { seconds: null, note, said };
  return { seconds: Math.round(Number(m[1]) * (m[2] === "min" ? 60 : 1)), note: text.slice(m[0].length), said };
}

// Deprecated: the timing lines of 1.4 and before, read from files with no
// length in any note, and never written. Goes in 2.0.
//
//   **01:22 → 01:58** · 36 s     a window, m:ss from the start of the talk
//   **01:22**                    a slide planned to take no time
//   **45 s**                     a backup slide's length
const OLD_WINDOW = /^\*\*(\d+):([0-5]\d)(?:\s*(?:→|->)\s*(\d+):([0-5]\d))?\*\*(?:\s*·\s*\d+\s*s)?[ \t]*(?:\r?\n|$)/;
const OLD_LENGTH = /^\*\*(\d+)\s*s\*\*[ \t]*(?:\r?\n|$)/;

/** Reads a note as 1.4 wrote it. Only a window's length counts; a paragraph opening with *ref* becomes a reference. */
export function readOldNote(note: string): ReadNote {
  const text = note.trimStart();
  const rest = (m: RegExpExecArray) => text.slice(m[0].length).trimStart().replace(/(^|\n\s*\n)\*ref\*/g, "$1[ref]");
  const len = OLD_LENGTH.exec(text);
  if (len) return { seconds: Number(len[1]), note: rest(len), said: len[0] };
  const m = OLD_WINDOW.exec(text);
  const clock = (min: string, sec: string) => Number(min) * 60 + Number(sec);
  const seconds = m && (m[3] === undefined ? 0 : clock(m[3], m[4]) - clock(m[1], m[2]));
  if (!m || seconds === null || seconds < 0) return { seconds: null, note: note.replace(/(^|\n\s*\n)\*ref\*/g, "$1[ref]"), said: text };
  return { seconds, note: rest(m), said: m[0] };
}

/** The plan: each page's window, each slide's, and where the talk proper ends. */
export interface Layout {
  /** Whether any page of the talk proper has a length. */
  timed: boolean;
  /** A page's window, from its own length or the step before it; null before the slide's first length, and past the end slide. */
  pages: Array<Plan | null>;
  /** A slide's window, from its first step's start to its last step's end; null past the end slide. */
  slides: Array<Plan | null>;
  end: number;
}

/** Adds the lengths up through the end slide. A slide with none takes no time. */
export function layOut(pages: Array<{ seconds: number | null }>, slides: number[][], endSlide: number): Layout {
  const out: Layout = { timed: false, pages: pages.map(() => null), slides: slides.map(() => null), end: 0 };
  let at = 0;
  for (let s = 0; s < slides.length && s <= endSlide; s++) {
    const start = at;
    let step: Plan | null = null;
    for (const p of slides[s]) {
      const seconds = pages[p].seconds;
      if (seconds !== null) {
        step = { start: at, end: (at += seconds) };
        out.timed = true;
      }
      out.pages[p] = step;
    }
    out.slides[s] = { start, end: at };
  }
  out.end = at;
  return out;
}

/** A slide's own seconds, whether or not it's in the talk proper. */
export const slideLength = (pages: Array<{ seconds: number | null }>, own: number[]) => own.reduce((sum, p) => sum + (pages[p].seconds ?? 0), 0);

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
