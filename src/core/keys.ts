// pdfpc's default key bindings, plus `l` for the laser, `o` to open the
// audience window, `[` `]` and `0` for the slides' size, `t` and `e` for the
// clocks, `,` for settings, and `.` for a presentation remote's black button.

/** What a key does to the talk itself: where it is, what the audience sees, the clock (see talk.ts). */
const TALK_ACTIONS = [
  "next",
  "prev",
  "nextSlide",
  "prevSlide",
  "next10",
  "prev10",
  "nextAny",
  "prevAny",
  "first",
  "last",
  "back",
  "forward",
  "bookmark",
  "toBookmark",
  "normalMode",
  "laserMode",
  "freeze",
  "blank",
  "escape",
  "timerStart",
  "timerPause",
  "timerReset",
  "endSlide",
] as const;

export type TalkAction = (typeof TALK_ACTIONS)[number];

/** What a key does to the presenter's view and the windows (see ui/presenter.ts). */
export type ViewAction =
  | "overview"
  | "goto"
  | "bigger"
  | "smaller"
  | "fullscreen"
  | "audienceFullscreen"
  | "help"
  | "openAudience"
  | "prepareSharing"
  | "prepareProjector"
  | "slideSmaller"
  | "slideBigger"
  | "resetLayout"
  | "timesOfDay"
  | "earlyLate"
  // The button beside Open, with no key: Save run, and End comparison in its place while comparing.
  | "saveRun"
  | "endCompare"
  | "settings";

export type Action = TalkAction | ViewAction;

export const isTalkAction = (a: Action): a is TalkAction => (TALK_ACTIONS as readonly string[]).includes(a);

/** A key press, as the browser reports it. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const BINDINGS: Record<string, Action> = {
  ArrowRight: "next",
  ArrowDown: "next",
  PageDown: "next",
  Enter: "next",
  Space: "next",
  ArrowLeft: "prev",
  ArrowUp: "prev",
  PageUp: "prev",
  Backspace: "prev",
  "Shift+PageDown": "nextSlide",
  "Shift+PageUp": "prevSlide",
  "Shift+ArrowRight": "next10",
  "Shift+ArrowLeft": "prev10",
  "Shift+n": "nextAny",
  "Shift+p": "prevAny",
  Home: "first",
  End: "last",
  "Shift+Backspace": "back",
  "Shift+Space": "forward",
  Tab: "overview",
  g: "goto",
  m: "bookmark",
  "Shift+m": "toBookmark",
  l: "laserMode",
  // pdfpc's: normal mode and the pointer.
  "1": "normalMode",
  "2": "laserMode",
  "+": "bigger",
  "=": "bigger",
  "-": "smaller",
  f: "freeze",
  b: "blank",
  // What a presentation remote's black button sends. pdfpc leaves it unbound, so nothing of its is changed.
  ".": "blank",
  Escape: "escape",
  w: "fullscreen",
  "Shift+w": "audienceFullscreen",
  s: "timerStart",
  p: "timerPause",
  "Ctrl+t": "timerReset",
  // Browsers keep Ctrl+T for a new tab outside fullscreen.
  "Shift+r": "timerReset",
  "Ctrl+e": "endSlide",
  "?": "help",
  o: "openAudience",
  "Shift+o": "prepareSharing",
  "[": "slideSmaller",
  "]": "slideBigger",
  "0": "resetLayout",
  t: "timesOfDay",
  e: "earlyLate",
  ",": "settings",
};

/** Normalizes a key event to the names above, e.g. "Shift+PageDown", "Ctrl+t", "?". */
export function keyName(e: KeyPress): string {
  let key = e.key === " " ? "Space" : e.key;
  const letter = key.length === 1 && /[a-z]/i.test(key);
  if (letter) key = key.toLowerCase();
  // Shift is part of symbols like "?" and "+" already.
  const shift = e.shiftKey && (letter || key.length > 1);
  return `${e.ctrlKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${shift ? "Shift+" : ""}${key}`;
}

export function actionFor(e: KeyPress): Action | null {
  if (e.metaKey) return null;
  return BINDINGS[keyName(e)] ?? null;
}

/**
 * A key that does nothing here, as in pdfpc, but that a browser would act on. A presentation remote's start button
 * sends F5 and Esc in turn, and F5 would reload the page mid-talk. Esc stays what it is: it can't be told from a
 * keyboard's. Ctrl+F5 and the browser's own reload still work.
 */
export const isIgnored = (e: KeyPress) => !e.metaKey && /^(Shift\+)?F5$/.test(keyName(e));

/**
 * The help: a table of keys for each group, and what the mouse does. Highlighted, as a key or a
 * mouse move: what nothing on screen shows, so what people open the help for.
 */
export const HELP: Array<[string, Array<[string, string, highlight?: "key" | "mouse"]>]> = [
  [
    "Move",
    [
      ["→ ↓ PgDn Space Enter", "next step"],
      ["← ↑ PgUp Backspace", "previous (skips reveal steps)"],
      ["Home / End", "first / last slide"],
      ["Shift+PgDn / PgUp", "next / previous whole slide"],
      ["Shift+→ / ←", "10 slides forward / back"],
      ["Shift+N / Shift+P", "next / previous, even hidden"],
      ["Shift+Backspace / Space", "back / forward after a jump"],
      ["g", "go to a slide by its number"],
      ["Tab", "overview", "key"],
      ["m / Shift+M", "bookmark / back to it"],
      ["Mouse to the right edge", "the thumbnails: rest on one to see it large, click to jump", "mouse"],
    ],
  ],
  [
    "Audience",
    [
      ["o", "open the audience window"],
      ["Shift+O", "prepare the audience window for screen sharing"],
      ["Shift+W", "audience fullscreen (or present here)"],
      ["b or .", "black screen"],
      ["f", "freeze"],
      ["l", "laser on / off (or 2 / 1, as in pdfpc)"],
      ["Esc", "one step back: closes help and overview, ends black, freeze and laser, then leaves fullscreen (the audience's only on one screen)", "key"],
    ],
  ],
  [
    "Presenter",
    [
      ["s / p", "start / pause the clock"],
      ["Shift+R or Ctrl+T", "reset the clock (pause it first)"],
      ["Ctrl+E", "mark this slide as the end"],
      ["t", "the clock as the time of day, or back", "key"],
      ["e", "where the talk would end, or how early or late", "key"],
      ["+ / −", "notes size; the laser dot's when on", "key"],
      ["[ / ]", "slides smaller / bigger", "key"],
      ["0", "columns and slides as at first", "key"],
      ["Drag a divider", "resize columns, or slides and notes", "mouse"],
      ["Drop a .pdfpc file", "its notes and timing; with another name than the deck's, compared with it", "mouse"],
      ["w", "presenter fullscreen"],
      [", / ?", "settings / this help", "key"],
    ],
  ],
];
