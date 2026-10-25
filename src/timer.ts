// The talk timer, with pdfpc's rules: it starts when you first leave the
// first page, counts down when the talk has a length, and colors itself by
// pace: orange when behind, blue when ahead (by over a minute), red once over
// time.

export type TimerView = "elapsed" | "remaining" | "clock";
export type Tone = "idle" | "normal" | "ahead" | "behind" | "over" | "paused" | "pre";

export interface TimerState {
  /** Epoch ms when the talk started, null before. */
  startedAt: number | null;
  /** Epoch ms when paused, null while running. */
  pausedAt: number | null;
  /** Total ms spent paused. */
  pausedFor: number;
}

export const freshTimer = (): TimerState => ({ startedAt: null, pausedAt: null, pausedFor: 0 });

export function elapsed(t: TimerState, now: number): number {
  if (t.startedAt === null) return 0;
  return (t.pausedAt ?? now) - t.startedAt - t.pausedFor;
}

export function start(t: TimerState, now: number): TimerState {
  return t.startedAt === null ? { startedAt: now, pausedAt: null, pausedFor: 0 } : t;
}

export function togglePause(t: TimerState, now: number): TimerState {
  if (t.startedAt === null) return start(t, now);
  if (t.pausedAt === null) return { ...t, pausedAt: now };
  return { ...t, pausedAt: null, pausedFor: t.pausedFor + (now - t.pausedAt) };
}

/** Today's epoch ms for an "HH:MM" time. */
function clockTime(hhmm: string, now: number): number {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export interface Talk {
  /** Minutes, 0 for none. */
  duration: number;
  startTime?: string;
  endTime?: string;
  /** 0-based slide shown now, and the last slide of the talk proper. */
  slide: number;
  endSlide: number;
}

/** Talk length in ms: from the end time if one is set, else from the duration. */
export function talkLength(t: TimerState, talk: Talk, now: number): number {
  if (talk.endTime) {
    const from = t.startedAt ?? now;
    const ms = clockTime(talk.endTime, from) - from;
    if (ms > 0) return ms;
  }
  return talk.duration * 60_000;
}

export interface Reading {
  text: string;
  tone: Tone;
}

export function read(t: TimerState, talk: Talk, view: TimerView, now: number): Reading {
  if (view === "clock") return { text: formatClock(now), tone: "normal" };
  if (t.startedAt === null) {
    if (talk.startTime) {
      const until = clockTime(talk.startTime, now) - now;
      if (until > 0) return { text: format(-until), tone: "pre" };
    }
    const length = talkLength(t, talk, now);
    return { text: format(view === "remaining" ? length : 0), tone: "idle" };
  }
  const spent = elapsed(t, now);
  const length = talkLength(t, talk, now);
  const shown = view === "remaining" && length ? length - spent : spent;
  if (t.pausedAt !== null) return { text: format(shown), tone: "paused" };
  if (!length) return { text: format(shown), tone: "normal" };
  if (spent > length) return { text: format(shown), tone: "over" };
  const slides = talk.endSlide + 1;
  const expected = (length * (Math.min(talk.slide, talk.endSlide) + 0.5)) / slides;
  const drift = spent - expected;
  return { text: format(shown), tone: drift > 60_000 ? "behind" : drift < -60_000 ? "ahead" : "normal" };
}

function format(ms: number): string {
  const sign = ms < 0 ? "−" : "";
  const s = Math.floor(Math.abs(ms) / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${sign}${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

function formatClock(now: number): string {
  const d = new Date(now);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
