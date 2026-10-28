// What pdfpcnic needs from where it runs, and nothing more. The website and the
// offline file get it from the browser (src/web/); a native app provides the
// same with its own windows and PDF engine. The rest is the same everywhere:
// the talk (src/core/) and the presenter page (src/ui/).

import type { Deck, LinkTarget, PageInfo } from "./core/deck.ts";
import type { AudienceStatus } from "./core/guide.ts";
import type { Point, SavedSession } from "./core/talk.ts";
import type { PageCache } from "./ui/page-cache.ts";

export interface Platform {
  /** Opens a PDF with the platform's engine. */
  openPdf(data: ArrayBuffer): Promise<Pdf>;
  /** The audience's window, once per page load. */
  audience(events: AudienceEvents): Audience;
  /** The presenter's own window. */
  window: PresenterWindow;
  store: Store;
  /** The demo deck, where this build can get it. */
  demo: (() => Promise<{ pdf: ArrayBuffer; pdfpc: string }>) | null;
  /** Hands over files the platform opens itself, such as a PDF double-clicked in the Finder. */
  files?(open: (files: File[]) => void): void;
}

/** A PDF, opened by the platform's engine: pdf.js in the browser, PDFKit on the Mac. */
export interface Pdf {
  /** What each page holds: its size, label, note annotations and links. */
  readonly pages: PageInfo[];
  /** A picture of a page, `width` device pixels wide. One at a time. */
  draw(page: number, width: number): Promise<ImageBitmap>;
  close(): Promise<void>;
}

/** What happens in the audience window, for the presenter to act on. */
export interface AudienceEvents {
  key(e: KeyboardEvent): void;
  /** A click (1) or right-click (-1) on the slide. */
  step(delta: 1 | -1): void;
  /** A link on the slide was clicked. */
  follow(to: LinkTarget): void;
  /** Its status changed: opened, closed, fullscreen. */
  change(): void;
}

/** The window the room sees: one slide, fullscreen on the projector. */
export interface Audience {
  readonly status: AudienceStatus;
  /** Device pixels across the slide it shows, for drawing ahead at that size; 0 when it draws its own. */
  readonly pixelWidth: number;
  /** Shows this deck: the window draws it from the PDF, or from the pictures the presenter has drawn of it. */
  bind(deck: Deck, pdf: Pdf, pages: PageCache): void;
  /**
   * Opens it on this screen, or brings it forward. Call from a key press or click. Throws, saying what to do, if it
   * can't. `behind`, as a deck opens: behind the presenter where the platform can put it, and left as it is if open.
   */
  open(behind?: boolean): void;
  /** Fullscreen on the projector, or back. Call from a key press or click. */
  toggleFullscreen(): void;
  render(page: number, black: boolean, laser: Point | null, laserSize: number): void;
}

/** The presenter's window. */
export interface PresenterWindow {
  readonly fullscreen: boolean;
  /** Rejects, saying why, if fullscreen is refused. */
  setFullscreen(on: boolean): Promise<void>;
  /** False when the platform sees only one screen (displays mirrored), undefined when it can't tell. */
  readonly extended: boolean | undefined;
  /** Calls back when fullscreen or the screens change. */
  onChange(cb: () => void, signal: AbortSignal): void;
}

/** The deck as it was opened, kept to resume after a reload. */
export interface SavedDeck {
  pdfName: string;
  pdf: ArrayBuffer;
  pdfpcName?: string;
  pdfpc?: string;
}

/** What stays on this computer: the last deck, where its talk stood, and settings. None of it is required. */
export interface Store {
  saveDeck(d: SavedDeck): Promise<unknown>;
  loadDeck(): Promise<SavedDeck | undefined>;
  saveSession(s: SavedSession): Promise<unknown>;
  loadSession(): Promise<SavedSession | undefined>;
  /** Drops the kept deck and session, as when leaving a shared computer. */
  forget(): Promise<unknown>;
  pref<T>(key: string, fallback: T): T;
  setPref(key: string, value: unknown): void;
}
