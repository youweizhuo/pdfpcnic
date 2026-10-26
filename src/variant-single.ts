// What the offline copy carries: only what every deck needs, inlined.

import source from "pdfjs-dist/build/pdf.worker.min.mjs?raw";

/**
 * The pdf.js worker, carried as text. Opened from file://, Chrome runs a module
 * worker from a data: URL but not from a blob: URL; served over http, a blob:
 * URL is the lighter choice.
 */
export function workerUrl(): string {
  if (location.protocol === "file:") return `data:text/javascript,${encodeURIComponent(source)}`;
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

/** No extras: pdf.js makes do with what each PDF embeds. */
export function resources(): Record<string, never> {
  return {};
}

/** The demo deck stays on the website. */
export const demoDeck = null;
