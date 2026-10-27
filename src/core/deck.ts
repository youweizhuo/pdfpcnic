import { splitPlan, type Plan } from "./pace.ts";
import type { PdfpcFile, PdfpcPage } from "./pdfpc.ts";

/** Where a link on a slide leads: a page of the deck, a web page, or a PDF named action (NextPage, GoBack…). */
export type LinkTarget = { page: number } | { url: string } | { action: string };

/** A link on a page: its box, in fractions of the page from its top left, and where it leads. */
export interface Link {
  x: number;
  y: number;
  width: number;
  height: number;
  to: LinkTarget;
}

/** What the PDF engine reads from a page. */
export interface PageInfo {
  /** Size in PDF points, rotation applied. */
  width: number;
  height: number;
  /** The PDF's page label, if it has one. */
  label: string | null;
  /** Text of the page's note annotations (sticky notes, highlights), which pdfpc takes for notes. */
  note: string;
  links: Link[];
}

export interface Page {
  index: number;
  /** PDF page label, or the page number when the PDF has none. */
  label: string;
  /** The logical slide this page belongs to (pdfpc's "user slide"). */
  slide: number;
  /** 0-based reveal step inside its slide. */
  step: number;
  hidden: boolean;
  note: string;
  /** Planned window, from the note's first line. */
  plan: Plan | null;
  /** Seconds a slide off the talk's clock (a backup slide) takes, from the note's first line. */
  length: number | null;
  links: Link[];
  /** Size in PDF points, rotation applied. */
  width: number;
  height: number;
}

export interface Deck {
  name: string;
  pages: Page[];
  /** Page indices of each logical slide. */
  slides: number[][];
  /** Last slide of the talk proper; later ones are backup. */
  endSlide: number;
  savedSlide: number | null;
  /** Minutes, 0 when the talk has no set length. */
  duration: number;
  startTime?: string;
  endTime?: string;
  markdown: boolean;
  noteFontSize?: number;
  warnings: string[];
}

/** Puts a PDF's pages and its `.pdfpc` file together into slides, as pdfpc does. */
export function buildDeck(name: string, info: PageInfo[], meta: PdfpcFile | null): Deck {
  const n = info.length;
  const label = (i: number) => info[i].label || String(i + 1);

  // Position of each page in its run of equal labels (pdfpc's auto-detected overlay).
  const run: number[] = [];
  for (let i = 0; i < n; i++) run[i] = i > 0 && label(i) === label(i - 1) ? run[i - 1] + 1 : 0;

  const warnings: string[] = [];
  const forced = new Set<number>();
  const hidden = new Set<number>();
  const notes = new Map<number, string>();
  let unplaced = 0;
  for (const p of meta?.pages ?? []) {
    const i = locate(p, n, label, run);
    if (i === null) {
      unplaced++;
      continue;
    }
    if (p.forcedOverlay) forced.add(i);
    if (p.hidden) hidden.add(i);
    if (p.note) notes.set(i, p.note);
  }
  if (unplaced) warnings.push(`${unplaced} pages in the .pdfpc file are past the end of the PDF. Do the two files match?`);

  // Group pages into slides the way pdfpc does: a new label starts a new
  // slide unless the page is a forced overlay of the one before.
  const pages: Page[] = [];
  const slides: number[][] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    if (slides.length === 0 || (label(i) !== prev && !forced.has(i))) {
      slides.push([]);
      prev = label(i);
    }
    const slide = slides.length - 1;
    // pdfpc lets notes embedded in the PDF win over the .pdfpc file.
    const { plan, length, note } = splitPlan(info[i].note || notes.get(i) || "");
    pages.push({
      index: i,
      label: label(i),
      slide,
      step: slides[slide].length,
      hidden: hidden.has(i),
      note,
      plan,
      length,
      links: info[i].links,
      width: info[i].width,
      height: info[i].height,
    });
    slides[slide].push(i);
  }

  const last = slides.length - 1;
  const clampSlide = (s: number | undefined) => (s === undefined ? undefined : Math.min(s, last));
  return {
    name,
    pages,
    slides,
    endSlide: clampSlide(meta?.endSlide) ?? last,
    savedSlide: clampSlide(meta?.savedSlide) ?? null,
    duration: meta?.duration ?? 0,
    startTime: meta?.startTime,
    endTime: meta?.endTime,
    markdown: !meta?.disableMarkdown,
    noteFontSize: meta?.noteFontSize,
    warnings,
  };
}

/** Finds the page a .pdfpc entry describes, as pdfpc does: by index if the label agrees, else by label. */
function locate(p: PdfpcPage, n: number, label: (i: number) => string, run: number[]): number | null {
  const overlay = p.overlay ?? 0;
  if (p.label !== undefined) {
    if (p.idx < n && label(p.idx) === p.label && run[p.idx] === overlay) return p.idx;
    for (let i = 0; i < n; i++) {
      if (label(i) === p.label) {
        const j = i + overlay;
        if (j < n && label(j) === p.label) return j;
        break;
      }
    }
  }
  return p.idx < n ? p.idx : null;
}
