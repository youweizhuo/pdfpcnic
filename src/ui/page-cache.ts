import type { Pdf } from "../platform.ts";

/** Width in device pixels of overview and strip thumbnails. */
export const THUMB_WIDTH = 360;
/** Widest render; beyond this a 4K-and-up screen gets a scaled image. */
const MAX_WIDTH = 4096;

interface Job {
  page: number;
  width: number;
  thumb: boolean;
  priority: number;
  prefetch: boolean;
  /** May never be needed: waits until the machine is idle. */
  lazy: boolean;
}

/** Resolves when the main thread has a moment with nothing else to do. */
const idle = () =>
  new Promise<void>((done) =>
    "requestIdleCallback" in window ? requestIdleCallback(() => done(), { timeout: 2000 }) : setTimeout(done, 200),
  );

/**
 * Pictures of pages, drawn by the platform's PDF engine on demand and kept.
 * One full-size picture per page serves every view of it (smaller views scale
 * it down); thumbnails are kept separately. Full-size pictures are evicted
 * least-recently-used once they pass the memory budget.
 */
export class PageCache {
  private full = new Map<number, ImageBitmap>();
  private thumbs = new Map<number, ImageBitmap>();
  private queue: Job[] = [];
  private running = false;
  private bytes = 0;
  private listeners = new Set<(page: number) => void>();
  private disposed = false;
  /** Pages never evicted: what is on screen now. */
  pinned = new Set<number>();

  constructor(
    private pdf: Pdf,
    private budget = 320 * 2 ** 20,
  ) {}

  onRender(cb: (page: number) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** The sharpest bitmap of a page available right now. */
  best(page: number): ImageBitmap | null {
    const bmp = this.full.get(page);
    if (bmp) {
      this.full.delete(page);
      this.full.set(page, bmp);
      return bmp;
    }
    return this.thumbs.get(page) ?? null;
  }

  thumb(page: number): ImageBitmap | null {
    return this.thumbs.get(page) ?? null;
  }

  /** Asks for a page at least `width` device pixels wide; lower priority renders first. */
  want(page: number, width: number, priority: number): void {
    width = Math.min(Math.ceil(width), MAX_WIDTH);
    if ((this.full.get(page)?.width ?? 0) >= width * 0.98) return;
    this.enqueue({ page, width, thumb: false, priority, prefetch: false, lazy: false });
  }

  wantThumb(page: number, priority = 100): void {
    if (this.thumbs.has(page)) return;
    this.enqueue({ page, width: THUMB_WIDTH, thumb: true, priority, prefetch: false, lazy: true });
  }

  /**
   * Replaces the set of pages rendered ahead of time (neighbors of the
   * current one): `soon` right away, `later` once the machine is idle.
   */
  prefetch(soon: number[], later: number[], width: number): void {
    this.queue = this.queue.filter((j) => !j.prefetch);
    width = Math.min(Math.ceil(width), MAX_WIDTH);
    [...soon, ...later].forEach((page, i) => {
      if (page < 0 || page >= this.pdf.pages.length) return;
      if ((this.full.get(page)?.width ?? 0) >= width * 0.98) return;
      this.enqueue({ page, width, thumb: false, priority: 10 + i, prefetch: true, lazy: i >= soon.length });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    for (const bmp of [...this.full.values(), ...this.thumbs.values()]) bmp.close();
    this.full.clear();
    this.thumbs.clear();
    this.listeners.clear();
  }

  private enqueue(job: Job): void {
    const same = this.queue.find((j) => j.page === job.page && j.thumb === job.thumb);
    if (same) {
      same.width = Math.max(same.width, job.width);
      same.priority = Math.min(same.priority, job.priority);
      same.prefetch &&= job.prefetch;
      same.lazy &&= job.lazy;
    } else {
      this.queue.push(job);
    }
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.disposed) {
        this.queue.sort((a, b) => a.priority - b.priority);
        if (this.queue[0].lazy) {
          await idle();
          if (this.disposed || !this.queue.length) break;
          this.queue.sort((a, b) => a.priority - b.priority);
        }
        const job = this.queue.shift()!;
        const have = job.thumb ? this.thumbs.get(job.page) : this.full.get(job.page);
        if (have && have.width >= job.width * 0.98) continue;
        let bmp: ImageBitmap;
        try {
          bmp = await this.pdf.draw(job.page, job.width);
        } catch (err) {
          // A deck closed mid-render (another one opened) isn't a failure.
          if (this.disposed) return;
          console.error(`pdfpcnic: rendering page ${job.page + 1} failed`, err);
          continue;
        }
        if (this.disposed) {
          bmp.close();
          return;
        }
        this.store(job, bmp);
        for (const cb of this.listeners) cb(job.page);
      }
    } finally {
      this.running = false;
    }
  }

  private store(job: Job, bmp: ImageBitmap): void {
    if (job.thumb) {
      this.thumbs.set(job.page, bmp);
      return;
    }
    const old = this.full.get(job.page);
    if (old) {
      this.bytes -= old.width * old.height * 4;
      old.close();
      this.full.delete(job.page);
    }
    this.full.set(job.page, bmp);
    this.bytes += bmp.width * bmp.height * 4;
    for (const [page, b] of this.full) {
      if (this.bytes <= this.budget) break;
      if (this.pinned.has(page) || page === job.page) continue;
      this.bytes -= b.width * b.height * 4;
      b.close();
      this.full.delete(page);
    }
  }
}
