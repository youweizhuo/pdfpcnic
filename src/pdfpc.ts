// Reader for pdfpc's JSON metadata file (pdfpcFormat 2), as written by pdfpc
// itself and by Typst/Touying exports. Schema:
// https://github.com/pdfpc/pdfpc/blob/master/schema/pdfpc.json

export interface PdfpcPage {
  idx: number;
  label?: string;
  overlay?: number;
  forcedOverlay?: boolean;
  hidden?: boolean;
  note?: string;
}

export interface PdfpcFile {
  /** Talk length in minutes. */
  duration?: number;
  /** "HH:MM" */
  startTime?: string;
  /** "HH:MM" */
  endTime?: string;
  /** Last user slide of the talk proper, 0-based. */
  endSlide?: number;
  /** Bookmarked user slide, 0-based. */
  savedSlide?: number;
  lastMinutes?: number;
  disableMarkdown?: boolean;
  noteFontSize?: number;
  pages: PdfpcPage[];
}

export class PdfpcError extends Error {}

const int = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const time = (v: unknown): string | undefined => {
  const s = str(v);
  return s && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s) ? s : undefined;
};

export function parsePdfpc(text: string): PdfpcFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // pdfpc before 4.5 wrote a sectioned text format ("[file]", "[notes]", ...).
    if (/^\s*\[(file|notes|duration|skip)\]/m.test(text)) {
      throw new PdfpcError("This is an old-style .pdfpc file. Open and save it once in pdfpc 4.5+ to convert it.");
    }
    throw new PdfpcError("The .pdfpc file isn't valid JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PdfpcError("The .pdfpc file has no settings object.");
  }
  const o = raw as Record<string, unknown>;
  if (o.pdfpcFormat !== 2) {
    throw new PdfpcError(`Unsupported pdfpcFormat ${JSON.stringify(o.pdfpcFormat)} (expected 2).`);
  }

  const pages: PdfpcPage[] = [];
  for (const p of Array.isArray(o.pages) ? o.pages : []) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const idx = int(r.idx);
    if (idx === undefined) continue;
    pages.push({
      idx,
      label: str(r.label),
      overlay: int(r.overlay),
      forcedOverlay: bool(r.forcedOverlay),
      hidden: bool(r.hidden),
      note: str(r.note),
    });
  }

  const duration = int(o.duration);
  return {
    duration: duration && duration > 0 ? duration : undefined,
    startTime: time(o.startTime),
    endTime: time(o.endTime),
    endSlide: int(o.endSlide),
    savedSlide: int(o.savedSlide),
    lastMinutes: int(o.lastMinutes),
    disableMarkdown: bool(o.disableMarkdown),
    noteFontSize: int(o.noteFontSize),
    pages,
  };
}
