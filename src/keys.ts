// pdfpc's default key bindings, plus `o` to open the audience window.

export type Action =
  | "next"
  | "prev"
  | "nextSlide"
  | "prevSlide"
  | "next10"
  | "prev10"
  | "nextAny"
  | "prevAny"
  | "first"
  | "last"
  | "back"
  | "forward"
  | "overview"
  | "goto"
  | "bookmark"
  | "toBookmark"
  | "normalMode"
  | "laserMode"
  | "bigger"
  | "smaller"
  | "freeze"
  | "blank"
  | "escape"
  | "fullscreen"
  | "audienceFullscreen"
  | "timerStart"
  | "timerPause"
  | "timerView"
  | "timerReset"
  | "endSlide"
  | "help"
  | "openAudience";

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
  "Shift+t": "timerView",
  "Ctrl+t": "timerReset",
  // Browsers keep Ctrl+T for a new tab outside fullscreen.
  "Shift+r": "timerReset",
  "Ctrl+e": "endSlide",
  "?": "help",
  o: "openAudience",
};

/** Normalizes a key event to the names above, e.g. "Shift+PageDown", "Ctrl+t", "?". */
export function keyName(e: KeyboardEvent): string {
  let key = e.key === " " ? "Space" : e.key;
  const letter = key.length === 1 && /[a-z]/i.test(key);
  if (letter) key = key.toLowerCase();
  // Shift is part of symbols like "?" and "+" already.
  const shift = e.shiftKey && (letter || key.length > 1);
  return `${e.ctrlKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${shift ? "Shift+" : ""}${key}`;
}

export function actionFor(e: KeyboardEvent): Action | null {
  if (e.metaKey) return null;
  return BINDINGS[keyName(e)] ?? null;
}

/** Key help, grouped for the cheat sheet. */
export const HELP: Array<[string, Array<[string, string]>]> = [
  [
    "Move",
    [
      ["→ ↓ PgDn Space Enter", "next step"],
      ["← ↑ PgUp Backspace", "previous (skips back over reveal steps)"],
      ["Shift+PgDn / PgUp", "next / previous slide"],
      ["Shift+→ / ←", "10 slides forward / back"],
      ["Home / End", "first / last slide"],
      ["Shift+N / Shift+P", "next / previous, including hidden"],
      ["Shift+Space / Backspace", "history forward / back"],
      ["g", "go to slide number"],
      ["Tab", "overview"],
      ["m / Shift+M", "bookmark / return to bookmark"],
    ],
  ],
  [
    "Audience",
    [
      ["o", "open the audience window"],
      ["Shift+W", "audience fullscreen (or present here)"],
      ["b", "black screen"],
      ["f", "freeze"],
      ["2 / 1", "laser pointer on / off"],
      ["Esc", "leave black, freeze, laser"],
    ],
  ],
  [
    "Presenter",
    [
      ["s / p", "start / pause timer"],
      ["Shift+T", "timer: elapsed, remaining, clock"],
      ["Ctrl+T or Shift+R", "reset timer"],
      ["Ctrl+E", "mark the end slide"],
      ["+ / −", "notes size (laser size in laser mode)"],
      ["w", "presenter fullscreen"],
      ["?", "this help"],
    ],
  ],
];
