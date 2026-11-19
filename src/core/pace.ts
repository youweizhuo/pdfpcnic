// How long each note should take, and how the talk keeps to it.
//
// A note may open with its length, in the speaker notes' own syntax, on the
// note's first line or on a line of its own:
//
//   [36s] Good morning, everyone.
//   [1.5min]
//   [2m]
//   [1m30s]
//   [1:30]
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

const SINGLE_LENGTH = /^\[\s*(\d+(?:\.\d+)?)\s*(s|min|m)\s*\](?![(\[:])\s*/;
const COMPOUND_LENGTH = /^\[\s*(\d+)\s*(?:min|m)\s*(\d+(?:\.\d+)?)\s*s\s*\](?![(\[:])\s*/;
const CLOCK_LENGTH = /^\[\s*(\d+):([0-5]\d)\s*\](?![(\[:])\s*/;
const COMMON_RATIOS = new Set(["16:9", "16:10", "4:3", "21:9", "3:2", "1:1"]);
const SUSPECT_UNIT = /^[~≈]?\s*\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i;
const SUSPECT_CLOCK = /^\d+\s*:\s*\d+(?::\d+)?\s*[a-z]*$/i;

function matchLength(text: string): { raw: string; seconds: number } | null {
  const c = COMPOUND_LENGTH.exec(text);
  if (c) return { raw: c[0], seconds: Math.round(Number(c[1]) * 60 + Number(c[2])) };
  const s = SINGLE_LENGTH.exec(text);
  if (s) return { raw: s[0], seconds: Math.round(Number(s[1]) * (s[2] === "s" ? 1 : 60)) };
  const k = CLOCK_LENGTH.exec(text);
  if (k) return { raw: k[0], seconds: Number(k[1]) * 60 + Number(k[2]) };
  return null;
}

/** Whether a note opens with its length. */
export const hasLength = (note: string) => matchLength(note.trimStart()) !== null;

/** A leading bracketed tag that looks like a mistyped length (e.g. "[36 sec]"), or null. */
export function badLength(note: string): string | null {
  const text = note.trimStart();
  if (matchLength(text)) return null;
  const m = /^\[([^\]\r\n]{1,24})\](?![(\[:])/.exec(text);
  if (!m) return null;
  const inner = m[1].trim();
  const compact = inner.replace(/\s+/g, "");
  if (SUSPECT_UNIT.test(inner)) return m[0];
  if (SUSPECT_CLOCK.test(inner) && !COMMON_RATIOS.has(compact)) return m[0];
  return null;
}

/**
 * Splits a note into what's spoken and its trailing reference. `[ref]` counts
 * only at the start of a line outside fenced code blocks, so inline mentions
 * like `` `[ref]` `` stay in the note.
 */
export function splitRef(note: string): { body: string; ref: string } {
  let fence: { char: string; len: number } | null = null;
  for (let at = 0; at <= note.length; ) {
    const nl = note.indexOf("\n", at);
    const end = nl < 0 ? note.length : nl;
    const line = end > at && note[end - 1] === "\r" ? note.slice(at, end - 1) : note.slice(at, end);
    const f = /^[ ]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence.char && f[1].length >= fence.len && !f[2].trim()) fence = null;
    } else if (f && (f[1][0] === "~" || !f[2].includes("`"))) {
      fence = { char: f[1][0], len: f[1].length };
    } else if (/^[ ]{0,3}\[ref\](?=[ \t]|$)/.test(line)) {
      return {
        body: note.slice(0, at),
        ref: note.slice(at).replace(/^[ ]{0,3}\[ref\](?:[ \t]+|$)/gm, "").trim(),
      };
    }
    if (nl < 0) break;
    at = nl + 1;
  }
  return { body: note, ref: "" };
}

/** Takes the length off the front of a note. Two notes are the same if they say the same: references don't count. */
export function readNote(note: string): ReadNote {
  const text = note.trimStart();
  const m = matchLength(text);
  if (!m) return { seconds: null, note, said: splitRef(text).body.trim() };
  const rest = text.slice(m.raw.length);
  return { seconds: m.seconds, note: rest, said: (m.raw + splitRef(rest).body).trim() };
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
 * target length (`share`): the `early` and `late` margins are neutral;
 * `serious` and `severe` mark the stronger late colors.
 */
export interface Slack {
  unit: "time" | "share";
  early: number;
  late: number;
  serious: number;
  severe: number;
}

/** Defaults for each unit. */
export const SLACK: Record<Slack["unit"], Slack> = {
  time: { unit: "time", early: 60, late: 60, serious: 90, severe: 120 },
  share: { unit: "share", early: 0.05, late: 0.05, serious: 0.07, severe: 0.10 },
};

export type Grade = "early" | "on" | "late" | "serious" | "severe";

/** Grades `offset` seconds off plan (positive: late) in a talk of `target` seconds. */
export function grade(offset: number, target: number, slack: Slack): Grade {
  const delta = slack.unit === "time" ? offset : offset / target;
  if (delta > slack.late) return delta >= slack.severe ? "severe" : delta >= slack.serious ? "serious" : "late";
  return -delta > slack.early ? "early" : "on";
}
