// What the site build serves beside the page. Each file is fetched the first
// time something needs it, so a deck that needs none of them loads none.

import workerFile from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import demoPdf from "../../demo/demo.pdf?url";
import demoPdfpc from "../../demo/demo.pdfpc?raw";

/** The pdf.js worker, as its own cached file. */
export function workerUrl(): string {
  return workerFile;
}

/**
 * pdf.js's extras for PDFs that need them: fonts a PDF doesn't embed, CMaps
 * for CJK text without embedded fonts, and JBIG2 and JPEG 2000 image decoders.
 * The build copies them to `pdfjs/`; the dev server serves node_modules.
 */
export function resources(): { cMapUrl: string; standardFontDataUrl: string; wasmUrl: string; iccUrl: string } {
  const base = new URL(import.meta.env.DEV ? "/node_modules/pdfjs-dist/" : "pdfjs/", location.href).href;
  return { cMapUrl: `${base}cmaps/`, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/` };
}

/** The demo deck, fetched when asked for. */
export const demoDeck: (() => Promise<{ pdf: ArrayBuffer; pdfpc: string }>) | null = async () => {
  const res = await fetch(demoPdf);
  if (!res.ok) throw new Error(`Couldn't load the demo deck (${res.status}).`);
  return { pdf: await res.arrayBuffer(), pdfpc: demoPdfpc };
};
