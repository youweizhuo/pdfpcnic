// PDFs through pdf.js: the only module that knows it.

import { AnnotationMode, AnnotationType, getDocument, GlobalWorkerOptions, PDFWorker, type PDFDocumentProxy, type PageViewport } from "pdfjs-dist";
import { resources, workerUrl } from "variant";
import type { Link, LinkTarget, PageInfo } from "../core/deck.ts";
import type { Pdf } from "../platform.ts";

/**
 * pdf.js draws a page in steps, each on this window's next animation frame.
 * Hidden behind another tab, this window gets none, while the audience window
 * may be on screen waiting for the slide: hidden, the steps run as tasks.
 */
const frame = window.requestAnimationFrame.bind(window);
const cancelFrame = window.cancelAnimationFrame.bind(window);
const steps = new Map<number, FrameRequestCallback>();
const channel = new MessageChannel();
let stepId = 0;
channel.port1.onmessage = (e: MessageEvent<number>) => {
  const step = steps.get(e.data);
  steps.delete(e.data);
  step?.(performance.now());
};
window.requestAnimationFrame = (cb) => {
  if (!document.hidden) return frame(cb);
  // Negative, so never a browser's own frame id.
  steps.set(--stepId, cb);
  channel.port2.postMessage(stepId);
  return stepId;
};
window.cancelAnimationFrame = (id) => (id < 0 ? void steps.delete(id) : cancelFrame(id));

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

export async function openPdf(data: ArrayBuffer): Promise<Pdf> {
  worker ??= startWorker();
  // pdf.js transfers the buffer to its worker; keep the caller's copy usable.
  const doc = await getDocument({ data: new Uint8Array(data.slice(0)), worker: await worker, ...resources() }).promise;
  const labels = await doc.getPageLabels().catch(() => null);
  const pageOf = destinations(doc);
  const pages: PageInfo[] = await Promise.all(
    Array.from({ length: doc.numPages }, async (_, i) => {
      const page = await doc.getPage(i + 1);
      const viewport = page.getViewport({ scale: 1 });
      const annotations: Annotation[] = await page.getAnnotations().catch(() => []);
      return {
        width: viewport.width,
        height: viewport.height,
        label: labels?.[i] || null,
        note: annotationNote(annotations),
        links: await linksOf(annotations, viewport, pageOf),
      };
    }),
  );
  const canvas = document.createElement("canvas");
  return {
    pages,
    async draw(index, width) {
      const page = await doc.getPage(index + 1);
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      // Note annotations become speaker notes, so they are left off the slide (as pdfpc does).
      await page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE, background: "#fff" }).promise;
      return createImageBitmap(canvas);
    },
    close: () => doc.loadingTask.destroy(),
  };
}

/** The fields of pdf.js's annotation data read here. */
interface Annotation {
  annotationType?: number;
  subtype?: string;
  contentsObj?: { str?: string };
  rect?: number[];
  url?: string;
  action?: string;
  dest?: string | unknown[];
}

/** A page's links, where pdf.js's own viewer would put them, and where they lead (as it reads them: a web link first). */
async function linksOf(annotations: Annotation[], viewport: PageViewport, pageOf: (dest: string | unknown[]) => Promise<number | null>): Promise<Link[]> {
  const links = await Promise.all(
    annotations.map(async (a): Promise<Link | null> => {
      if (a.annotationType !== AnnotationType.LINK || !a.rect) return null;
      let to: LinkTarget | null = null;
      if (a.url) to = { url: a.url };
      else if (a.action) to = { action: a.action };
      else if (a.dest) {
        const page = await pageOf(a.dest);
        if (page !== null) to = { page };
      }
      if (!to) return null;
      const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]);
      const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]);
      return {
        x: Math.min(x1, x2) / viewport.width,
        y: Math.min(y1, y2) / viewport.height,
        width: Math.abs(x2 - x1) / viewport.width,
        height: Math.abs(y2 - y1) / viewport.height,
        to,
      };
    }),
  );
  return links.filter((l) => l !== null);
}

/** Finds the page index a link's destination (named or explicit) points at, asking pdf.js once for the names. */
function destinations(doc: PDFDocumentProxy): (dest: string | unknown[]) => Promise<number | null> {
  let named: Promise<Map<string, unknown[]>> | null = null;
  return async (dest) => {
    const explicit = typeof dest === "string" ? (await (named ??= doc.getDestinations().catch(() => new Map()))).get(dest) : dest;
    const ref = explicit?.[0];
    // A page reference, or (from some generators) a page index.
    if (Number.isInteger(ref)) return ref as number;
    if (!ref || typeof ref !== "object") return null;
    return doc.getPageIndex(ref as { num: number; gen: number }).catch(() => null);
  };
}

const NOTE_ANNOTATIONS = new Set(["Text", "FreeText", "Highlight", "Underline", "Squiggly"]);

/** Text of a page's note annotations, the types pdfpc imports as notes. */
function annotationNote(annotations: Annotation[]): string {
  return annotations
    .filter((a) => a.subtype && NOTE_ANNOTATIONS.has(a.subtype))
    .map((a) => a.contentsObj?.str?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}
