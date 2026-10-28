// pdfpc's default key bindings, plus `o` to open the audience window, `[` `]`
// to size the current slide and `,` for settings.

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
  | "slideSmaller"
  | "slideBigger"
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
  "1": "normalMode",
  "2": "laserMode",
  "+": "bigger",
  "=": "bigger",
  "-": "smaller",
  f: "freeze",
  b: "blank",
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
  "[": "slideSmaller",
  "]": "slideBigger",
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
 * What people open the help for: what nothing on screen shows, keys and the
 * mouse (`true`). First and largest in the help.
 */
export const HELP_TOP: Array<[string, string, mouse?: true]> = [
  ["+ / −", "notes text size; the laser dot's while the laser is on"],
  ["[ / ]", "current slide smaller / bigger, for more room for notes"],
  ["Esc", "one step back: closes help and overview, ends black, freeze and laser, then leaves presenter fullscreen"],
  ["Drag a divider", "resize the columns, or the slide against its notes; double-click the thumbnails' divider to hide them", true],
  ["Click the bar", "its times on the clock, or as times of day", true],
  ["Drop a .pdfpc file", "on the window any time, to add its notes and timing to the deck that's open", true],
];

/** The rest, for reference: moving about, and the keys the buttons already show. */
export const HELP: Array<[string, Array<[string, string]>]> = [
  [
    "Move",
    [
      ["→ ↓ PgDn Space Enter", "next step"],
      ["← ↑ PgUp Backspace", "previous (skips back over reveal steps)"],
      ["Home / End", "first / last slide"],
      ["Shift+PgDn / PgUp", "next / previous slide, past reveal steps"],
      ["g", "go to a slide by its number"],
      ["Shift+Backspace / Space", "back / forward after a jump"],
      ["Shift+→ / ←", "10 slides forward / back"],
      ["Shift+N / Shift+P", "next / previous, including hidden"],
      ["m / Shift+M", "bookmark / back to it"],
      ["Ctrl+E", "mark this slide as the end"],
    ],
  ],
  [
    "On the buttons",
    [
      ["o", "open the audience window"],
      ["Shift+W", "audience fullscreen (or present here)"],
      ["w", "presenter fullscreen"],
      ["b / f", "black screen / freeze"],
      ["2 / 1", "laser pointer on / off"],
      ["Tab", "overview"],
      ["s / p", "start / pause the clock"],
      ["Shift+R or Ctrl+T", "reset the clock (pause it first)"],
      [",", "settings"],
      ["?", "this help"],
    ],
  ],
];
