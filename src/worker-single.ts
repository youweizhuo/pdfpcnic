import source from "pdfjs-dist/build/pdf.worker.min.mjs?raw";

/**
 * The single-file build carries the worker as text. Opened from file://,
 * Chrome runs a module worker from a data: URL but not from a blob: URL;
 * served over http, a blob: URL is the lighter choice.
 */
export function workerUrl(): string {
  if (location.protocol === "file:") return `data:text/javascript,${encodeURIComponent(source)}`;
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}
