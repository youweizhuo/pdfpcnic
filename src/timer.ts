// The talk timer, with pdfpc's rules: it starts when you first leave the
// first page (or at the first move after a reset), and pauses, resumes and
// resets on request. It always counts up
// from zero; pace is the pace panel's business (see pace.ts).

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

/** Ms until the talk's start time, or 0 when it has none or it has passed. */
export function untilStart(talk: Talk, now: number): number {
  return talk.startTime ? Math.max(0, clockTime(talk.startTime, now) - now) : 0;
}

/**
 * pdfpc's pace rule, for decks without planned times: ms behind an even pace
 * through the slides (negative when ahead).
 */
export function drift(t: TimerState, talk: Talk, now: number): number {
  const length = talkLength(t, talk, now);
  const expected = (length * (Math.min(talk.slide, talk.endSlide) + 0.5)) / (talk.endSlide + 1);
  return elapsed(t, now) - expected;
}

/** "H:MM:SS". */
export function format(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** Time of day, "HH:MM". */
export function formatClock(now: number): string {
  const d = new Date(now);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
