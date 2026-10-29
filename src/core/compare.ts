// Two plans of one talk side by side: the deck's own `.pdfpc` file and another,
// a run's times saved at its end, say, or an earlier export. The other file
// is read onto the deck's pages and slides, so the two line up slide by slide;
// only its notes and timing lines count.

import { buildDeck, type Deck, type Page } from "./deck.ts";
import { slidePlans, timingLine, type Plan } from "./pace.ts";
import type { PdfpcFile } from "./pdfpc.ts";

/** One side: each slide's window and length, and each page's note. */
export interface Plans {
  name: string;
  /** Each slide's window in the talk proper; null off the plan, and for backup slides. */
  windows: Array<Plan | null>;
  /** Each slide's seconds: its window's, or a backup slide's length. */
  lengths: number[];
  /** Where the talk proper ends. */
  end: number;
  /** Each page's note, without its timing line. */
  notes: string[];
}

/**
 * A side's plans, slide by slide, as the talk reads them: from the timing
 * lines; without any, the talk's length split evenly over its slides.
 */
export function plansOf(name: string, pages: Page[], deck: Deck, endSlide: number, duration = deck.duration): Plans {
  let windows = slidePlans(pages.map((p) => p.plan), deck.slides).map((w, s) => (s > endSlide ? null : w));
  const length = duration * 60;
  if (!windows.some(Boolean) && length) {
    const n = endSlide + 1;
    windows = deck.slides.map((_, s) => (s < n ? { start: (s * length) / n, end: ((s + 1) * length) / n } : null));
  }
  const lengths = deck.slides.map((own, s) => {
    const w = windows[s];
    return w ? w.end - w.start : s > endSlide ? Math.max(0, ...own.map((p) => pages[p].length ?? 0)) : 0;
  });
  return { name, windows, lengths, end: Math.max(0, ...windows.map((w) => w?.end ?? 0)), notes: pages.map((p) => p.note) };
}

/** Another `.pdfpc` file's pages: its notes and timing lines, on the deck's pages. */
export function otherPages(deck: Deck, meta: PdfpcFile): Page[] {
  const info = deck.pages.map((p) => ({ width: p.width, height: p.height, label: p.label, note: "", links: [] }));
  return buildDeck(deck.name, info, meta).pages;
}

/**
 * A run's times as a `.pdfpc` file: each slide's timing line, its window as
 * long as the run spent on it, in the order of the slides; a backup slide
 * that took time, its length. Notes are left out: they're the deck's.
 */
export function runFile(deck: Deck, endSlide: number, spent: number[]): string {
  let at = 0;
  const lines = deck.slides.map((_, s) => {
    if (s > endSlide) return spent[s] ? timingLine(null, spent[s]) : "";
    const plan = { start: at, end: at + spent[s] };
    at = plan.end;
    return timingLine(plan, 0);
  });
  // Each page as pdfpc names it: by its label, and its place among the pages with that label.
  let overlay = 0;
  const pages = deck.pages.map((p, i) => {
    overlay = i > 0 && deck.pages[i - 1].label === p.label ? overlay + 1 : 0;
    const note = lines[p.slide];
    return JSON.stringify({ idx: i, label: p.label, overlay, ...(note ? { note } : {}) });
  });
  const head = { pdfpcFormat: 2, ...(deck.duration ? { duration: deck.duration } : {}), endSlide };
  const fields = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `{\n${fields.join("\n")}\n  "pages": [\n${pages.map((p) => `    ${p}`).join(",\n")}\n  ]\n}\n`;
}

/** The run file's name: the PDF's, and when it was saved, as "talk-20261028-1430.pdfpc". */
export function runName(pdfName: string, at: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const day = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
  return `${pdfName.replace(/\.pdf$/i, "")}-${day}-${two(at.getHours())}${two(at.getMinutes())}.pdfpc`;
}

// The notes, word by word

/**
 * A note's words, each with where it starts: runs of letters and digits, a
 * mark on its own, and in Chinese and Japanese, which don't space their
 * words, each character.
 */
export function words(text: string): Array<{ word: string; at: number }> {
  return [...text.matchAll(WORD)].map((m) => ({ word: m[0], at: m.index }));
}

const CJK = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}`;
const WORD = new RegExp(String.raw`[${CJK}]|(?:(?![${CJK}])[\p{L}\p{N}\p{M}])+(?:['’-](?:(?![${CJK}])[\p{L}\p{N}\p{M}])+)*|[^\s\p{L}\p{N}\p{M}]`, "gu");

/**
 * What a word diff marks: the words of `a` that aren't in `b`, and those of
 * `b` that aren't in `a`, as indices, around the longest run they share in
 * order. Notes too long to compare quickly get no marks.
 */
export function wordDiff(a: string[], b: string[]): { removed: number[]; added: number[] } {
  const n = a.length;
  const m = b.length;
  if (n * m > 1_000_000) return { removed: [], added: [] };
  // shared[i * w + j]: how many words a[i..] and b[j..] share in order.
  const w = m + 1;
  const shared = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      shared[i * w + j] = a[i] === b[j] ? shared[(i + 1) * w + j + 1] + 1 : Math.max(shared[(i + 1) * w + j], shared[i * w + j + 1]);
    }
  }
  const removed: number[] = [];
  const added: number[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (shared[(i + 1) * w + j] >= shared[i * w + j + 1]) removed.push(i++);
    else added.push(j++);
  }
  while (i < n) removed.push(i++);
  while (j < m) added.push(j++);
  return { removed, added };
}
