import "./style.css";
import { Audience } from "./audience";
import { openDeck, type Deck } from "./deck";
import { actionFor, HELP, type Action } from "./keys";
import { renderNote } from "./notes";
import { grade, mark, SLACK, span, type Plan, type Slack } from "./pace";
import { parsePdfpc, PdfpcError, type PdfpcFile } from "./pdfpc";
import { PageCache } from "./render";
import { Spoken } from "./spoken";
import * as store from "./store";
import * as T from "./timer";
import { SlideView, Thumb, type FollowLink, type Point } from "./view";
import { demoDeck } from "variant";

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** A button's label and key, redrawn only when they change (so a click in progress isn't lost). */
function label(b: HTMLElement, text: string, key = ""): void {
  const now = `${text}\n${key}`;
  if (b.dataset.label === now) return;
  b.dataset.label = now;
  b.replaceChildren(text, ...(key ? [el("kbd", "", key)] : []));
}

let toastTimer = 0;
/** A note at the bottom that goes away on its own, out of the way of clicks. */
function toast(message: string, ms = 4500): void {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Something went wrong: it stays, above any note and selectable for copying, until closed. */
function report(message: string, reason = ""): void {
  $("error-text").textContent = reason ? `${message}\nThe browser said: ${reason}` : message;
  $("error").hidden = false;
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
  follow: (to) => presenter?.follow(to),
  change: () => presenter?.render(),
});

let presenter: Presenter | null = null;

const LEVELS = ["early", "serious", "severe"] as const;
type SlackLevel = (typeof LEVELS)[number];

/** Slider ranges for the pace levels: [min, max, step] in seconds, or in percent. */
const SLACK_RANGE: Record<Slack["unit"], Record<SlackLevel, [number, number, number]>> = {
  time: { early: [0, 180, 15], serious: [15, 300, 15], severe: [15, 300, 15] },
  share: { early: [0, 10, 1], serious: [1, 15, 1], severe: [1, 20, 1] },
};

