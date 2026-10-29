// Comparing the deck's plan with another `.pdfpc` file (core/compare.ts), in
// the presenter's own places: where this slide's line and the talk's are, two
// lines, the deck's over the other's in purple, with the difference under
// each; where the next slide's notes are, the other file's note for this
// slide, and in both notes the words the other doesn't have, marked. A badge
// on the next slide says it's on, and ends it.

import { otherPages, plansOf, wordDiff, words, type Plans } from "../core/compare.ts";
import type { Deck, Page } from "../core/deck.ts";
import { span } from "../core/pace.ts";
import { parsePdfpc } from "../core/pdfpc.ts";
import { $, el } from "./dom.ts";
import { renderNote } from "./notes.ts";

const marks = typeof CSS !== "undefined" && "highlights" in CSS;

export class Comparison {
  /** The other file's name. */
  readonly name: string;
  /** The other file, to compare with again once the deck's own is loaded anew. */
  readonly file: { name: string; text: string };
  /** The other file's notes and timing lines, on the deck's pages. */
  private pages: Page[];
  private ours!: Plans;
  private theirs!: Plans;
  private endSlide = -1;
  private page = -1;

  constructor(
    private deck: Deck,
    /** The deck's own `.pdfpc` file's name. */
    private ourName: string,
    other: { name: string; text: string },
  ) {
    this.name = other.name;
    this.file = other;
    this.pages = otherPages(deck, parsePdfpc(other.text));
  }

  /** Both plans with the talk's end slide, worked out again when it moves. */
  private plan(endSlide: number): void {
    if (endSlide === this.endSlide) return;
    this.endSlide = endSlide;
    this.ours = plansOf(this.ourName, this.deck.pages, this.deck, endSlide);
    this.theirs = plansOf(this.name, this.pages, this.deck, endSlide, 0);
  }

  /** The two lines and their differences, for `slide`. */
  renderTimes(slide: number, endSlide: number): void {
    this.plan(endSlide);
    const [a, b] = [this.ours, this.theirs];

    // This slide: its length in each, on one scale.
    const la = a.lengths[slide];
    const lb = b.lengths[slide];
    const most = Math.max(la, lb);
    const line = $("pace-slide");
    line.hidden = false;
    line.classList.toggle("none", !most);
    line.title = `This slide: ${span(la)} in ${a.name}, ${span(lb)} in ${b.name}`;
    const rows = line.querySelectorAll<HTMLElement>(".compare-lines .span");
    rows[0].style.width = share(la, most);
    rows[1].style.width = share(lb, most);
    times($("compare-slide"), most ? [la, lb] : null);

    // The whole talk: each plan's span, this slide's window in yellow on each.
    const bar = $("talkbar");
    bar.hidden = false;
    const scale = Math.max(a.end, b.end) * 1.05;
    bar.querySelectorAll<HTMLElement>(".compare-lines > div").forEach((row, i) => {
      const side = i ? b : a;
      row.querySelector<HTMLElement>(".span")!.style.width = share(side.end, scale);
      const slot = row.querySelector<HTMLElement>(".window")!;
      const w = side.windows[slide];
      slot.hidden = !w || !scale;
      if (w && scale) {
        slot.style.left = share(w.start, scale);
        slot.style.width = share(w.end - w.start, scale);
      }
    });
    times($("compare-talk"), a.end || b.end ? [a.end, b.end] : null);
    $("compare-talk").title = `The talk: ${span(a.end)} in ${a.name}, ${span(b.end)} in ${b.name}`;
  }

  /** The other file's note for `page` where the next slide's notes go, and the words each note doesn't share marked. */
  renderNotes(page: number, markdown: boolean): void {
    if (page === this.page) return;
    this.page = page;
    const body = $("next-notes-body");
    const note = this.pages[page].note;
    renderNote(body, note, markdown);
    $("next-notes").scrollTop = 0;
    if (!marks) return;
    const ours = wordsIn($("notes-body"));
    const theirs = wordsIn(body);
    const { removed, added } =
      this.deck.pages[page].note && note ? wordDiff(ours.map((w) => w.word), theirs.map((w) => w.word)) : { removed: [], added: [] };
    CSS.highlights.set("removed", new Highlight(...runs(removed, ours)));
    CSS.highlights.set("added", new Highlight(...runs(added, theirs)));
  }

  /** Takes the marks off the notes. */
  dispose(): void {
    if (!marks) return;
    CSS.highlights.delete("removed");
    CSS.highlights.delete("added");
  }
}

/** Two lines in one, the deck's over the other's, each a span from the left; with `windows`, this slide's part on each. */
export function compareLines(windows: boolean): HTMLElement {
  const lines = el("div", "compare-lines");
  for (const side of ["a", "b"]) {
    const row = el("div", side);
    row.append(el("i", "span"), ...(windows ? [el("i", "window")] : []));
    lines.append(row);
  }
  return lines;
}

const share = (part: number, whole: number) => `${whole ? ((Math.max(0, part) / whole) * 100).toFixed(3) : 0}%`;

/** The deck's time, the other's in purple, and how much longer or shorter it is. */
function times(target: HTMLElement, pair: [number, number] | null): void {
  if (!pair) return target.replaceChildren();
  const [a, b] = pair;
  const d = Math.round(b) - Math.round(a);
  const diff = d > 0 ? el("span", "t-late", `+${span(d)}`) : d < 0 ? el("span", "t-early", `−${span(d)}`) : el("span", "t-idle", "same");
  target.replaceChildren(el("span", "a", span(a)), " ", el("span", "b", span(b)), " ", diff);
}

/** The marked words as runs: words next to each other in the same text, one mark over them and the space between. */
function runs(marked: number[], all: Array<{ range: Range }>): Range[] {
  const out: Range[] = [];
  marked.forEach((i, k) => {
    const { range } = all[i];
    const last = out.at(-1);
    if (last && marked[k - 1] === i - 1 && last.endContainer === range.startContainer) last.setEnd(range.endContainer, range.endOffset);
    else out.push(range.cloneRange());
  });
  return out;
}

/** A rendered note's words, each with its place on the page. */
function wordsIn(root: HTMLElement): Array<{ word: string; range: Range }> {
  const out: Array<{ word: string; range: Range }> = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    for (const { word, at } of words(node.data)) {
      const range = new Range();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      out.push({ word, range });
    }
  }
  return out;
}
