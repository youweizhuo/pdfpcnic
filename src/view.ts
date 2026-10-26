import { AnnotationLayer } from "pdfjs-dist";
import { destinationPage, type Deck } from "./deck";
import { THUMB_WIDTH, type PageCache } from "./render";

export interface Point {
  x: number;
  y: number;
}

/**
 * Where a click on a slide's link leads: a page of the deck, or a PDF named
 * action (NextPage, GoBack…). Web links open in a new tab by themselves.
 */
export type FollowLink = (to: { page: number } | { action: string }) => void;

// pdf.js's annotation layer places each link in percent of the page; these
// rules (in whichever window the slide is) make them clickable boxes. The
// PDF's own link borders (hyperref's colored boxes) stay off, as on the
// drawn slide; `marked` outlines the links instead, for the presenter.
const LINK_CSS = `
.slide-links { position: absolute; pointer-events: none; }
.slide-links section { position: absolute; border: 0 !important; }
.slide-links a { position: absolute; inset: 0; pointer-events: auto; cursor: pointer; }
.slide-links.marked a { outline: 1px solid rgb(255 214 10 / 0.85); outline-offset: -1px; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.45); }
.slide-links.marked a:hover { background: rgb(255 214 10 / 0.2); outline-color: #ffd60a; }
`;

export interface SlideViewOptions {
  align?: "center" | "start";
  /** Makes the slide's links clickable. */
  follow?: FollowLink;
  /** Outlines the links, so the presenter sees what is clickable. */
  marked?: boolean;
}

/**
 * One page drawn into a box, scaled to fit. The box may live in another
 * window (the audience popup); sizes and pixel ratio come from that window.
 */
export class SlideView {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private laser: HTMLElement;
  private links: HTMLDivElement;
  private page: number | null = null;
  private unsubscribe: () => void;
  private observer: ResizeObserver;
  private align: "center" | "start";
  /** Called after the page is placed in its box. */
  onLayout: () => void = () => {};

  constructor(
    host: HTMLElement,
    private deck: Deck,
    private cache: PageCache,
    private priority: number,
    private options: SlideViewOptions = {},
  ) {
    const doc = host.ownerDocument;
    this.align = options.align ?? "center";
    this.root = host;
    this.root.classList.add("slide-view");
    this.canvas = doc.createElement("canvas");
    this.links = this.linkLayer();
    this.laser = doc.createElement("div");
    this.laser.className = "laser-dot";
    this.laser.hidden = true;
    this.root.replaceChildren(this.canvas, this.links, this.laser);
    if (options.follow && !doc.getElementById("slide-links-css")) {
      const style = doc.createElement("style");
      style.id = "slide-links-css";
      style.textContent = LINK_CSS;
      doc.head.append(style);
    }
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
    void this.showLinks(page);
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
      canvas.hidden = this.links.hidden = true;
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
    this.placeLinks();
    this.cache.want(this.page, w, this.priority);
    this.draw();
    this.onLayout();
  }

  /** An empty layer for a page's links. */
  private linkLayer(): HTMLDivElement {
    const layer = this.root.ownerDocument.createElement("div");
    layer.className = this.options.marked ? "slide-links marked" : "slide-links";
    layer.hidden = true;
    // A click on a link follows it, and doesn't also step the slides or make a double-click.
    for (const type of ["click", "dblclick"]) {
      layer.addEventListener(type, (e) => (e.target as Element).closest("a") && e.stopPropagation());
    }
    return layer;
  }

  /** Lays the link layer over the drawn slide. */
  private placeLinks(): void {
    const { canvas, links } = this;
    links.hidden = !links.childElementCount;
    Object.assign(links.style, { left: canvas.style.left, top: canvas.style.top, width: canvas.style.width, height: canvas.style.height });
  }

  /** Has pdf.js build the page's links, as its own viewer does, into a fresh layer. */
  private async showLinks(page: number | null): Promise<void> {
    const { follow } = this.options;
    const links = page === null ? [] : this.deck.pages[page].links;
    if (!follow || (!links.length && !this.links.childElementCount)) return;
    const layer = this.linkLayer();
    if (page !== null && links.length) {
      const doc = this.deck.doc;
      const proxy = await doc.getPage(page + 1);
      const viewport = proxy.getViewport({ scale: 1 });
      // The few calls pdf.js's link elements make, in place of its viewer's link service.
      const linkService = {
        externalLinkEnabled: true,
        addLinkAttributes(a: HTMLAnchorElement, url: string) {
          a.href = a.title = url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        },
        getDestinationHash: () => "#",
        getAnchorUrl: () => "#",
        async goToDestination(dest: string | unknown[]) {
          const to = await destinationPage(doc, dest);
          if (to !== null) follow({ page: to });
        },
        executeNamedAction: (action: string) => follow({ action }),
        executeSetOCGState() {},
      };
      const annotationLayer = new AnnotationLayer({
        div: layer,
        page: proxy,
        viewport,
        linkService,
        accessibilityManager: null,
        annotationCanvasMap: null,
        annotationEditorUIManager: null,
        structTreeLayer: null,
        commentManager: null,
        annotationStorage: null,
      });
      await annotationLayer.render({ div: layer, page: proxy, viewport, annotations: links, linkService: linkService as never, renderForms: false });
    }
    if (page !== this.page) return;
    this.links.replaceWith(layer);
    this.links = layer;
    this.placeLinks();
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
    this.canvas.width = THUMB_WIDTH;
    this.canvas.height = Math.round((THUMB_WIDTH * p.height) / p.width);
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
