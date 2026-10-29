// Comparing the deck's plan with another `.pdfpc` file (core/compare.ts), in
// the presenter's own places. This slide's line and the talk's show the talk
// run again in the other file's times, as they would stand at the end of this
// slide, in the pace's colors; so do the thumbnails' lines, each its slide's.
// Under the lines, both times and the difference. Where the next slide's notes
// are, the other file's note for this slide, and in both notes the words the
// other doesn't have, marked.

import { otherPages, plansOf, wordDiff, words, type Plans } from "../core/compare.ts";
import type { Deck, Page } from "../core/deck.ts";
import { grade, span, type Grade, type Plan, type Slack } from "../core/pace.ts";
import { parsePdfpc } from "../core/pdfpc.ts";
import { $, el } from "./dom.ts";
import { renderNote } from "./notes.ts";

const marks = typeof CSS !== "undefined" && "highlights" in CSS;

/** A slide's line at the end of the slide, run in the other file's times: how far it fills, in which color. */
export interface SlideLine {
  share: number;
  tone: Grade;
}

/** The talk's line at the end of this slide, likewise: as the live line draws it (presenter.ts). */
export interface TalkLine {
  scale: number;
  target: number;
  /** Time spent by then, and where the talk would end with the slides after it as planned. */
  at: number;
  finish: number;
  tone: Grade;
  /** This slide's planned window. */
  window: Plan | null;
}

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

  /**
   * This slide's line and the talk's, run in the other file's times; under
   * them, both times and the difference, in the lines' colors.
   */
  renderTimes(slide: number, endSlide: number, slack: Slack): { slide: SlideLine | null; talk: TalkLine } {
    this.plan(endSlide);
    const [a, b] = [this.ours, this.theirs];
    const target = this.target;
    const own = this.slideLine(slide, slack);
    const [la, lb] = [a.lengths[slide], b.lengths[slide]];
    $("pace-slide").title = `This slide: ${span(la)} in ${a.name}, ${span(lb)} in ${b.name}`;
    times($("compare-slide"), own ? [la, lb] : null, own?.tone ?? "on");

    // Where the talk stands at the end of this slide in each (a backup slide goes by the end slide), and where it would
    // end with the slides after it as planned.
    const s = Math.min(slide, endSlide);
    const at = endOf(b, s);
    const finish = a.end + at - endOf(a, s);
    const total = Math.round(b.end) - Math.round(a.end);
    times($("compare-talk"), a.end || b.end ? [a.end, b.end] : null, total > 0 ? grade(total, target, slack) : total < 0 ? "early" : "on");
    $("compare-talk").title = `The talk: ${span(a.end)} in ${a.name}, ${span(b.end)} in ${b.name}`;
    const talk = { scale: Math.max(target * 1.1, a.end), target, at, finish, tone: grade(finish - target, target, slack), window: a.windows[slide] };
    return { slide: own, talk };
  }

  /** Each slide's line, for the thumbnails. */
  slideLines(endSlide: number, slack: Slack): Array<SlideLine | null> {
    this.plan(endSlide);
    return this.deck.slides.map((_, slide) => this.slideLine(slide, slack));
  }

  /**
   * A slide's line, had it taken the other file's time: filled that far
   * against its planned time, longer in the late colors, shorter in blue;
   * none for a slide neither gives any time.
   */
  private slideLine(slide: number, slack: Slack): SlideLine | null {
    const [la, lb] = [this.ours.lengths[slide], this.theirs.lengths[slide]];
    if (!la && !lb) return null;
    const d = Math.round(lb) - Math.round(la);
    return { share: la ? Math.min(1, lb / la) : 1, tone: d > 0 ? grade(d, this.target, slack) : d < 0 ? "early" : "on" };
  }

  /** The talk's target end: its set length, else where the deck's plan ends. */
  private get target(): number {
    return this.deck.duration * 60 || this.ours.end;
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

/** Where a side's plan stands at the end of `slide`: its window's end, or the last one before it. */
function endOf(side: Plans, slide: number): number {
  for (let s = slide; s >= 0; s--) if (side.windows[s]) return side.windows[s]!.end;
  return 0;
}

/** The deck's time, the other's, and how much longer or shorter it is; the other's two in the color of its line. */
function times(target: HTMLElement, pair: [number, number] | null, tone: Grade): void {
  if (!pair) return target.replaceChildren();
  const [a, b] = pair;
  const d = Math.round(b) - Math.round(a);
  const diff = d > 0 ? `+${span(d)}` : d < 0 ? `−${span(d)}` : "same";
  target.replaceChildren(el("span", "a", span(a)), " ", el("span", `t-${tone}`, span(b)), " ", el("span", d ? `t-${tone}` : "t-idle", diff));
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
