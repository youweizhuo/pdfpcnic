import "./style.css";
import demoPdfUrl from "../demo/demo.pdf?inline";
import demoPdfpc from "../demo/demo.pdfpc?raw";
import { Audience } from "./audience";
import { openDeck, type Deck } from "./deck";
import { actionFor, HELP, type Action } from "./keys";
import { renderNote } from "./notes";
import { against, mark, span, type Plan } from "./pace";
import { parsePdfpc, PdfpcError, type PdfpcFile } from "./pdfpc";
import { PageCache } from "./render";
import * as store from "./store";
import * as T from "./timer";
import { SlideView, Thumb, type Point } from "./view";

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

let toastTimer = 0;
function toast(message: string, kind: "info" | "error" = "info", ms = 4500): void {
  const t = $("toast");
  t.textContent = message;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

interface Source {
  pdf: { name: string; data: ArrayBuffer };
  pdfpc?: { name: string; text: string };
}

interface State {
  page: number;
  /** Page the audience keeps seeing while frozen. */
  frozen: number | null;
  black: boolean;
  laser: boolean;
  laserAt: Point | null;
  timer: T.TimerState;
  endSlide: number;
  /** Bookmarked page. */
  bookmark: number | null;
  back: number[];
  forward: number[];
  overview: boolean;
  /** Slide selected in the overview. */
  selected: number;
  help: boolean;
  /** Presenting in this window (single screen). */
  solo: boolean;
}

/** A session ends after this long; a later visit starts the talk afresh. */
const SESSION_TTL = 8 * 3600_000;

const audience = new Audience({
  key: (e) => presenter?.onKey(e),
  step: (d) => presenter?.act(d > 0 ? "next" : "prev"),
  pointer: (at) => presenter?.pointAt(at, "audience"),
  change: () => presenter?.render(),
});

let presenter: Presenter | null = null;

class Presenter {
  readonly state: State;
  private cache: PageCache;
  private current: SlideView;
  private next: SlideView;
  private solo: SlideView | null = null;
  private thumbs = new Map<number, Thumb[]>();
  private stripItems: HTMLElement[] = [];
  private overviewItems: HTMLElement[] = [];
  private observers = new Map<HTMLElement, IntersectionObserver>();
  private abort = new AbortController();
  private tick = 0;
  private saveTimer = 0;
  private notesPage = -1;
  private stripSlide = -1;
  private laserSize = store.pref("laserSize", 0.035);
  private notesSize: number;
  private paceDetail = store.pref("paceDetail", false);

  constructor(
    readonly deck: Deck,
    readonly source: Source,
    saved: store.SavedSession | undefined,
    /** Save the place and timer, for resuming after a reload. */
    private track: boolean,
  ) {
    this.cache = new PageCache(deck);
    const fresh =
      !saved || saved.pdfName !== deck.name || Date.now() - saved.savedAt > SESSION_TTL || saved.page >= deck.pages.length;
    this.state = {
      page: fresh ? 0 : saved.page,
      frozen: null,
      black: false,
      laser: false,
      laserAt: null,
      timer: fresh ? T.freshTimer() : saved.timer,
      endSlide: Math.min((fresh ? undefined : saved.endSlide) ?? deck.endSlide, deck.slides.length - 1),
      bookmark: (fresh ? undefined : saved.bookmark) ?? (deck.savedSlide === null ? null : deck.slides[deck.savedSlide][0]),
      back: [],
      forward: [],
      overview: false,
      selected: 0,
      help: false,
      solo: false,
    };
    this.notesSize = store.pref<number | null>("notesSize", null) ?? (deck.noteFontSize ? Math.round((deck.noteFontSize * 4) / 3) : 24);

    const first = deck.pages[0];
    document.documentElement.style.setProperty("--aspect", `${first.width} / ${first.height}`);
    document.documentElement.style.setProperty("--notes", `${this.notesSize}px`);
    document.title = `${deck.name} · pdfpcnic`;

    this.current = new SlideView($("current"), deck, this.cache, 1);
    this.next = new SlideView($("next"), deck, this.cache, 2, "start");
    this.cache.onRender((page) => this.thumbs.get(page)?.forEach((t) => t.draw()));
    audience.bind(deck, this.cache);

    $("start").hidden = true;
    $("presenter").hidden = false;
    this.applySplit(store.pref("split", 0.62));
    this.applyStage(store.pref("stage", 0.85));
    $("pace").classList.toggle("detail", this.paceDetail);
    this.current.start();
    this.next.start();
    this.buildStrip();
    this.buildTalkbar();
    this.wire();
    this.tick = window.setInterval(() => this.renderTimer(), 250);
    this.render();
  }

  dispose(): void {
    this.abort.abort();
    clearInterval(this.tick);
    clearTimeout(this.saveTimer);
    this.observers.forEach((o) => o.disconnect());
    this.observers.clear();
    this.current.dispose();
    this.next.dispose();
    this.solo?.dispose();
    this.cache.dispose();
    $("solo").hidden = true;
    $("overview").hidden = true;
    $("help").hidden = true;
  }

  // Navigation

  private visible = (page: number) => !this.deck.pages[page].hidden;
  private slideVisible = (slide: number) => this.deck.slides[slide].some(this.visible);
  private firstOf(slide: number): number {
    const pages = this.deck.slides[slide];
    return pages.find(this.visible) ?? pages[0];
  }
  private lastOf(slide: number): number {
    const pages = this.deck.slides[slide];
    return pages.findLast(this.visible) ?? pages[pages.length - 1];
  }
  private slideFrom(slide: number, dir: 1 | -1): number | null {
    for (let s = slide + dir; s >= 0 && s < this.deck.slides.length; s += dir) {
      if (this.slideVisible(s)) return s;
    }
    return null;
  }

  go(page: number, jump = false): void {
    const s = this.state;
    if (page < 0 || page >= this.deck.pages.length || page === s.page) return;
    if (jump) {
      s.back.push(s.page);
      s.forward = [];
    }
    // As in pdfpc, the clock starts when the talk leaves its title page, or
    // at the first move after a reset.
    if (s.timer.startedAt === null) s.timer = T.start(s.timer, Date.now());
    s.page = page;
    this.render();
  }

  act(action: Action): void {
    const s = this.state;
    const d = this.deck;
    const here = d.pages[s.page];
    const slide = here.slide;
    const now = Date.now();
    switch (action) {
      case "next": {
        for (let i = s.page + 1; i < d.pages.length; i++) if (this.visible(i)) return this.go(i);
        return;
      }
      case "prev": {
        // Inside reveal steps, step back; otherwise jump to the previous
        // slide's first step (pdfpc's rule).
        if (here.step > 0) return this.go(s.page - 1);
        const p = this.slideFrom(slide, -1);
        if (p !== null) this.go(this.firstOf(p));
        return;
      }
      case "nextSlide":
      case "prevSlide": {
        const p = this.slideFrom(slide, action === "nextSlide" ? 1 : -1);
        if (p !== null) this.go(this.firstOf(p));
        return;
      }
      case "next10":
      case "prev10": {
        const target = Math.max(0, Math.min(d.slides.length - 1, slide + (action === "next10" ? 10 : -10)));
        return this.go(this.firstOf(target), true);
      }
      case "nextAny":
        return this.go(s.page + 1);
      case "prevAny":
        return this.go(s.page - 1);
      case "first":
        return this.go(0, true);
      case "last":
        return this.go(this.lastOf(s.endSlide), true);
      case "back":
      case "forward": {
        const from = action === "back" ? s.back : s.forward;
        const to = action === "back" ? s.forward : s.back;
        const page = from.pop();
        if (page === undefined) return;
        to.push(s.page);
        return this.go(page);
      }
      case "overview":
        return this.setOverview(!s.overview);
      case "goto":
        return this.openGoto();
      case "bookmark":
        s.bookmark = s.page;
        toast(`Bookmarked slide ${slide + 1}. Shift+M returns here.`);
        break;
      case "toBookmark":
        if (s.bookmark !== null) this.go(s.bookmark, true);
        return;
      case "normalMode":
        s.laser = false;
        break;
      case "laserMode":
        s.laser = !s.laser;
        break;
      case "bigger":
      case "smaller": {
        const f = action === "bigger" ? 1 : -1;
        if (s.laser) {
          this.laserSize = Math.min(0.2, Math.max(0.01, this.laserSize * (f > 0 ? 1.2 : 1 / 1.2)));
          store.setPref("laserSize", this.laserSize);
        } else {
          this.notesSize = Math.min(72, Math.max(12, this.notesSize + 2 * f));
          document.documentElement.style.setProperty("--notes", `${this.notesSize}px`);
          store.setPref("notesSize", this.notesSize);
        }
        break;
      }
      case "freeze":
        s.frozen = s.frozen === null ? s.page : null;
        break;
      case "blank":
        s.black = !s.black;
        break;
      case "escape":
        if (s.help) s.help = false;
        else if (s.overview) return this.setOverview(false);
        else if (s.solo) return this.setSolo(false);
        else {
          s.black = false;
          s.frozen = null;
          s.laser = false;
        }
        break;
      case "fullscreen":
        if (document.fullscreenElement) void document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => toast("This browser refused fullscreen."));
        return;
      case "audienceFullscreen":
        if (audience.open) audience.toggleFullscreen();
        else this.setSolo(!s.solo);
        return;
      case "timerStart":
        s.timer = T.start(s.timer, now);
        break;
      case "timerPause":
        s.timer = T.togglePause(s.timer, now);
        break;
      case "timerReset":
        // Never mid-talk by a stray key: the clock has to be paused first.
        if (s.timer.startedAt === null) return;
        if (s.timer.pausedAt === null) {
          toast("The timer is running. Pause it first (p, or click the clock), then reset.");
          return;
        }
        s.timer = T.freshTimer();
        toast("Timer at 0:00:00. It starts at your next move, or press s.");
        break;
      case "endSlide":
        s.endSlide = slide;
        this.buildStrip();
        this.buildTalkbar();
        toast(`Slide ${slide + 1} is now the end slide; later ones count as backup.`);
        break;
      case "help":
        s.help = !s.help;
        break;
      case "openAudience":
        void audience.show().then((ok) => {
          if (!ok) toast("The browser blocked the audience window. Allow pop-ups for this page, then press o again.", "error", 8000);
        });
        return;
      case "slideSmaller":
      case "slideBigger":
        this.applyStage(this.stage + (action === "slideBigger" ? 0.05 : -0.05));
        store.setPref("stage", this.stage);
        toast(`Current slide at ${Math.round(this.stage * 100)}% of its column.`, "info", 1500);
        return;
      case "paceDetail":
        this.paceDetail = !this.paceDetail;
        store.setPref("paceDetail", this.paceDetail);
        $("pace").classList.toggle("detail", this.paceDetail);
        return this.renderTimer();
    }
    this.render();
  }

  // Input

  onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (this.state.overview && this.overviewKey(e)) {
      e.preventDefault();
      return;
    }
    const action = actionFor(e);
    if (!action) return;
    e.preventDefault();
    this.act(action);
  }

  /** Laser position from the presenter's current slide or the audience window. */
  pointAt(at: Point | null, from: "presenter" | "audience"): void {
    if (!this.state.laser) return;
    if (at === null && from === "audience" && this.state.laserAt === null) return;
    this.state.laserAt = at;
    this.renderLaser();
  }

  private wire(): void {
    const signal = this.abort.signal;
    const cur = this.current.root;
    cur.addEventListener("pointermove", (e) => this.pointAt(this.current.toPage(e.clientX, e.clientY), "presenter"), { signal });
    cur.addEventListener("pointerleave", () => this.pointAt(null, "presenter"), { signal });
    cur.addEventListener("click", () => this.act("next"), { signal });
    cur.addEventListener(
      "contextmenu",
      (e) => {
        e.preventDefault();
        this.act("prev");
      },
      { signal },
    );
    cur.addEventListener("wheel", wheelStepper((d) => this.act(d > 0 ? "next" : "prev")), { signal, passive: true });
    $("next").addEventListener("click", () => this.act("nextSlide"), { signal });
    $("timer").addEventListener("click", () => this.act("timerPause"), { signal });
    $("timer-reset").addEventListener("click", () => this.act("timerReset"), { signal });
    $("pace").addEventListener("click", () => this.act("paceDetail"), { signal });

    for (const b of document.querySelectorAll<HTMLButtonElement>(".toolbar [data-action]")) {
      b.addEventListener(
        "click",
        () => {
          b.blur();
          this.act(b.dataset.action as Action);
        },
        { signal },
      );
    }
    $("help").addEventListener("click", () => this.act("help"), { signal });

    const split = $("split");
    split.addEventListener(
      "pointerdown",
      (e) => {
        split.setPointerCapture(e.pointerId);
        split.classList.add("dragging");
      },
      { signal },
    );
    split.addEventListener(
      "pointermove",
      (e) => {
        if (!split.hasPointerCapture(e.pointerId)) return;
        const left = this.current.root.getBoundingClientRect().left;
        const right = $("strip").getBoundingClientRect().left - split.offsetWidth;
        this.applySplit((e.clientX - left) / (right - left));
      },
      { signal },
    );
    split.addEventListener(
      "pointerup",
      () => {
        split.classList.remove("dragging");
        store.setPref("split", this.split);
      },
      { signal },
    );

    document.addEventListener(
      "fullscreenchange",
      () => {
        if (this.state.solo && !document.fullscreenElement) this.setSolo(false);
        else this.render();
      },
      { signal },
    );
    // Chromium tells when a screen is plugged in or out.
    (screen as unknown as EventTarget).addEventListener?.("change", () => this.render(), { signal });
  }

  private split = 0.62;
  private applySplit(f: number): void {
    this.split = Math.min(0.8, Math.max(0.4, f || 0.62));
    $("presenter").style.gridTemplateColumns =
      `minmax(0, ${this.split}fr) 28px minmax(0, ${1 - this.split}fr) clamp(120px, 12vw, 220px)`;
  }

  /** Current slide width as a share of its column; what it gives up goes to the notes. */
  private stage = 0.85;
  private applyStage(f: number): void {
    this.stage = Math.min(1, Math.max(0.5, Math.round(f * 20) / 20));
    document.documentElement.style.setProperty("--stage", String(this.stage));
  }

  // Rendering

  /** The next slide's final step, as pdfpc shows it, or null at the end. */
  private nextPage(): number | null {
    const s = this.slideFrom(this.deck.pages[this.state.page].slide, 1);
    return s === null ? null : this.lastOf(s);
  }

  render(): void {
    const s = this.state;
    const d = this.deck;
    const here = d.pages[s.page];
    const shown = s.frozen ?? s.page;

    this.current.show(s.page);
    const next = this.nextPage();
    this.next.show(next);
    $("next").classList.toggle("empty", next === null);
    $("next-label").textContent =
      next === null ? "End of the slides" : `Next · ${d.pages[next].slide + 1}${d.pages[next].slide > s.endSlide ? " · backup" : ""}`;

    this.solo?.show(shown);
    this.renderLaser();

    const steps = d.slides[here.slide].length;
    $("counter").textContent = `${here.slide + 1}/${s.endSlide + 1}`;
    $("counter-sub").textContent = [
      steps > 1 ? `step ${here.step + 1}/${steps}` : "",
      here.slide > s.endSlide ? "backup" : "",
      here.hidden ? "hidden" : "",
      d.pages.length !== d.slides.length ? `page ${s.page + 1}/${d.pages.length}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    if (this.notesPage !== s.page) {
      this.notesPage = s.page;
      const notes = $("notes");
      if (here.note) renderNote(notes, here.note, d.markdown);
      else notes.replaceChildren(el("p", "empty", "No notes for this slide."));
      notes.scrollTop = 0;
    }

    if (this.stripSlide !== here.slide) {
      this.stripItems[this.stripSlide]?.classList.remove("current");
      this.stripSlide = here.slide;
      const item = this.stripItems[here.slide];
      item?.classList.add("current");
      item?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    this.segs.forEach((seg, i) => {
      seg.classList.toggle("done", i < here.slide);
      seg.classList.toggle("current", i === here.slide);
    });

    const badges: Array<[string, string]> = [];
    if (s.black) badges.push(["b-black", "BLACK"]);
    if (s.frozen !== null) badges.push(["b-frozen", "FROZEN"]);
    if (s.laser) badges.push(["b-laser", "LASER"]);
    $("badges").replaceChildren(...badges.map(([c, t]) => el("span", `badge ${c}`, t)));
    this.renderStatus();

    const on: Partial<Record<Action, boolean>> = {
      openAudience: audience.open,
      laserMode: s.laser,
      blank: s.black,
      freeze: s.frozen !== null,
      overview: s.overview,
      fullscreen: !!document.fullscreenElement,
      help: s.help,
    };
    for (const b of document.querySelectorAll<HTMLElement>(".toolbar [data-action]")) {
      b.classList.toggle("on", !!on[b.dataset.action as Action]);
    }
    $("help").hidden = !s.help;
    this.current.root.classList.toggle("laser-on", s.laser);

    // Keep what is on screen, and render the pages around it ahead of time.
    this.cache.pinned = new Set([s.page, shown, ...(next === null ? [] : [next])]);
    const width = Math.max(audience.pixelWidth, this.current.pixelWidth, this.solo?.pixelWidth ?? 0);
    const prev = this.slideFrom(here.slide, -1);
    this.cache.prefetch(
      [s.page + 1, ...(next === null ? [] : [next]), s.page - 1, ...(prev === null ? [] : [this.firstOf(prev)]), s.page + 2, s.page + 3],
      width,
    );

    this.renderTimer();
    this.save();
  }

  private renderLaser(): void {
    const s = this.state;
    const at = s.laser ? s.laserAt : null;
    this.current.setLaser(at, this.laserSize);
    const onAudience = s.frozen === null || s.frozen === s.page ? at : null;
    audience.render(s.frozen ?? s.page, s.black, onAudience, this.laserSize);
    this.solo?.setLaser(onAudience, this.laserSize);
  }

  private talk(): T.Talk {
    const d = this.deck;
    const s = this.state;
    return { duration: d.duration, startTime: d.startTime, endTime: d.endTime, slide: d.pages[s.page].slide, endSlide: s.endSlide };
  }

  private renderTimer(): void {
    const now = Date.now();
    this.renderClock(now);
    this.renderPace(now);
  }

  /** Présentation.app's clock: time since the start, and the time of day. */
  private renderClock(now: number): void {
    const s = this.state;
    const t = s.timer;
    const timer = $("timer");
    timer.textContent = T.format(T.elapsed(t, now));
    timer.classList.toggle("idle", t.startedAt === null || t.pausedAt !== null);
    $("wallclock").textContent = T.formatClock(now);
    const until = T.untilStart(this.talk(), now);
    const mode =
      t.pausedAt !== null
        ? "paused · click the clock to resume"
        : t.startedAt !== null
          ? ""
          : until
            ? `talk starts at ${this.deck.startTime}, in ${T.format(until)}`
            : s.page === 0
              ? "starts when you leave slide 1"
              : "starts at your next move, or press s";
    $("timer-mode").textContent = mode;
    const line = $("timer-line");
    line.hidden = !mode;
    line.classList.toggle("warn", t.pausedAt !== null);
    $("timer-reset").hidden = t.pausedAt === null;
  }

  /** Each slide's planned window, from its first page that has one. */
  private plans: Array<Plan | null> = [];
  /** Planned length of the talk proper in seconds, 0 when nothing is planned. */
  private planned = 0;
  private segs: HTMLElement[] = [];
  private barScale = 0;

  /** The talk bar: one segment per planned slide, as long as its window. */
  private buildTalkbar(): void {
    const d = this.deck;
    this.plans = d.slides.map((pages) => pages.map((p) => d.pages[p].plan).find((p) => p !== null) ?? null);
    const main = this.plans.slice(0, this.state.endSlide + 1);
    this.planned = Math.max(0, ...main.map((p) => p?.end ?? 0));
    this.segs = [];
    main.forEach((p, slide) => {
      if (p && p.end > p.start) this.segs[slide] = el("div", "seg");
    });
    // Without a plan, the bar fills with the time spent.
    const spent = el("div", "seg done");
    spent.id = "talk-spent";
    spent.hidden = this.planned > 0;
    $("talkbar").replaceChildren(...this.segs.filter(Boolean), spent, el("div", "budget"), el("div", "now"));
    this.barScale = 0;
  }

  private renderPace(now: number): void {
    const s = this.state;
    const slide = this.deck.pages[s.page].slide;
    const talk = this.talk();
    const length = Math.round(T.talkLength(s.timer, talk, now) / 1000);
    const at = T.elapsed(s.timer, now) / 1000;
    const started = s.timer.startedAt !== null;
    const planned = this.planned > 0;
    // Without details, words only for being off plan.
    const detail = this.paceDetail;
    $("pace").hidden = !planned && !length;

    // This slide: its window, how much of it has gone, and how far off it you are.
    const plan = slide <= s.endSlide ? this.plans[slide] : null;
    $("pace-slide").hidden = !plan;
    const where = plan && started ? against(plan, at) : null;
    if (plan) {
      const tone = where?.tone ?? "on";
      $("pace-window").textContent = plan.end > plan.start ? `${mark(plan.start)} – ${mark(plan.end)}` : `at ${mark(plan.start)}`;
      const fill = $("pace-fill");
      fill.style.width = `${(where?.fill ?? 0) * 100}%`;
      fill.className = `fill t-${tone}`;
      const text = $("pace-slide-text");
      text.className = `pace-text t-${tone}`;
      text.textContent = !where
        ? detail
          ? `${span(plan.end - plan.start)} planned`
          : ""
        : tone === "late"
          ? `${span(where.offset)} over`
          : tone === "early"
            ? `${span(where.offset)} early`
            : detail
              ? `${span(plan.end - at)} left`
              : "";
    }

    // The talk: time left, and where you stand on the bar.
    const left = $("pace-left");
    left.textContent = !length ? `${span(this.planned)} planned` : at <= length ? `${span(length - at)} left` : `${span(at - length)} over`;
    left.className = length && at > length ? "t-over" : "";
    const text = $("pace-talk-text");
    if (planned) {
      // The rest of the talk as planned, shifted by how far off this slide you are.
      const offset = where?.offset ?? 0;
      text.textContent = !detail ? "" : plan ? `ends ≈ ${mark(this.planned + offset)}` : slide > s.endSlide ? "backup" : "";
      text.className = `pace-text ${offset > 0 ? "t-late" : offset < 0 ? "t-early" : ""}`;
    } else {
      // pdfpc's rule: against an even pace through the slides, a minute's leeway.
      const drift = T.drift(s.timer, talk, now) / 1000;
      const off = started && Math.abs(drift) >= 60;
      text.textContent = !started ? "" : off ? `${span(drift)} ${drift > 0 ? "behind" : "ahead"}` : detail ? "on pace" : "";
      text.className = `pace-text ${off ? (drift > 0 ? "t-late" : "t-early") : ""}`;
    }

    const bar = $("talkbar");
    const scale = Math.max(this.planned, length) || 1;
    if (scale !== this.barScale) {
      this.barScale = scale;
      const pct = (x: number) => `${(Math.min(1, x / scale) * 100).toFixed(3)}%`;
      this.segs.forEach((seg, i) => {
        const p = this.plans[i]!;
        seg.style.left = pct(p.start);
        seg.style.width = pct(p.end - p.start);
      });
      const budget = bar.querySelector<HTMLElement>(".budget")!;
      budget.hidden = !(planned && length);
      budget.style.left = pct(length);
    }
    bar.querySelector<HTMLElement>(".now")!.style.left = `${Math.min(1, at / scale) * 100}%`;
    if (!planned) $("talk-spent").style.width = `${Math.min(1, at / scale) * 100}%`;
  }

  private renderStatus(): void {
    const status = $("audience-status");
    if (!audience.open) {
      status.textContent = this.state.solo
        ? "Presenting in this window. Esc returns to the presenter view."
        : "Audience window closed. Press o to open it.";
    } else if (audience.fullscreen) {
      status.textContent = `Audience fullscreen${audience.screen ? ` on ${audience.screen}` : ""}.`;
    } else if (audience.awaitingFullscreen) {
      status.textContent = `Audience window on ${audience.screen}. It goes fullscreen at your next key press or click.`;
    } else {
      status.textContent =
        `Audience window open${audience.screen ? ` on ${audience.screen}` : "; drag it to the projector"}. ` +
        "Double-click it or press Shift+W for fullscreen.";
    }
    const scr = $("screen-status");
    const extended = screen.isExtended;
    scr.textContent =
      extended === false ? "One screen only. For a projector, set displays to Extend (on Windows: Win+P)." : "";
    scr.classList.toggle("warn", extended === false);
  }

  // Strip and overview

  private thumb(page: number): Thumb {
    const t = new Thumb(page, this.cache, this.deck);
    const list = this.thumbs.get(page) ?? [];
    list.push(t);
    this.thumbs.set(page, list);
    return t;
  }

  private lazy(root: HTMLElement, items: Array<[HTMLElement, Thumb]>): void {
    this.observers.get(root)?.disconnect();
    for (const [page, list] of this.thumbs) this.thumbs.set(page, list.filter((t) => t.canvas.isConnected));
    const byEl = new Map(items);
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && byEl.get(e.target as HTMLElement)?.reveal()),
      { root, rootMargin: "600px 0px" },
    );
    items.forEach(([e]) => io.observe(e));
    this.observers.set(root, io);
  }

  private buildStrip(): void {
    const d = this.deck;
    const strip = $("strip");
    const items: Array<[HTMLElement, Thumb]> = [];
    this.stripItems = [];
    this.stripSlide = -1;
    strip.replaceChildren();
    d.slides.forEach((_, slide) => {
      if (slide === this.state.endSlide + 1) strip.append(el("li", "divider", "Backup"));
      const li = el("li");
      li.classList.toggle("hidden", !this.slideVisible(slide));
      const t = this.thumb(this.lastOf(slide));
      li.append(el("span", "num", String(slide + 1)), t.canvas);
      li.addEventListener("click", () => this.go(this.firstOf(slide), true));
      strip.append(li);
      this.stripItems[slide] = li;
      items.push([li, t]);
    });
    this.lazy(strip, items);
  }

  private setOverview(open: boolean): void {
    const s = this.state;
    s.overview = open;
    $("overview").hidden = !open;
    if (open) {
      s.selected = this.deck.pages[s.page].slide;
      this.buildOverview();
    }
    this.render();
  }

  private buildOverview(): void {
    const d = this.deck;
    const grid = $("overview-grid");
    const items: Array<[HTMLElement, Thumb]> = [];
    this.overviewItems = [];
    grid.replaceChildren();
    d.slides.forEach((pages, slide) => {
      if (slide === this.state.endSlide + 1) grid.append(el("li", "divider", "Backup"));
      const li = el("li");
      li.classList.toggle("hidden", !this.slideVisible(slide));
      li.classList.toggle("current", slide === d.pages[this.state.page].slide);
      const t = this.thumb(this.lastOf(slide));
      const cap = el("div", "cap");
      cap.append(
        el("span", "", String(slide + 1)),
        el("span", "", [pages.length > 1 ? `${pages.length} steps` : "", this.slideVisible(slide) ? "" : "hidden"].filter(Boolean).join(" · ")),
      );
      li.append(t.canvas, cap);
      li.addEventListener("click", () => this.pick(slide));
      grid.append(li);
      this.overviewItems[slide] = li;
      items.push([li, t]);
    });
    this.lazy($("overview"), items);
    this.select(this.state.selected);
  }

  private select(slide: number): void {
    const s = this.state;
    this.overviewItems[s.selected]?.classList.remove("selected");
    s.selected = Math.max(0, Math.min(this.deck.slides.length - 1, slide));
    const item = this.overviewItems[s.selected];
    item?.classList.add("selected");
    item?.scrollIntoView({ block: "nearest" });
  }

  private pick(slide: number): void {
    this.setOverview(false);
    this.go(this.firstOf(slide), true);
  }

  private overviewKey(e: KeyboardEvent): boolean {
    const s = this.state;
    const items = this.overviewItems;
    const top = items[0]?.offsetTop;
    const columns = Math.max(1, items.filter((i) => i.offsetTop === top).length);
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    if (e.key in moves && !e.shiftKey) {
      this.select(s.selected + moves[e.key]);
      return true;
    }
    if (e.key === "Enter") {
      this.pick(s.selected);
      return true;
    }
    if (e.key === "Home" || e.key === "End") {
      this.select(e.key === "Home" ? 0 : this.deck.slides.length - 1);
      return true;
    }
    return false;
  }

  // Dialogs and modes

  private openGoto(): void {
    const dialog = $<HTMLDialogElement>("goto");
    const input = $<HTMLInputElement>("goto-input");
    input.value = "";
    input.max = String(this.deck.slides.length);
    let submitted = false;
    dialog.querySelector("form")!.onsubmit = () => (submitted = true);
    dialog.onclose = () => {
      const n = Number.parseInt(input.value, 10);
      if (submitted && n >= 1 && n <= this.deck.slides.length) this.go(this.firstOf(n - 1), true);
    };
    dialog.showModal();
  }

  private setSolo(on: boolean): void {
    const s = this.state;
    s.solo = on;
    const host = $("solo");
    host.hidden = !on;
    if (on) {
      this.solo = new SlideView(host, this.deck, this.cache, 0);
      this.solo.start();
      host.onpointermove = (e) => this.pointAt(this.solo?.toPage(e.clientX, e.clientY) ?? null, "presenter");
      host.onclick = () => this.act("next");
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      this.solo?.dispose();
      this.solo = null;
      host.replaceChildren();
      if (document.fullscreenElement) void document.exitFullscreen();
    }
    this.render();
  }

  private save(): void {
    if (!this.track) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      const s = this.state;
      void store.saveSession({
        pdfName: this.deck.name,
        page: s.page,
        timer: s.timer,
        endSlide: s.endSlide,
        bookmark: s.bookmark,
        savedAt: Date.now(),
      });
    }, 300);
  }
}

/** Turns wheel or touchpad scrolling into single steps. */
function wheelStepper(step: (dir: 1 | -1) => void): (e: WheelEvent) => void {
  let sum = 0;
  let last = 0;
  return (e) => {
    sum += e.deltaY;
    const now = performance.now();
    if (Math.abs(sum) > 40 && now - last > 350) {
      step(sum > 0 ? 1 : -1);
      sum = 0;
      last = now;
    }
  };
}

// Loading

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

async function readFiles(files: Iterable<File>): Promise<Partial<Source>> {
  const out: Partial<Source> = {};
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (name.endsWith(".pdfpc") || name.endsWith(".json")) {
      out.pdfpc = { name: f.name, text: await f.text() };
    } else if (name.endsWith(".pdf") || f.type === "application/pdf") {
      out.pdf = { name: f.name, data: await f.arrayBuffer() };
    } else if (new TextDecoder().decode(await f.slice(0, 5).arrayBuffer()) === "%PDF-") {
      out.pdf = { name: f.name, data: await f.arrayBuffer() };
    } else {
      throw new Error(`${f.name} is neither a PDF nor a .pdfpc file.`);
    }
  }
  return out;
}

interface OpenOptions {
  /** Where to resume. */
  saved?: store.SavedSession;
  /** Keep the files for "Resume" after a reload. */
  keep?: boolean;
  /** Save the place and timer as the talk goes. */
  track?: boolean;
}

async function openSource(source: Source, { saved, keep = true, track = true }: OpenOptions = {}): Promise<void> {
  let meta: PdfpcFile | null = null;
  const notices: string[] = [];
  if (source.pdfpc) {
    try {
      meta = parsePdfpc(source.pdfpc.text);
    } catch (err) {
      if (!(err instanceof PdfpcError)) throw err;
      notices.push(`${source.pdfpc.name}: ${err.message} Continuing without it.`);
      source = { pdf: source.pdf };
    }
  }
  const deck = await openDeck(source.pdf.data, source.pdf.name, meta);
  if (source.pdfpc && stem(source.pdfpc.name) !== stem(source.pdf.name)) {
    notices.push(`Note: ${source.pdfpc.name} and ${source.pdf.name} have different names. Check that they belong together.`);
  }
  notices.push(...deck.warnings);

  const previous = presenter;
  presenter = null;
  previous?.dispose();
  await previous?.deck.doc.loadingTask.destroy();
  presenter = new Presenter(deck, source, saved, track);
  if (keep) {
    void store.saveDeck({ pdfName: source.pdf.name, pdf: source.pdf.data, pdfpcName: source.pdfpc?.name, pdfpc: source.pdfpc?.text });
  }
  if (notices.length) toast(notices.join(" "), "error", 9000);
  else if (!source.pdfpc) toast("No .pdfpc file. Drop it on this window any time to add notes and timing.", "info", 6000);
}

async function openFiles(files: Iterable<File>): Promise<void> {
  const status = $("start-error");
  try {
    const got = await readFiles(files);
    if (got.pdf) {
      status.hidden = false;
      status.textContent = `Opening ${got.pdf.name}…`;
      await openSource({ pdf: got.pdf, pdfpc: got.pdfpc });
      status.hidden = true;
    } else if (got.pdfpc && presenter) {
      // Notes added to the deck already open: keep the place and the timer.
      const p = presenter;
      const s = p.state;
      await openSource(
        { pdf: p.source.pdf, pdfpc: got.pdfpc },
        { saved: { pdfName: p.deck.name, page: s.page, timer: s.timer, bookmark: s.bookmark, savedAt: Date.now() } },
      );
      toast(`Loaded notes from ${got.pdfpc.name}.`);
    } else if (got.pdfpc) {
      throw new Error("That's the .pdfpc file. Add the PDF too (you can select both at once).");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (presenter) toast(message, "error", 8000);
    else {
      status.hidden = false;
      status.textContent = message;
    }
  }
}

function decodeDataUrl(url: string): ArrayBuffer {
  const bin = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function boot(): Promise<void> {
  $("version").innerHTML = `v${__VERSION__} · <a href="https://github.com/youweizhuo/pdfpcnic" target="_blank" rel="noopener">source</a>`;
  $("offline-note").innerHTML = __SINGLE_FILE__
    ? "This is the offline copy: it needs no network."
    : `<a href="./pdfpcnic.html" download>Download the offline copy</a> (one HTML file).`;

  const grid = $("help-grid");
  for (const [title, rows] of HELP) {
    const section = el("section");
    const dl = el("dl");
    for (const [keys, what] of rows) dl.append(el("dt", "", keys), el("dd", "", what));
    section.append(el("h3", "", title), dl);
    grid.append(section);
  }

  const input = $<HTMLInputElement>("files");
  input.addEventListener("change", () => {
    if (input.files?.length) void openFiles([...input.files]);
    input.value = "";
  });
  $("open-files").addEventListener("click", () => input.click());
  $("demo").addEventListener("click", () => {
    void openSource(
      { pdf: { name: "demo.pdf", data: decodeDataUrl(demoPdfUrl) }, pdfpc: { name: "demo.pdfpc", text: demoPdfpc } },
      { keep: false, track: false },
    );
  });

  const drop = $("drop");
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    drop.classList.add("over");
  });
  window.addEventListener("dragleave", () => {
    if (--depth <= 0) drop.classList.remove("over");
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    drop.classList.remove("over");
    if (e.dataTransfer?.files.length) void openFiles([...e.dataTransfer.files]);
  });

  // A key press or click lends the audience window what it needs to go fullscreen.
  window.addEventListener("keydown", () => audience.claimFullscreen(), { capture: true });
  window.addEventListener("pointerdown", () => audience.claimFullscreen(), { capture: true });
  window.addEventListener("keydown", (e) => presenter?.onKey(e));

  // Offer to pick up where an earlier visit left off (an accidental reload, say).
  const [deck, session] = await Promise.all([store.loadDeck(), store.loadSession()]);
  if (deck) {
    const resume = $<HTMLButtonElement>("resume");
    const recent = session && session.pdfName === deck.pdfName && Date.now() - session.savedAt < SESSION_TTL;
    resume.textContent = recent ? `Resume ${deck.pdfName} at page ${session.page + 1}` : `Reopen ${deck.pdfName}`;
    resume.hidden = false;
    resume.focus();
    resume.addEventListener("click", () => {
      const source: Source = {
        pdf: { name: deck.pdfName, data: deck.pdf },
        pdfpc: deck.pdfpc && deck.pdfpcName ? { name: deck.pdfpcName, text: deck.pdfpc } : undefined,
      };
      void openSource(source, { saved: recent ? session : undefined, keep: false }).catch((err) => {
        $("start-error").hidden = false;
        $("start-error").textContent = String(err);
      });
    });
  }
}

// For tests and the curious.
Object.assign(window, {
  pdfpcnic: {
    get state() {
      return presenter?.state;
    },
    get deck() {
      return presenter?.deck;
    },
    audience,
  },
});

void boot();
