import url from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** The site build serves the pdf.js worker as its own cached file. */
export function workerUrl(): string {
  return url;
}
