import { getDocument, GlobalWorkerOptions, PDFWorker, type PDFDocumentProxy } from "pdfjs-dist";
import { workerUrl } from "pdf-worker-source";
import type { PdfpcFile, PdfpcPage } from "./pdfpc";

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
  /** Size in PDF points, rotation applied. */
  width: number;
  height: number;
}

export interface Deck {
  name: string;
  doc: PDFDocumentProxy;
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

let worker: Promise<PDFWorker> | null = null;

/** One pdf.js worker shared by every deck, started on first use. */
async function startWorker(): Promise<PDFWorker> {
  const url = workerUrl();
  GlobalWorkerOptions.workerSrc = url;
  // pdf.js treats a file:// page as cross-origin and wraps the worker in a
  // blob: module, which Chrome refuses there. Started here, it loads.
  try {
    const w = new Worker(url, { type: "module" });
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      const done = (ok: boolean) => () => {
        clearTimeout(timer);
        resolve(ok);
      };
      w.addEventListener("message", done(true), { once: true });
      w.addEventListener("error", done(false), { once: true });
    });
    // pdf.js's typings say `port: null`; its code takes a Worker.
    if (ready) return new PDFWorker({ port: w as unknown as null });
    w.terminate();
  } catch {
    // fall through
  }
  // pdf.js tries its own way and, failing that, renders on this thread.
  return new PDFWorker();
}

export async function openDeck(data: ArrayBuffer, name: string, meta: PdfpcFile | null): Promise<Deck> {
  worker ??= startWorker();
  // pdf.js transfers the buffer to its worker; keep the caller's copy usable.
  const doc = await getDocument({ data: new Uint8Array(data.slice(0)), worker: await worker }).promise;
  const n = doc.numPages;

  const [labels, info] = await Promise.all([
    doc.getPageLabels().catch(() => null),
    Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const page = await doc.getPage(i + 1);
        const { width, height } = page.getViewport({ scale: 1 });
        const annotations = await page.getAnnotations().catch(() => []);
        return { width, height, note: annotationNote(annotations) };
      }),
    ),
  ]);
  const label = (i: number) => labels?.[i] || String(i + 1);

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
    pages.push({
      index: i,
      label: label(i),
      slide,
      step: slides[slide].length,
      hidden: hidden.has(i),
      // pdfpc lets notes embedded in the PDF win over the .pdfpc file.
      note: info[i].note || notes.get(i) || "",
      width: info[i].width,
      height: info[i].height,
    });
    slides[slide].push(i);
  }

  const last = slides.length - 1;
  const clampSlide = (s: number | undefined) => (s === undefined ? undefined : Math.min(s, last));
  return {
    name,
    doc,
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

const NOTE_ANNOTATIONS = new Set(["Text", "FreeText", "Highlight", "Underline", "Squiggly"]);

/** Text of a page's note annotations, the types pdfpc imports as notes. */
function annotationNote(annotations: Array<{ subtype?: string; contentsObj?: { str?: string } }>): string {
  return annotations
    .filter((a) => a.subtype && NOTE_ANNOTATIONS.has(a.subtype))
    .map((a) => a.contentsObj?.str?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}