function loadSlack(): Slack {
  const saved = store.pref<Slack | null>("paceSlack", null);
  return saved && saved.unit in SLACK ? { ...SLACK[saved.unit], ...saved } : { ...SLACK.time };
}

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
  private stopTicking = () => {};
  private saveTimer = 0;
  private notesPage = -1;
  private stripSlide = -1;
  private laserSize = store.pref("laserSize", 0.035);
  private notesSize: number;
  private slack: Slack = loadSlack();
  /** How much the covered part of a note dims, 0 for not at all. */
  private notesDim = store.pref("notesDim", 0.5);

  constructor(
    readonly deck: Deck,
    readonly source: Source,
    saved: store.SavedSession | undefined,
    /** Save the place and timer, for resuming after a reload. */
    readonly track: boolean,
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
    if (!fresh && saved.spent) this.spent = new Map(Object.entries(saved.spent));
    this.notesSize = store.pref<number | null>("notesSize", null) ?? this.deckNotesSize;

    const first = deck.pages[0];
    document.documentElement.style.setProperty("--aspect", `${first.width} / ${first.height}`);
    document.documentElement.style.setProperty("--notes", `${this.notesSize}px`);
    document.title = `${deck.name} · pdfpcnic`;

    this.current = new SlideView($("current"), deck, this.cache, 1, { follow: this.follow, marked: true });
    this.current.onLayout = () => this.fitSlidebar();
    this.next = new SlideView($("next"), deck, this.cache, 2, { align: "start" });
    this.cache.onRender((page) => this.thumbs.get(page)?.forEach((t) => t.draw()));
    audience.bind(deck, this.cache);

    $("start").hidden = true;
    $("presenter").hidden = false;
    this.applyColumns(store.pref("split", 0.62), store.pref<number | null>("strip", null));
    this.applyStage(store.pref("stage", 1));
    Spoken.setDim(this.notesDim);
    this.current.start();
    this.next.start();
    this.buildStrip();
    this.buildTalkbar();
    this.wire();
    this.stopTicking = ticker(() => this.tick());
    this.render();
  }

  dispose(): void {
    this.abort.abort();
    this.stopTicking();
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

  /** Follows a link on the slide: a jump, so back (Shift+Backspace) returns. */
  readonly follow: FollowLink = (to) => {
    if ("page" in to) return this.go(to.page, true);
    // The named actions PDF viewers know, as pdf.js's viewer reads them.
    if (to.action === "NextPage") this.go(this.state.page + 1);
    else if (to.action === "PrevPage") this.go(this.state.page - 1);
    else if (to.action === "FirstPage") this.go(0, true);
    else if (to.action === "LastPage") this.go(this.deck.pages.length - 1, true);
    else if (to.action === "GoBack") this.act("back");
    else if (to.action === "GoForward") this.act("forward");
  };

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
        const step = d.slides[slide].slice(0, here.step).findLast(this.visible);
        if (step !== undefined) return this.go(step);
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
        const dir = action === "next10" ? 1 : -1;
        let target = Math.max(0, Math.min(d.slides.length - 1, slide + 10 * dir));
        // A hidden slide is passed over, as stepping does.
        if (!this.slideVisible(target)) target = this.slideFrom(target, dir) ?? this.slideFrom(target, dir === 1 ? -1 : 1) ?? slide;
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
        let page = from.pop();
        while (page === s.page) page = from.pop();
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
        if (s.laser) this.setLaserSize(this.laserSize * (f > 0 ? 1.2 : 1 / 1.2));
        else this.setNotesSize(this.notesSize + 2 * f);
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
        else document.documentElement.requestFullscreen().catch((err) => report("The browser refused fullscreen for this window.", reasonOf(err)));
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
          toast("The clock is running. Pause it first (p), then reset, or click Reset twice.");
          return;
        }
        s.timer = T.freshTimer();
        this.forgetVisits();
        toast("Clock reset to 0:00:00. It starts again at your next move, or press s.");
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
        if (!audience.show()) report("The browser blocked the audience window. Allow pop-ups for this page, then press o again.");
        return;
      case "slideSmaller":
      case "slideBigger":
        this.setStage(this.stage + (action === "slideBigger" ? 0.05 : -0.05));
        toast(`Current slide at ${Math.round(this.stage * 100)}% of its column.`, 1500);
        return;
      case "settings":
        this.syncSettings();
        $<HTMLDialogElement>("settings").showModal();
        return;
    }
    this.render();
  }

  // Input

  onKey(e: KeyboardEvent): void {
    // Dialogs (go to, settings) keep their keys.
    if (e.target instanceof HTMLInputElement || document.querySelector("dialog[open]")) return;
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
    const toggle = $("timer-toggle");
    toggle.addEventListener(
      "click",
      () => {
        toggle.blur();
        this.act(this.state.timer.startedAt === null ? "timerStart" : "timerPause");
      },
      { signal },
    );
    const reset = $("timer-reset");
    reset.addEventListener(
      "click",
      () => {
        reset.blur();
        const t = this.state.timer;
        // Running, it takes a second click, so a stray one can't wipe the talk's time.
        if (t.pausedAt === null && !this.resetArmed) {
          this.resetArmed = window.setTimeout(() => {
            this.resetArmed = 0;
            this.renderTimer();
          }, 3000);
          this.renderTimer();
          return;
        }
        clearTimeout(this.resetArmed);
        this.resetArmed = 0;
        if (t.pausedAt === null) this.state.timer = T.togglePause(t, Date.now());
        this.act("timerReset");
      },
      { signal },
    );

    for (const b of document.querySelectorAll<HTMLButtonElement>("#presenter [data-action]")) {
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

    const settings = $<HTMLDialogElement>("settings");
    settings.addEventListener("click", (e) => e.target === settings && settings.close(), { signal });
    const range = (id: string, set: (value: number) => void) =>
      $<HTMLInputElement>(id).addEventListener(
        "input",
        (e) => {
          set(Number((e.target as HTMLInputElement).value));
          this.syncSettings();
        },
        { signal },
      );
    range("set-stage", (v) => this.setStage(v / 100));
    range("set-notes", (v) => this.setNotesSize(v));
    range("set-laser", (v) => this.setLaserSize(v / 100));
    range("set-dim", (v) => this.setNotesDim(v / 100));
    // Pace levels: sliders in seconds or percent, as the unit says. The late
    // levels keep their order: serious never past severe.
    const setSlack = (key: SlackLevel, v: number) => {
      const s = { ...this.slack, [key]: this.slack.unit === "time" ? v : v / 100 };
      if (key === "serious") s.severe = Math.max(s.severe, s.serious);
      if (key === "severe") s.serious = Math.min(s.serious, s.severe);
      this.useSlack(s);
    };
    for (const key of LEVELS) range(`set-${key}`, (v) => setSlack(key, v));
    for (const b of document.querySelectorAll<HTMLButtonElement>("#set-unit button")) {
      b.addEventListener(
        "click",
        () => {
          // Keep the levels where they are, in the other unit, if the talk's length is known.
          const unit = b.dataset.unit as Slack["unit"];
          const t = this.target;
          if (unit === this.slack.unit) return;
          const next: Slack = { ...SLACK[unit] };
          if (t) {
            for (const key of LEVELS) {
              const [min, max] = SLACK_RANGE[unit][key];
              const v = unit === "time" ? Math.round((this.slack[key] * t) / 15) * 15 : Math.round((this.slack[key] / t) * 100);
              next[key] = Math.min(max, Math.max(min, v)) / (unit === "time" ? 1 : 100);
            }
          }
          this.useSlack(next);
          this.syncSettings();
        },
        { signal },
      );
    }
    $("set-defaults").addEventListener(
      "click",
      () => {
        this.setStage(1);
        this.setNotesSize(this.deckNotesSize);
        store.setPref("notesSize", null);
        this.setLaserSize(0.035);
        this.useSlack({ ...SLACK.time });
        this.setNotesDim(0.5);
        this.applyColumns(0.62, null);
        store.setPref("split", this.split);
        store.setPref("strip", null);
        this.syncSettings();
      },
      { signal },
    );

    // Columns, the current slide against its notes, and the thumbnails can all be dragged.
    draggable($("split"), signal, {
      move: (e) => {
        const left = $("notes").getBoundingClientRect().left;
        const right = $("strip-split").getBoundingClientRect().left - $("split").offsetWidth;
        this.applyColumns((e.clientX - left) / (right - left), this.stripWidth);
      },
      end: () => store.setPref("split", this.split),
    });
    let from = { y: 0, height: 0, stage: 1 };
    draggable($("stage-split"), signal, {
      start: (e) => (from = { y: e.clientY, height: this.current.root.offsetHeight, stage: this.stage }),
      move: (e) => this.applyStage((from.stage * (from.height + e.clientY - from.y)) / from.height),
      end: () => store.setPref("stage", this.stage),
    });
    draggable($("strip-split"), signal, {
      move: (e) => {
        const right = $("presenter").getBoundingClientRect().right;
        const width = right - e.clientX - $("strip-split").offsetWidth / 2;
        // Dragged nearly shut, the thumbnails go away.
        this.applyColumns(this.split, width < 70 ? 0 : Math.min(420, width));
      },
      end: () => store.setPref("strip", this.stripWidth),
    });
    $("strip-split").addEventListener(
      "dblclick",
      () => {
        this.applyColumns(this.split, this.stripWidth === 0 ? (this.stripOpen ?? null) : 0);
        store.setPref("strip", this.stripWidth);
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
  /** Thumbnail strip width in px: null for the default, 0 when hidden. */
  private stripWidth: number | null = null;
  /** The width to bring a hidden strip back to. */
  private stripOpen: number | null = null;
  private applyColumns(split: number, strip: number | null): void {
    this.split = Math.min(0.8, Math.max(0.4, split || 0.62));
    if (strip !== 0) this.stripOpen = strip;
    this.stripWidth = strip;
    $("strip").hidden = strip === 0;
    $("strip-split").classList.toggle("collapsed", strip === 0);
    $("presenter").style.gridTemplateColumns =
      `minmax(0, ${this.split}fr) 28px minmax(0, ${1 - this.split}fr) 14px ${strip === null ? "clamp(120px, 12vw, 220px)" : `${strip}px`}`;
  }

  /** Current slide width as a share of its column; what it gives up goes to the notes. */
  private stage = 1;
  private applyStage(f: number): void {
    this.stage = Math.min(1, Math.max(0.5, Math.round(f * 100) / 100));
    document.documentElement.style.setProperty("--stage", String(this.stage));
  }
  private setStage(f: number): void {
    this.applyStage(f);
    store.setPref("stage", this.stage);
  }

  /** Notes size the .pdfpc file asks for, in px. */
  private get deckNotesSize(): number {
    return this.deck.noteFontSize ? Math.round((this.deck.noteFontSize * 4) / 3) : 24;
  }
  private setNotesSize(px: number): void {
    this.notesSize = Math.min(72, Math.max(12, px));
    document.documentElement.style.setProperty("--notes", `${this.notesSize}px`);
    store.setPref("notesSize", this.notesSize);
  }

  /** Laser dot size, as a share of the slide's height. */
  private setLaserSize(f: number): void {
    this.laserSize = Math.min(0.2, Math.max(0.01, f));
    store.setPref("laserSize", this.laserSize);
  }

  private syncSettings(): void {
    const show = (id: string, value: number, text: string) => {
      const input = $<HTMLInputElement>(id);
      input.value = String(value);
      input.nextElementSibling!.textContent = text;
    };
    show("set-stage", Math.round(this.stage * 100), `${Math.round(this.stage * 100)}%`);
    show("set-notes", this.notesSize, `${this.notesSize} px`);
    const laser = Math.round(this.laserSize * 200) / 2;
    show("set-laser", laser, `${laser}%`);
    const dim = Math.round(this.notesDim * 100);
    show("set-dim", dim, dim ? `${dim}%` : "off");
    const { unit } = this.slack;
    const t = this.target;
    for (const b of document.querySelectorAll<HTMLButtonElement>("#set-unit button")) {
      b.classList.toggle("on", b.dataset.unit === unit);
    }
    for (const key of LEVELS) {
      const v = this.slack[key];
      const input = $<HTMLInputElement>(`set-${key}`);
      [input.min, input.max, input.step] = SLACK_RANGE[unit][key].map(String);
      // The other unit alongside, for this talk.
      if (unit === "time") show(`set-${key}`, v, t ? `${span(v)} (${Math.round((v / t) * 100)}%)` : span(v));
      else show(`set-${key}`, Math.round(v * 100), t ? `${Math.round(v * 100)}% (${span(v * t)})` : `${Math.round(v * 100)}%`);
    }
  }

  private setNotesDim(f: number): void {
    this.notesDim = Math.min(0.8, Math.max(0, f));
    store.setPref("notesDim", this.notesDim);
    Spoken.setDim(this.notesDim);
    this.renderNotesDim();
  }

  private useSlack(slack: Slack): void {
    this.slack = slack;
    store.setPref("paceSlack", slack);
    this.renderTimer();
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
    $("next").classList.toggle("backup", next !== null && d.pages[next].slide > s.endSlide);

    this.solo?.show(shown);
    this.renderLaser();

    if (this.notesPage !== s.page) {
      this.notesPage = s.page;
      const body = $("notes-body");
      if (here.note) renderNote(body, here.note, d.markdown);
      else body.replaceChildren(el("p", "empty", "No notes for this slide."));
      $("notes").scrollTop = 0;
      this.spoken.index(body);
    }

    if (this.stripSlide !== here.slide) {
      this.stripItems[this.stripSlide]?.classList.remove("current");
      this.stripSlide = here.slide;
      const item = this.stripItems[here.slide];
      item?.classList.add("current");
      item?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    this.segs.forEach((seg, i) => seg.classList.toggle("current", i === here.slide));

    // When the audience isn't seeing your current slide, say so over it, and
    // mark in the strip the slide it is frozen on.
    const frozen = s.frozen === null ? null : d.pages[s.frozen].slide;
    this.stripItems.forEach((li, i) => li.classList.toggle("frozen", i === frozen));
    const card = $("audience-state");
    card.hidden = !s.black && frozen === null;
    card.className = `audience-state ${s.black ? "black" : "frozen"}`;
    card.querySelector("strong")!.textContent = s.black ? "Audience screen is black" : `Audience frozen on slide ${frozen! + 1}`;
    card.querySelector("span")!.textContent = s.black
      ? `Press b to show slide ${(frozen ?? here.slide) + 1}${frozen === null ? "" : " (frozen)"}`
      : `Press f to move it to slide ${here.slide + 1}`;
    this.renderStatus();

    const on: Partial<Record<Action, boolean>> = {
      laserMode: s.laser,
      blank: s.black,
      freeze: s.frozen !== null,
      overview: s.overview,
      fullscreen: !!document.fullscreenElement,
      help: s.help,
    };
    // The audience's next step, standing out until the audience is fullscreen.
    // Where only the audience window can go fullscreen, the button brings it
    // forward (as o does) and says to double-click it.
    const ab = $("audience-button");
    const toggles = audience.open && (audience.fullscreen || audience.fullscreenFromHere);
    ab.dataset.action = toggles ? "audienceFullscreen" : "openAudience";
    ab.classList.toggle("cta", !this.audienceReady());
    if (!audience.open) label(ab, "Open audience window", "o");
    else if (audience.fullscreen) label(ab, "Exit audience fullscreen", "⇧W");
    else if (!toggles) label(ab, "Double-click the audience window");
    else label(ab, audience.screen ? `Audience fullscreen on ${audience.screen}` : "Audience fullscreen", "⇧W");
    for (const b of document.querySelectorAll<HTMLElement>(".toolbar [data-action]")) {
      b.classList.toggle("on", !!on[b.dataset.action as Action]);
    }
    $("help").hidden = !s.help;
    this.current.root.classList.toggle("laser-on", s.laser);

    // Keep what is on screen, and render the pages around it ahead of time.
    this.cache.pinned = new Set([s.page, shown, ...(next === null ? [] : [next])]);
    const width = Math.max(audience.pixelWidth, this.current.pixelWidth, this.solo?.pixelWidth ?? 0);
    const prev = this.slideFrom(here.slide, -1);
    // The next step and the next slide right away; going back and further ahead when idle.
    this.cache.prefetch(
      [s.page + 1, ...(next === null ? [] : [next])],
      [s.page - 1, ...(prev === null ? [] : [this.firstOf(prev)]), s.page + 2, s.page + 3],
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

  /** What the clock and pace show turn over with: the second of the talk (before it starts, of the day) and the minute. */
  private beatAt(now: number): string {
    const t = this.state.timer;
    const second = Math.floor((t.startedAt === null ? now : T.elapsed(t, now)) / 1000);
    return `${second}:${Math.floor(now / 60_000)}`;
  }
  private beat = "";
  /** Set while Reset waits for its second click. */
  private resetArmed = 0;
  /** On slide 1 with time on the clock, as last drawn. */
  private stale = false;

  /** The ticker's beat: redraws once a shown number turns over, not on every beat. Returns when to beat again. */
  private tick(): number {
    const now = Date.now();
    if (this.beatAt(now) !== this.beat) this.renderTimer();
    // In between, this slide's line and the notes move on, each redrawn only once it has changed.
    else if (this.slideTime) {
      this.renderFill(now);
      this.renderNotesDim(now);
    }
    return this.beatMs;
  }

  private renderTimer(): void {
    const now = Date.now();
    this.beat = this.beatAt(now);
    this.renderClock(now);
    this.renderPace(now);
    this.renderNotesDim(now);
  }

  /** The audience sees the slides: fullscreen, or presented in this window. */
  private audienceReady(): boolean {
    return audience.fullscreen || this.state.solo;
  }

  /** Présentation.app's clock: time since the start, and the time of day. */
  private renderClock(now: number): void {
    const s = this.state;
    const t = s.timer;
    const timer = $("timer");
    timer.textContent = T.format(T.elapsed(t, now));
    timer.classList.toggle("idle", t.startedAt === null || t.pausedAt !== null);
    $("wallclock").textContent = T.formatClock(now);
    // Back on slide 1 with time on the clock: likely a look through the slides
    // before the talk, which would throw its pace off. Reset is the way out.
    const stale = t.startedAt !== null && this.deck.pages[s.page].slide === 0;
    if (stale && !this.stale) toast("The clock has already started. Starting the talk now? Reset it first.", 8000);
    this.stale = stale;
    // The buttons say what state the clock is in, so nothing under it comes and
    // goes: what to press next stands out, and the rest is in their tooltips.
    // One button stands out at a time, and the audience's steps come first.
    const ours = this.audienceReady();
    const toggle = $("timer-toggle");
    if (t.startedAt === null) {
      label(toggle, "Start", "s");
      const until = T.untilStart(this.talk(), now);
      toggle.title = until
        ? `The talk starts at ${this.deck.startTime}, in ${T.format(until)}.`
        : `Starts the clock. It also starts ${s.page === 0 ? "when you leave slide 1" : "at your next move"}.`;
    } else {
      label(toggle, t.pausedAt === null ? "Pause" : "Resume", "p");
      toggle.title = "";
    }
    toggle.classList.toggle("cta", ours && (t.startedAt === null || t.pausedAt !== null) && !stale);
    const reset = $<HTMLButtonElement>("timer-reset");
    reset.title = t.pausedAt === null ? "While the clock runs, click twice." : "";
    reset.disabled = t.startedAt === null;
    reset.classList.toggle("cta", ours && stale && !this.resetArmed);
    reset.classList.toggle("confirm", !!this.resetArmed);
    label(reset, this.resetArmed ? "Click again to reset" : "Reset", "⇧R");
  }

  /** Each slide's planned window, from its first step's start to its last step's end. */
  private plans: Array<Plan | null> = [];
  /** Whether any note has a timing line. */
  private timed = false;
  /** Planned length of the talk proper in seconds, from the timing lines. */
  private planned = 0;
  private segs: HTMLElement[] = [];
  private barScale = 0;

  /** The talk bar: one block per slide with a planned window. */
  private buildTalkbar(): void {
    const d = this.deck;
    this.plans = d.slides.map((pages) => {
      const own = pages.flatMap((p) => d.pages[p].plan ?? []);
      return own.length ? { start: Math.min(...own.map((p) => p.start)), end: Math.max(...own.map((p) => p.end)) } : null;
    });
    this.timed = this.plans.some(Boolean);
    const main = this.plans.slice(0, this.state.endSlide + 1);
    this.planned = Math.max(0, ...main.map((p) => p?.end ?? 0));
    this.segs = [];
    main.forEach((p, slide) => {
      if (!this.timed || (p && p.end > p.start)) this.segs[slide] = el("div", "seg");
    });
    $("talkbar").replaceChildren(el("div", "past"), ...this.segs.filter(Boolean), el("div", "projected"), el("div", "spent"), el("div", "target"));
    this.barScale = 0;
  }

  /** The planned window of the nearest slide at or before `slide`, for slides off the plan. */
  private planBefore(slide: number, length: number): Plan | null {
    for (let i = Math.min(slide, this.state.endSlide); i >= 0; i--) {
      const p = this.planOf(i, length);
      if (p) return p;
    }
    return null;
  }

  /** Forgets your time on each slide, as when the timer goes back to zero. */
  private forgetVisits(): void {
    this.spent.clear();
    this.visit = null;
    this.lastPlan = null;
  }

  /** A slide's planned window. Without timing lines, the talk's length is split evenly over the slides. */
  private planOf(slide: number, length: number): Plan | null {
    const n = this.state.endSlide + 1;
    if (slide >= n) return null;
    if (this.timed) return this.plans[slide];
    return length ? { start: (slide * length) / n, end: ((slide + 1) * length) / n } : null;
  }

  /** The talk's target length in seconds, as last drawn; settings show the slack against it. */
  private target = 0;
  /** Seconds spent on each planned window (or slide without one) on earlier visits. */
  private spent = new Map<string, number>();
  /** The window you're on, and when you came to it (seconds into the talk). */
  private visit: { key: string; since: number } | null = null;
  /** The last planned window you were on. */
  private lastPlan: Plan | null = null;
  /** Your time on this slide, the talk's seconds plus `base`, against its planned `budget`; null before the start or without a plan. */
  private slideTime: { base: number; budget: number } | null = null;

  /** Share of this slide's planned time used by `now`, or null when it has none. */
  private usedAt(now: number): number | null {
    const t = this.slideTime;
    return t && Math.min(1, Math.max(0, (t.base + T.elapsed(this.state.timer, now) / 1000) / t.budget));
  }

  private spoken = new Spoken();

  /** Dims the part of the note you'd have said by now, its edge fading over a second and a half of the slide's time. */
  private renderNotesDim(now = Date.now()): void {
    const used = this.notesDim > 0 ? this.usedAt(now) : null;
    this.spoken.show(used, used === null ? 0 : 1.5 / this.slideTime!.budget);
  }

  /** This slide's line in device pixels, and how far along it is drawn. */
  private fillPixels = 0;
  private fillAt = -1;

  /**
   * This slide's line, redrawn only once it has moved on a whole pixel: as
   * smooth as the screen can show, at a few frames a second. (A CSS animation
   * would have the browser draw every frame the screen shows, 60 or more a
   * second, for a line that moves a pixel every tenth of a second or so.)
   */
  private renderFill(now: number): void {
    const width = Math.max(1, this.fillPixels);
    const px = Math.round((this.usedAt(now) ?? 0) * width);
    if (px === this.fillAt) return;
    this.fillAt = px;
    $("slide-fill").style.transform = `scaleX(${px / width})`;
  }

  /** How soon to look again: when the line is due to move a pixel, at most 25 times a second; 4 times otherwise. */
  private beatMs = 250;

  /** Lays this slide's line exactly along the slide's foot: the slide is drawn in whole pixels, its box isn't. */
  private fitSlidebar(): void {
    const c = this.current.canvas.getBoundingClientRect();
    const bar = $("pace-slide");
    if (!c.width || bar.hidden) return;
    bar.style.width = `${c.width}px`;
    this.fillPixels = c.width * devicePixelRatio;
    this.fillAt = -1;
    bar.style.left = bar.style.top = "0px";
    const b = bar.getBoundingClientRect();
    bar.style.left = `${c.left - b.left}px`;
    bar.style.top = `${c.bottom - b.top}px`;
  }

  private renderPace(now: number): void {
    this.slideTime = null;
    const s = this.state;
    const slide = this.deck.pages[s.page].slide;
    const length = Math.round(T.talkLength(s.timer, this.talk(), now) / 1000);
    // Whole seconds, as the clock shows them, so every number here turns over with it.
    const at = Math.floor(T.elapsed(s.timer, now) / 1000);
    const started = s.timer.startedAt !== null;
    const planned = this.timed ? this.planned : length;
    for (const id of ["pace-slide", "pace-all-text", "talkbar"]) $(id).hidden = !planned;
    if (!planned) {
      this.beatMs = 250;
      return;
    }
    const target = length || planned;

    // The planned window you're in (a step with a window of its own, a
    // forced overlay say, goes by that). A slide without one, a backup slide,
    // may still say how long it takes.
    const page = this.deck.pages[s.page];
    const plan = slide > s.endSlide ? null : (this.timed && page.plan) || this.planOf(slide, length);
    const budget = plan ? plan.end - plan.start : (page.length ?? 0);
    // Your time on it, over every visit.
    if (started) {
      const key = plan ? `${slide}:${plan.start}:${plan.end}` : String(slide);
      if (this.visit && at < this.visit.since) this.forgetVisits();
      if (this.visit?.key !== key) {
        if (this.visit) this.spent.set(this.visit.key, (this.spent.get(this.visit.key) ?? 0) + at - this.visit.since);
        this.visit = { key, since: at };
      }
      if (plan) this.lastPlan = plan;
    }
    const base = this.visit ? (this.spent.get(this.visit.key) ?? 0) - this.visit.since : 0;
    const here = this.visit ? base + at : 0;

    // This slide, in the bar under it: its planned time against your time
    // on it. Late always shows, in three levels. A slide planned to take no
    // time has no bar (the row keeps its place, so the notes don't jump).
    $("pace-slide").classList.toggle("none", !budget);
    if (budget) {
      const text = $("pace-slide-text");
      const over = here - budget;
      const tone = !started ? "idle" : over > 0 ? grade(over, target, this.slack) : "on";
      // Words only once it's serious; the line says the rest.
      text.textContent = tone === "serious" || tone === "severe" ? `${span(over)} over` : "";
      text.className = `slidebar-text t-${tone}`;
      $("slide-fill").className = `slide-fill t-${tone}`;
      $("pace-slide").title = plan
        ? `This slide: planned ${mark(plan.start)}–${mark(plan.end)}, ${span(budget)}`
        : `This slide: ${span(budget)}, off the talk's plan`;
      if (started) this.slideTime = { base, budget };
    }
    this.renderFill(now);
    const moving = this.slideTime && s.timer.pausedAt === null && (this.usedAt(now) ?? 1) < 1;
    this.beatMs = moving ? Math.min(250, Math.max(40, (budget * 1000) / Math.max(1, this.fillPixels))) : 250;

    // All slides: where the talk would end if you moved on now, with the
    // slides after this one as planned, against the target end. A slide off
    // the plan (a backup slide, say) doesn't move you through it: you'd go on
    // from the last planned slide you were on.
    const from = plan ?? this.lastPlan ?? this.planBefore(slide, length);
    const finish = planned + (started ? at - (from?.end ?? 0) : 0);
    const diff = Math.round(finish - target);
    const all = $("pace-all-text");
    const level = started ? grade(diff, target, this.slack) : "idle";
    // A little early is simply on time here, and on time needs no words.
    all.textContent = diff > 0 ? `${span(diff)} late` : level === "early" ? `${span(diff)} early` : "";
    all.className = `pace-num t-${level}`;
    all.title = `Where the talk ends at this pace. Planned to end at ${mark(planned)}; target ${mark(target)}`;

    // The bar: fixed, with room past the target end. Time spent runs under
    // it, colored like "All slides", and goes on lighter to where the talk
    // would end.
    this.target = target;
    const bar = $("talkbar");
    const scale = Math.max(target * 1.1, planned);
    const x = (t: number) => `${((Math.min(Math.max(t, 0), scale) / scale) * 100).toFixed(3)}%`;
    if (scale !== this.barScale) {
      this.barScale = scale;
      this.segs.forEach((seg, i) => {
        const p = this.planOf(i, length)!;
        seg.style.left = x(p.start);
        seg.style.width = `calc(${x(p.end)} - ${x(p.start)})`;
      });
      bar.querySelector<HTMLElement>(".target")!.style.left = x(target);
      bar.querySelector<HTMLElement>(".past")!.style.left = x(target);
    }
    const tone = `t-${started ? level : "on"}`;
    const spent = bar.querySelector<HTMLElement>(".spent")!;
    spent.style.width = x(at);
    spent.className = `spent ${tone}`;
    const projected = bar.querySelector<HTMLElement>(".projected")!;
    projected.style.width = x(finish);
    projected.className = `projected ${tone}`;
  }

  private renderStatus(): void {
    const status = $("audience-status");
    if (!audience.open) {
      status.textContent = this.state.solo ? "Presenting in this window. Esc returns to the presenter view." : "";
    } else if (audience.fullscreen) {
      status.textContent = `Audience fullscreen${audience.screen ? ` on ${audience.screen}` : ""}.`;
    } else if (audience.refused) {
      status.textContent = "This browser lets only the audience window go fullscreen: double-click it.";
    } else {
      status.textContent = audience.screen
        ? "Audience window open, not fullscreen yet."
        : "Audience window open; drag it to the projector, then double-click it for fullscreen.";
    }
    status.classList.toggle("ask", audience.refused);
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
    strip.style.setProperty("--digits", `${String(d.slides.length).length}ch`);
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
      this.solo = new SlideView(host, this.deck, this.cache, 0, { follow: this.follow });
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
      const spent = new Map(this.spent);
      const v = this.visit;
      if (v) spent.set(v.key, (spent.get(v.key) ?? 0) + Math.floor(T.elapsed(s.timer, Date.now()) / 1000) - v.since);
      void store.saveSession({
        pdfName: this.deck.name,
        page: s.page,
        timer: s.timer,
        endSlide: s.endSlide,
        bookmark: s.bookmark,
        spent: Object.fromEntries(spent),
        savedAt: Date.now(),
      });
    }, 300);
  }
}

/**
 * Calls `tick`, then again after the ms it returns. The beat comes from a
 * worker: a window the browser takes for hidden (on a Mac, the presenter while
 * the audience is fullscreen on the other screen, say) has its timers slowed
 * to once a second, then once a minute, but not its messages.
 */
function ticker(tick: () => number): () => void {
  let stop = () => {};
  // Beats on even if a tick fails.
  const beat = (after: (ms: number) => void) => {
    let ms = 250;
    try {
      ms = tick();
    } finally {
      after(ms);
    }
  };
  // Without a worker, or if the browser turns it down later, plain timers.
  const fallback = () => {
    let id = 0;
    const run = () => beat((ms) => (id = window.setTimeout(run, ms)));
    run();
    stop = () => clearTimeout(id);
  };
  try {
    const src = "onmessage = (e) => setTimeout(() => postMessage(0), e.data);";
    const url =
      location.protocol === "file:"
        ? `data:text/javascript,${encodeURIComponent(src)}`
        : URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const loaded = () => url.startsWith("blob:") && URL.revokeObjectURL(url);
    const run = () => beat((ms) => worker.postMessage(ms));
    worker.onmessage = () => {
      loaded();
      worker.onmessage = run;
      run();
    };
    worker.onerror = () => {
      loaded();
      worker.terminate();
      fallback();
    };
    worker.postMessage(0);
    stop = () => worker.terminate();
  } catch {
    fallback();
  }
  return () => stop();
}

/** Calls back while `handle` is dragged with the pointer. */
function draggable(
  handle: HTMLElement,
  signal: AbortSignal,
  on: { start?: (e: PointerEvent) => void; move: (e: PointerEvent) => void; end: () => void },
): void {
  handle.addEventListener(
    "pointerdown",
    (e) => {
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      on.start?.(e);
    },
    { signal },
  );
  handle.addEventListener("pointermove", (e) => handle.hasPointerCapture(e.pointerId) && on.move(e), { signal });
  handle.addEventListener(
    "pointerup",
    () => {
      handle.classList.remove("dragging");
      on.end();
    },
    { signal },
  );
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
  if (notices.length) report(notices.join(" "));
  else if (!source.pdfpc) toast("No .pdfpc file. Drop it on this window any time to add notes and timing.", 6000);
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
        // Kept and tracked as the deck was: notes dropped on the demo don't make it the deck to resume.
        { saved: { pdfName: p.deck.name, page: s.page, timer: s.timer, bookmark: s.bookmark, savedAt: Date.now() }, keep: p.track, track: p.track },
      );
      toast(`Loaded notes from ${got.pdfpc.name}.`);
    } else if (got.pdfpc) {
      throw new Error("That's the .pdfpc file. Add the PDF too (you can select both at once).");
    }
  } catch (err) {
    const message = reasonOf(err);
    if (presenter) report(message);
    else {
      status.hidden = false;
      status.textContent = message;
    }
  }
}

async function boot(): Promise<void> {
  $("version").innerHTML =
    `v${__VERSION__} · <a href="https://github.com/youweizhuo/pdfpcnic" target="_blank" rel="noopener">source</a>` +
    (__SINGLE_FILE__ ? "" : ` · <a href="./licenses.txt" target="_blank">licenses</a>`);
  $("offline-note").innerHTML = __SINGLE_FILE__
    ? "This is the offline copy: it needs no network."
    : `<a href="./pdfpcnic.html" download>Download the offline copy</a> (one HTML file).`;

  const grid = $("help-grid");
  for (const [title, rows] of HELP) {
    const section = el("section");
    const dl = el("dl");
    for (const [keys, what] of rows) dl.append(el("dt", "", keys), el("dd", "", what));
    section.append(el("h3", "", title), dl);
    grid.insertBefore(section, $("legend"));
  }

  const input = $<HTMLInputElement>("files");
  input.addEventListener("change", () => {
    if (input.files?.length) void openFiles([...input.files]);
    input.value = "";
  });
  $("open-files").addEventListener("click", () => input.click());
  const demo = $("demo");
  if (demoDeck) {
    const load = demoDeck;
    demo.addEventListener("click", () => {
      void load()
        .then(({ pdf, pdfpc }) =>
          openSource({ pdf: { name: "demo.pdf", data: pdf }, pdfpc: { name: "demo.pdfpc", text: pdfpc } }, { keep: false, track: false }),
        )
        .catch((err) => {
          $("start-error").hidden = false;
          $("start-error").textContent = err instanceof Error ? err.message : String(err);
        });
    });
  } else demo.remove();

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

  window.addEventListener("keydown", (e) => presenter?.onKey(e));
  $("error-close").addEventListener("click", () => ($("error").hidden = true));

  // Offer to pick up where an earlier visit left off (an accidental reload, say).
  const [deck, session] = await Promise.all([store.loadDeck(), store.loadSession()]);
  if (deck) {
    const resume = $<HTMLButtonElement>("resume");
    const recent = session && session.pdfName === deck.pdfName && Date.now() - session.savedAt < SESSION_TTL;
    resume.textContent = recent ? `Resume ${deck.pdfName} at page ${session.page + 1}` : `Reopen ${deck.pdfName}`;
    resume.hidden = false;
    resume.focus();
    const forget = $<HTMLButtonElement>("forget");
    forget.hidden = false;
    forget.addEventListener("click", () => {
      resume.remove();
      forget.remove();
      void store.forget();
      toast(`Removed ${deck.pdfName} from this browser.`);
    });
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
