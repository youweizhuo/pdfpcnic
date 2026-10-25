import type { Deck } from "./deck";
import type { PageCache } from "./render";

export interface Point {
  x: number;
  y: number;
}

/**
 * One page drawn into a box, scaled to fit. The box may live in another
 * window (the audience popup); sizes and pixel ratio come from that window.
 */
export class SlideView {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private laser: HTMLElement;
  private page: number | null = null;
  private unsubscribe: () => void;
  private observer: ResizeObserver;

  constructor(
    host: HTMLElement,
    private deck: Deck,
    private cache: PageCache,
    private priority: number,
    private align: "center" | "start" = "center",
  ) {
    const doc = host.ownerDocument;
    this.root = host;
    this.root.classList.add("slide-view");
    this.canvas = doc.createElement("canvas");
    this.laser = doc.createElement("div");
    this.laser.className = "laser-dot";
    this.laser.hidden = true;
    this.root.replaceChildren(this.canvas, this.laser);
    this.unsubscribe = cache.onRender((p) => p === this.page && this.draw());
    const win = doc.defaultView as Window & typeof globalThis;
    this.observer = new win.ResizeObserver(() => this.layout());
  }

  start(): void {
    this.observer.observe(this.root);
  }

  get current(): number | null {
    return this.page;
  }

  show(page: number | null): void {
    if (page === this.page) return;
    this.page = page;
    this.layout();
  }

  /** Device-pixel width the page is drawn at, for prefetching neighbors at the same size. */
  get pixelWidth(): number {
    return this.canvas.width;
  }

  /** Shows the laser dot at a point given in page fractions (0..1), or hides it. */
  setLaser(at: Point | null, size: number): void {
    this.laser.hidden = !at || this.page === null;
    if (!at) return;
    const s = Math.max(6, size * this.canvas.clientHeight);
    Object.assign(this.laser.style, {
      width: `${s}px`,
      height: `${s}px`,
      left: `${this.canvas.offsetLeft + at.x * this.canvas.clientWidth - s / 2}px`,
      top: `${this.canvas.offsetTop + at.y * this.canvas.clientHeight - s / 2}px`,
    });
  }

  /** Converts a client position to page fractions, or null outside the page. */
  toPage(clientX: number, clientY: number): Point | null {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  }

  dispose(): void {
    this.observer.disconnect();
    this.unsubscribe();
  }

  private layout(): void {
    const { canvas } = this;
    if (this.page === null) {
      canvas.hidden = true;
      return;
    }
    const p = this.deck.pages[this.page];
    const boxW = this.root.clientWidth;
    const boxH = this.root.clientHeight;
    if (!boxW || !boxH) return;
    const scale = Math.min(boxW / p.width, boxH / p.height);
    const cssW = Math.floor(p.width * scale);
    const cssH = Math.floor(p.height * scale);
    const dpr = this.root.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    canvas.hidden = false;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.style.left = `${this.align === "center" ? Math.floor((boxW - cssW) / 2) : 0}px`;
    canvas.style.top = `${this.align === "center" ? Math.floor((boxH - cssH) / 2) : 0}px`;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.cache.want(this.page, w, this.priority);
    this.draw();
  }

  private draw(): void {
    if (this.page === null) return;
    const ctx = this.canvas.getContext("2d")!;
    const bmp = this.cache.best(this.page);
    if (!bmp) {
      ctx.fillStyle = "#1c1c1e";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, this.canvas.width, this.canvas.height);
  }
}

/** A small, lazily rendered page picture for the thumbnail strip and the overview. */
export class Thumb {
  readonly canvas: HTMLCanvasElement;
  private seen = false;

  constructor(
    private page: number,
    private cache: PageCache,
    deck: Deck,
  ) {
    const p = deck.pages[page];
    this.canvas = document.createElement("canvas");
    this.canvas.width = 320;
    this.canvas.height = Math.round((320 * p.height) / p.width);
    this.canvas.style.aspectRatio = `${p.width} / ${p.height}`;
  }

  /** Called once the thumbnail scrolls into view. */
  reveal(): void {
    if (this.seen) return;
    this.seen = true;
    if (!this.draw()) this.cache.wantThumb(this.page);
  }

  draw(): boolean {
    if (!this.seen) return false;
    const bmp = this.cache.thumb(this.page) ?? this.cache.best(this.page);
    if (!bmp) return false;
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, this.canvas.width, this.canvas.height);
    return true;
  }
}
