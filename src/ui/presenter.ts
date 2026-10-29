// The presenter page: Présentation.app's layout, drawn from the talk
// (core/talk.ts). It turns keys and clicks into the talk's actions, and runs
// the platform's windows: its own and the audience's.

import { runFile, runName } from "../core/compare.ts";
import type { Deck, LinkTarget } from "../core/deck.ts";
import { audienceButton, audienceReady, guideLine } from "../core/guide.ts";
import { actionFor, isTalkAction, type Action } from "../core/keys.ts";
import { mark, span } from "../core/pace.ts";
import { Talk, type Point, type Progress, type SavedSession } from "../core/talk.ts";
import * as T from "../core/timer.ts";
import type { Audience, Pdf, Platform } from "../platform.ts";
import { Comparison, compareLines } from "./compare.ts";
import { $, el, label, reportError, toast, wheelStepper } from "./dom.ts";
import { renderNote } from "./notes.ts";
import { PageCache } from "./page-cache.ts";
import { Settings } from "./settings.ts";
import { SlideView, Thumb } from "./slide-view.ts";
import { Spoken } from "./spoken.ts";
import { ticker } from "./ticker.ts";

/** A deck's files, as read. */
export interface Source {
  pdf: { name: string; data: ArrayBuffer };
  pdfpc?: { name: string; text: string };
}

/** A deck, opened: its files, the PDF engine's hold on it, and its slides. */
export interface Opened {
  source: Source;
  pdf: Pdf;
  deck: Deck;
}

export class Presenter {
  readonly talk: Talk;
  /** What the presenter has open over the slides. */
  private view = {
    overview: false,
    /** Slide selected in the overview. */
    selected: 0,
    help: false,
    /** Presenting in this window (single screen). */
    solo: false,
  };
  private cache: PageCache;
  private settings: Settings;
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
  /** The next slide's notes, as last shown. */
  private nextNote: string | null = null;
  private stripSlide = -1;
  /** The page of the thumbnail the mouse rests on, shown in the next slide's place. */
  private preview: number | null = null;
  private previewTimer = 0;
  private spoken = new Spoken();
  /** The other `.pdfpc` file the deck's plan is compared with, while it is. */
  private comparison: Comparison | null = null;
  /** On the next slide while comparing: says so, and a click ends it. */
  private compareBadge = el("button", "compare-badge", "Comparing ✕");
  /** When the run whose times were last saved started, so the guide stops asking. */
  private savedRun: number | null = null;

  constructor(
    private platform: Platform,
    private audience: Audience,
    readonly opened: Opened,
    saved: SavedSession | undefined,
    /** Save the place and the clock, for resuming after a reload. */
    readonly track: boolean,
  ) {
    const { deck, pdf } = opened;
    this.talk = new Talk(deck, saved, Date.now());
    this.cache = new PageCache(pdf);
    this.settings = new Settings(platform.store, deck, { pace: () => this.renderTimer(), dim: () => this.renderNotesDim() }, () => this.target);

    const first = deck.pages[0];
    document.documentElement.style.setProperty("--aspect", `${first.width} / ${first.height}`);
    document.title = `${deck.name} · pdfpcnic`;

    this.current = new SlideView($("current"), deck, this.cache, 1, { follow: this.follow, marked: true });
    this.current.onLayout = () => this.fitSlidebar();
    this.next = new SlideView($("next"), deck, this.cache, 2, { align: "start" });
    this.next.onLayout = () => this.fitLine($("talkbar"), this.next.canvas);
    this.compareBadge.type = "button";
    this.compareBadge.hidden = true;
    $("next").append(this.compareBadge);
    this.cache.onRender((page) => this.thumbs.get(page)?.forEach((t) => t.draw()));
    audience.bind(deck, pdf, this.cache);

    $("start").hidden = true;
    $("presenter").hidden = false;
    this.settings.apply();
    this.current.start();
    this.next.start();
    this.buildStrip();
    this.buildTalkbar();
    this.wire();
    this.stopTicking = ticker(() => this.tick());
    this.render();
  }

  get deck(): Deck {
    return this.talk.deck;
  }

  dispose(): void {
    this.abort.abort();
    this.stopTicking();
    clearTimeout(this.saveTimer);
    clearTimeout(this.previewTimer);
    this.observers.forEach((o) => o.disconnect());
    this.observers.clear();
    this.current.dispose();
    this.next.dispose();
    this.solo?.dispose();
    this.comparison?.dispose();
    this.cache.dispose();
    $("presenter").classList.remove("comparing");
    $("solo").hidden = true;
    $("overview").hidden = true;
    $("help").hidden = true;
  }

  // Input

  act(action: Action): void {
    if (action === "escape" && this.escape()) return;
    if (isTalkAction(action)) {
      const said = this.talk.act(action);
      if (said) toast(said);
      if (action === "endSlide") {
        this.buildStrip();
        this.buildTalkbar();
      }
      return this.render();
    }
    const v = this.view;
    switch (action) {
      case "overview":
        return this.setOverview(!v.overview);
      case "goto":
        return this.openGoto();
      case "bigger":
      case "smaller": {
        const f = action === "bigger" ? 1 : -1;
        if (this.talk.state.laser) this.settings.setLaserSize(this.settings.laserSize * (f > 0 ? 1.2 : 1 / 1.2));
        else this.settings.setNotesSize(this.settings.notesSize + 2 * f);
        return this.render();
      }
      case "fullscreen":
        this.platform.window.setFullscreen(!this.platform.window.fullscreen).catch(reportError);
        return;
      case "audienceFullscreen":
        if (this.audience.status.mode !== "closed") this.audience.toggleFullscreen();
        else this.setSolo(!v.solo);
        return;
      case "help":
        v.help = !v.help;
        return this.render();
      case "openAudience":
        try {
          this.audience.open();
        } catch (err) {
          reportError(err);
        }
        return;
      case "slideSmaller":
      case "slideBigger":
        this.settings.setStage(this.settings.stage + (action === "slideBigger" ? 0.05 : -0.05));
        toast(`Slides at ${Math.round(this.settings.stage * 100)}% of their columns.`, 1500);
        return;
      case "settings":
        return this.settings.open();
      case "timesOfDay":
        return this.settings.setTimeOfDay(!this.settings.timeOfDay);
      case "earlyLate":
        return this.settings.setEarlyLate(!this.settings.earlyLate);
      case "resetLayout":
        this.settings.resetLayout();
        toast("Equal columns, and the slides at full size.", 1500);
        return;
      case "saveRun":
        return void this.saveRun();
    }
  }

  /**
   * Esc steps back one thing at a time, the same in the browser and the app:
   * what's open over the slides (the help, the overview, presenting in this
   * window), then what the audience sees instead of the slide (black, freeze,
   * the laser: the talk ends those), then the presenter's fullscreen. Never the
   * audience's: the room's screen changes only with Shift+W, or a double-click on it.
   */
  private escape(): boolean {
    const v = this.view;
    const s = this.talk.state;
    if (v.help) {
      v.help = false;
      this.render();
    } else if (v.overview) this.setOverview(false);
    else if (v.solo) this.setSolo(false);
    else if (s.black || s.frozen !== null || s.laser || !this.platform.window.fullscreen) return false;
    else this.platform.window.setFullscreen(false).catch(reportError);
    return true;
  }

  onKey(e: KeyboardEvent): void {
    // Dialogs (go to, settings) keep their keys.
    if (e.target instanceof HTMLInputElement || document.querySelector("dialog[open]")) return;
    if (this.view.overview && this.overviewKey(e)) {
      e.preventDefault();
      return;
    }
    const action = actionFor(e);
    if (!action) return;
    e.preventDefault();
    this.act(action);
  }

  /** Follows a link on a slide, in this window or the audience's. */
  readonly follow = (to: LinkTarget) => {
    this.talk.follow(to);
    this.render();
  };

  /** Jumps to a page, from the thumbnails, the overview or a slide number. */
  private go(page: number): void {
    this.talk.go(page, true);
    this.render();
  }

  /** Laser position from the slide under the pointer here, as in Présentation.app: the audience window doesn't move it. */
  private pointAt(at: Point | null): void {
    if (this.talk.point(at)) this.renderLaser();
  }

  private wire(): void {
    const signal = this.abort.signal;
    const cur = this.current.root;
    cur.addEventListener("pointermove", (e) => this.pointAt(this.current.toPage(e.clientX, e.clientY)), { signal });
    cur.addEventListener("pointerleave", () => this.pointAt(null), { signal });
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
    this.compareBadge.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        this.compareWith(null);
      },
      { signal },
    );
    // The thumbnails come in once the mouse rests within 64 px of the right
    // edge, and go once it has left them. Watched from the mouse's position, so
    // nothing over the edge takes the clicks meant for what's under it.
    const strip = $("strip");
    let stripTimer = 0;
    const stripLater = (open: boolean) => {
      clearTimeout(stripTimer);
      stripTimer = window.setTimeout(() => ((stripTimer = 0), strip.classList.toggle("open", open)), 300);
    };
    const stay = () => (clearTimeout(stripTimer), (stripTimer = 0));
    window.addEventListener(
      "mousemove",
      (e) => {
        if (strip.classList.contains("open")) return;
        if (e.clientX < innerWidth - 64) stay();
        else if (!stripTimer) stripLater(true);
      },
      { signal },
    );
    // Out of the window, to the projector's screen say.
    document.addEventListener("mouseout", (e) => e.relatedTarget || strip.classList.contains("open") || stay(), { signal });
    strip.addEventListener("mouseenter", stay, { signal });
    strip.addEventListener("mouseleave", () => (stripLater(false), this.showPreview(null)), { signal });
    $("timer").addEventListener("click", () => this.act("timerPause"), { signal });
    const toggle = $("timer-toggle");
    toggle.addEventListener(
      "click",
      () => {
        toggle.blur();
        this.act(this.talk.state.timer.startedAt === null ? "timerStart" : "timerPause");
      },
      { signal },
    );
    const reset = $("timer-reset");
    reset.addEventListener(
      "click",
      () => {
        reset.blur();
        // Running, it takes a second click, so a stray one can't wipe the talk's time.
        if (this.talk.state.timer.pausedAt === null && !this.resetArmed) {
          this.resetArmed = window.setTimeout(() => {
            this.resetArmed = 0;
            this.renderTimer();
          }, 3000);
          this.renderTimer();
          return;
        }
        clearTimeout(this.resetArmed);
        this.resetArmed = 0;
        if (this.talk.state.timer.pausedAt === null) this.talk.act("timerPause");
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
    this.settings.wire(signal);

    const win = this.platform.window;
    win.onChange(() => {
      if (this.view.solo && !win.fullscreen) this.setSolo(false);
      else this.render();
    }, signal);
  }

  // Drawing

  render(): void {
    const t = this.talk;
    const s = t.state;
    const d = this.deck;
    const here = d.pages[s.page];
    const room = t.audience;

    this.current.show(s.page);
    const next = t.nextPage();
    const shown = this.preview ?? next;
    this.next.show(shown);
    $("next").classList.toggle("empty", shown === null);
    $("next").classList.toggle("backup", shown !== null && d.pages[shown].slide > s.endSlide);

    this.solo?.show(room.page);
    this.renderLaser();

    if (this.notesPage !== s.page) {
      this.notesPage = s.page;
      const body = $("notes-body");
      if (here.note) renderNote(body, here.note, d.markdown);
      else body.replaceChildren(el("p", "empty", "No notes for this slide."));
      $("notes").scrollTop = 0;
      this.spoken.index(body);
    }
    // Under the next slide, its notes: nothing when they're this slide's again, a reveal step's say. While
    // comparing, the other file's note for this slide.
    if (this.comparison) this.comparison.renderNotes(s.page, d.markdown);
    else {
      const nextNote = next === null || d.pages[next].note === here.note ? "" : d.pages[next].note;
      if (this.nextNote !== nextNote) {
        this.nextNote = nextNote;
        renderNote($("next-notes-body"), nextNote, d.markdown);
        $("next-notes").scrollTop = 0;
      }
    }

    if (this.stripSlide !== here.slide) {
      this.stripItems[this.stripSlide]?.classList.remove("current");
      this.stripSlide = here.slide;
      const item = this.stripItems[here.slide];
      item?.classList.add("current");
      item?.scrollIntoView({ block: "center", behavior: "smooth" });
    }

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

    // The audience's next step: on its button at the foot of the column,
    // standing out until the audience sees the slides (and in the guide's line,
    // drawn with the clock).
    const status = this.audience.status;
    const button = audienceButton(status);
    const ab = $("audience-button");
    ab.dataset.action = button.action;
    ab.classList.toggle("cta", !audienceReady(status, this.view.solo));
    label(ab, button.label, button.key);

    const on: Partial<Record<Action, boolean>> = {
      laserMode: s.laser,
      blank: s.black,
      freeze: s.frozen !== null,
      overview: this.view.overview,
      audienceFullscreen: status.mode === "fullscreen",
      fullscreen: this.platform.window.fullscreen,
      help: this.view.help,
    };
    for (const b of document.querySelectorAll<HTMLElement>("#presenter [data-action]")) {
      b.classList.toggle("on", !!on[b.dataset.action as Action]);
    }
    $("help").hidden = !this.view.help;
    this.current.root.classList.toggle("laser-on", s.laser);

    // Keep what is on screen, and render the pages around it ahead of time.
    this.cache.pinned = new Set([s.page, room.page, ...(shown === null ? [] : [shown])]);
    const width = Math.max(this.audience.pixelWidth, this.current.pixelWidth, this.solo?.pixelWidth ?? 0);
    const prev = t.slideFrom(here.slide, -1);
    const step = d.pages.findIndex((_, i) => i > s.page && t.visible(i));
    // Right away: the next step, the next slide, and what the next slide's place shows after the next step (the
    // slide after that one, once the step leaves this slide). When idle: going back (where the next slide's place
    // shows this slide's last step), and further ahead.
    const after = step < 0 ? null : t.nextPage(step);
    this.cache.prefetch(
      [s.page + 1, ...[next, after].filter((p) => p !== null)],
      [s.page - 1, ...(prev === null ? [] : [t.firstOf(prev)]), t.lastOf(here.slide), s.page + 2, s.page + 3],
      width,
    );

    this.renderTimer();
    this.save();
  }

  private renderLaser(): void {
    const s = this.talk.state;
    const room = this.talk.audience;
    const size = this.settings.laserSize;
    this.current.setLaser(s.laser ? s.laserAt : null, size);
    this.audience.render(room.page, room.black, room.laser, size);
    this.solo?.setLaser(room.laser, size);
  }

  // The clock and the pace

  /** What the clock and pace show turn over with: the second of the talk (before it starts, of the day) and the minute. */
  private beatAt(now: number): string {
    const t = this.talk.state.timer;
    const second = Math.floor((t.startedAt === null ? now : T.elapsed(t, now)) / 1000);
    return `${second}:${Math.floor(now / 60_000)}`;
  }
  private beat = "";
  /** Set while Reset waits for its second click. */
  private resetArmed = 0;
  /** The talk's target length in seconds, as last drawn; settings show the levels against it. */
  private target = 0;

  /** The ticker's beat: redraws once a shown number turns over, not on every beat. Returns when to beat again. */
  private tick(): number {
    const now = Date.now();
    if (this.beatAt(now) !== this.beat) this.renderTimer();
    // In between, this slide's line and the notes move on, each redrawn only once it has changed.
    else if (this.talk.budget !== null) {
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

  /** Présentation.app's clock: time since the start. */
  private renderClock(now: number): void {
    const t = this.talk.state.timer;
    const timer = $("timer");
    timer.textContent = this.settings.timeOfDay ? T.formatClock(now) : T.format(T.elapsed(t, now));
    timer.classList.toggle("idle", t.startedAt === null);
    timer.classList.toggle("paused", t.pausedAt !== null);
    const stale = this.talk.stale;
    // The button by the clock says what it does next: start, pause, resume.
    // What to press next stands out: Start before the talk, Reset while paused
    // or after a rehearsal. One at a time, and the audience's steps come first.
    const ours = audienceReady(this.audience.status, this.view.solo);
    const toggle = $("timer-toggle");
    const running = t.startedAt !== null && t.pausedAt === null;
    if (t.startedAt === null) {
      label(toggle, "Start", "s");
      const until = T.untilStart(this.deck, now);
      toggle.title = until
        ? `The talk starts at ${this.deck.startTime}, in ${T.format(until)}.`
        : `Starts the clock. It also starts ${this.talk.state.page === 0 ? "when you leave slide 1" : "at your next move"}.`;
    } else {
      label(toggle, running ? "Pause" : "Resume", "p");
      toggle.title = "";
    }
    toggle.classList.toggle("cta", ours && t.startedAt === null && !stale);
    const reset = $<HTMLButtonElement>("timer-reset");
    reset.title = running ? "While the clock runs, click twice." : "";
    reset.disabled = t.startedAt === null;
    reset.classList.toggle("cta", ours && (stale || t.pausedAt !== null) && !this.resetArmed);
    reset.classList.toggle("confirm", !!this.resetArmed);
    label(reset, this.resetArmed ? "Click again to reset" : "Reset", "⇧R");
    this.renderGuide(now);
  }

  /** The guide's line over the buttons: what to do next, or a hint or a fact, colored by which (core/guide.ts). */
  private renderGuide(now: number): void {
    const s = this.talk.state;
    const until = T.untilStart(this.deck, now);
    const line = guideLine({
      audience: this.audience.status,
      solo: this.view.solo,
      oneScreen: this.platform.window.extended === false,
      system: this.platform.window.system,
      clock: s.timer.startedAt === null ? "idle" : s.timer.pausedAt === null ? "running" : "paused",
      stale: this.talk.stale,
      startsAt: until ? { time: this.deck.startTime!, in: T.format(until) } : null,
      laser: s.laser,
      lastPlanned: this.talk.slide === s.endSlide && s.endSlide < this.deck.slides.length - 1,
      finished: this.talk.finished && this.savedRun !== s.timer.startedAt,
      comparing: this.comparison?.name ?? null,
    });
    const p = $("guide");
    p.className = `guide ${line?.kind ?? ""}${line?.action ? " act" : ""}`;
    p.replaceChildren(...(line?.fact ? [el("span", "fact", `${line.fact} · `)] : []), line?.text ?? "");
    p.title = line ? `${line.fact ? `${line.fact} · ` : ""}${line.text}` : "";
    const action = line?.action;
    p.onclick = action ? () => this.act(action) : null;
  }

  /** The talk bar's scale, as last laid out. */
  private barScale = 0;

  /** The talk bar's parts, back to front. */
  private buildTalkbar(): void {
    $("talkbar").replaceChildren(el("div", "past"), el("div", "projected"), el("div", "spent"), el("div", "window"), el("div", "target"), compareLines(true));
    this.barScale = 0;
  }

  /** Dims the part of the note you'd have said by now. */
  private renderNotesDim(now = Date.now()): void {
    this.spoken.show(this.settings.notesDim > 0 && !this.comparison ? this.talk.used(now) : null);
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
    const px = Math.round((this.talk.used(now) ?? 0) * width);
    if (px === this.fillAt) return;
    this.fillAt = px;
    $("slide-fill").style.transform = `scaleX(${px / width})`;
  }

  /** How soon to look again: when the line is due to move a pixel or the notes a character, at most 25 times a second; 4 times otherwise. */
  private beatMs = 250;

  /** Lays a line exactly along a slide's foot, as wide: the slide is drawn in whole pixels, its box isn't. Returns its width. */
  private fitLine(bar: HTMLElement, canvas: HTMLCanvasElement): number {
    const c = canvas.getBoundingClientRect();
    if (!c.width || bar.hidden) return 0;
    bar.style.width = `${c.width}px`;
    bar.style.left = bar.style.top = "0px";
    const b = bar.getBoundingClientRect();
    bar.style.left = `${c.left - b.left}px`;
    bar.style.top = `${c.bottom - b.top}px`;
    return c.width;
  }

  /** This slide's line, along the current slide's foot. */
  private fitSlidebar(): void {
    const width = this.fitLine($("pace-slide"), this.current.canvas);
    if (!width) return;
    this.fillPixels = width * devicePixelRatio;
    this.fillAt = -1;
  }

  private renderPace(now: number): void {
    if (this.comparison) {
      this.comparison.renderTimes(this.talk.slide, this.talk.state.endSlide);
      this.beatMs = 250;
      return;
    }
    const p = this.talk.progress(now, this.settings.slack);
    for (const id of ["pace-slide", "finish", "talkbar", "target-at"]) $(id).hidden = !p.planned;
    if (!p.planned) {
      this.beatMs = 250;
      return;
    }
    this.target = p.target;

    // This slide, in the line under it. A slide planned to take no time has
    // no line (the row keeps its place, so the notes don't jump).
    const own = p.slide;
    $("pace-slide").classList.toggle("none", !own);
    if (own) {
      $("slide-fill").className = `slide-fill t-${own.tone}`;
      $("pace-slide").title = own.plan
        ? `This slide: planned ${mark(own.plan.start)}–${mark(own.plan.end)}, ${span(own.budget)}`
        : `This slide: ${span(own.budget)}, off the talk's plan`;
    }
    this.renderFill(now);
    const budget = this.talk.budget;
    const moving = budget !== null && this.talk.state.timer.pausedAt === null && (this.talk.used(now) ?? 1) < 1;
    this.beatMs = moving ? Math.min(250, Math.max(40, (budget * 1000) / Math.max(1, this.fillPixels, this.spoken.total))) : 250;

    // The whole talk: a red line at the target end, time spent colored by the
    // pace and going on lighter to where the talk would end, this slide's
    // planned part over them.
    const bar = $("talkbar");
    const x = (t: number) => `${((Math.min(Math.max(t, 0), p.scale) / p.scale) * 100).toFixed(3)}%`;
    if (p.scale !== this.barScale) {
      this.barScale = p.scale;
      for (const part of [".target", ".past"]) bar.querySelector<HTMLElement>(part)!.style.left = x(p.target);
    }
    const tone = `t-${p.started ? p.tone : "on"}`;
    const spent = bar.querySelector<HTMLElement>(".spent")!;
    spent.style.width = x(p.at);
    spent.className = `spent ${tone}`;
    const projected = bar.querySelector<HTMLElement>(".projected")!;
    projected.style.width = x(p.finish);
    projected.className = `projected ${tone}`;
    const mine = p.segments.find((s) => s.slide === this.talk.slide);
    const slot = bar.querySelector<HTMLElement>(".window")!;
    slot.hidden = !mine;
    if (mine) {
      slot.style.left = x(mine.start);
      slot.style.width = `calc(${x(mine.end)} - ${x(mine.start)})`;
    }
    // Where the talk would end, or how early or late, at the clock's right, under the target end.
    $("target-at").textContent = this.when(p.target, p, now);
    // A little early is simply on time.
    const pace = p.late > 0 ? `${span(p.late)} late` : p.tone === "early" ? `${span(p.late)} early` : "on time";
    const plan = `Planned to end at ${mark(p.planned)}; target ${mark(p.target)}.`;
    const finish = $("finish");
    finish.className = `finish ${tone}`;
    if (this.settings.earlyLate) {
      finish.textContent = pace;
      finish.title = `How early or late the talk would end at this pace. ${plan} Click (e) for where it would end.`;
    } else {
      finish.textContent = this.when(p.finish, p, now);
      finish.title = `Where the talk would end at this pace: ${pace}. ${plan} Click (e) for how early or late.`;
    }
  }

  /**
   * A time in the talk (where it would end, the target end), on the clock, or
   * as a time of day. As a time of day it runs on from now, so a pause moves it later.
   */
  private when(t: number, p: Progress, now: number): string {
    if (!this.settings.timeOfDay) return T.formatShort(t * 1000);
    const started = this.talk.state.timer.startedAt;
    // Before the clock starts: from the talk's start time if it has one ahead, else from now.
    return T.formatClock(started === null ? now + T.untilStart(this.deck, now) + t * 1000 : now + (t - p.at) * 1000);
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

  /**
   * Lists the slides, as the strip and the overview show them: each from
   * `item`, with a divider where a section of the PDF's outline starts and
   * where the backup slides do.
   */
  private listSlides(list: HTMLElement, item: (slide: number) => HTMLElement): void {
    const sections = new Map(this.deck.sections.map((s) => [s.slide, s.title]));
    list.replaceChildren();
    this.deck.slides.forEach((_, slide) => {
      if (slide === this.talk.state.endSlide + 1) list.append(el("li", "divider", "Backup"));
      const section = sections.get(slide);
      if (section) list.append(el("li", "divider section", section));
      list.append(item(slide));
    });
  }

  private buildStrip(): void {
    const t = this.talk;
    const strip = $("strip");
    strip.style.setProperty("--digits", `${String(this.deck.slides.length).length}ch`);
    const items: Array<[HTMLElement, Thumb]> = [];
    this.stripItems = [];
    this.stripSlide = -1;
    this.listSlides(strip, (slide) => {
      const li = el("li");
      li.classList.toggle("hidden", !t.slideVisible(slide));
      const thumb = this.thumb(t.lastOf(slide));
      li.append(el("span", "num", String(slide + 1)), thumb.canvas);
      li.addEventListener("mouseenter", () => this.showPreview(t.lastOf(slide)));
      li.addEventListener("click", () => (this.showPreview(null), this.go(t.firstOf(slide))));
      this.stripItems[slide] = li;
      items.push([li, thumb]);
      return li;
    });
    this.lazy(strip, items);
  }

  /**
   * Shows a thumbnail's slide in the next slide's place, large enough to read,
   * once the mouse has rested on it a moment (so sweeping down the strip
   * doesn't draw every slide on the way); `null` puts the next slide back.
   */
  private showPreview(page: number | null): void {
    clearTimeout(this.previewTimer);
    if (page !== null) {
      this.previewTimer = window.setTimeout(() => {
        this.preview = page;
        this.render();
      }, 100);
    } else if (this.preview !== null) {
      this.preview = null;
      this.render();
    }
  }

  private setOverview(open: boolean): void {
    this.view.overview = open;
    $("overview").hidden = !open;
    if (open) {
      this.view.selected = this.talk.slide;
      this.buildOverview();
    }
    this.render();
  }

  private buildOverview(): void {
    const t = this.talk;
    const grid = $("overview-grid");
    const items: Array<[HTMLElement, Thumb]> = [];
    this.overviewItems = [];
    this.listSlides(grid, (slide) => {
      const pages = this.deck.slides[slide];
      const li = el("li");
      li.classList.toggle("hidden", !t.slideVisible(slide));
      li.classList.toggle("current", slide === t.slide);
      const thumb = this.thumb(t.lastOf(slide));
      const cap = el("div", "cap");
      cap.append(
        el("span", "", String(slide + 1)),
        el("span", "", [pages.length > 1 ? `${pages.length} steps` : "", t.slideVisible(slide) ? "" : "hidden"].filter(Boolean).join(" · ")),
      );
      li.append(thumb.canvas, cap);
      li.addEventListener("click", () => this.pick(slide));
      this.overviewItems[slide] = li;
      items.push([li, thumb]);
      return li;
    });
    this.lazy($("overview"), items);
    this.select(this.view.selected);
  }

  private select(slide: number): void {
    const v = this.view;
    this.overviewItems[v.selected]?.classList.remove("selected");
    v.selected = Math.max(0, Math.min(this.deck.slides.length - 1, slide));
    const item = this.overviewItems[v.selected];
    item?.classList.add("selected");
    item?.scrollIntoView({ block: "nearest" });
  }

  private pick(slide: number): void {
    this.setOverview(false);
    this.go(this.talk.firstOf(slide));
  }

  private overviewKey(e: KeyboardEvent): boolean {
    const v = this.view;
    const items = this.overviewItems;
    const top = items[0]?.offsetTop;
    const columns = Math.max(1, items.filter((i) => i.offsetTop === top).length);
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    if (e.key in moves && !e.shiftKey) {
      this.select(v.selected + moves[e.key]);
      return true;
    }
    if (e.key === "Enter") {
      this.pick(v.selected);
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
      if (submitted && n >= 1 && n <= this.deck.slides.length) this.go(this.talk.firstOf(n - 1));
    };
    dialog.showModal();
  }

  /** Presents in this window, for a single screen: the slide fills it, fullscreen. */
  private setSolo(on: boolean): void {
    this.view.solo = on;
    const host = $("solo");
    host.hidden = !on;
    if (on) {
      this.solo = new SlideView(host, this.deck, this.cache, 0, { follow: this.follow });
      this.solo.start();
      host.onpointermove = (e) => this.pointAt(this.solo?.toPage(e.clientX, e.clientY) ?? null);
      host.onclick = () => this.act("next");
      this.platform.window.setFullscreen(true).catch(() => {});
    } else {
      this.solo?.dispose();
      this.solo = null;
      host.replaceChildren();
      this.platform.window.setFullscreen(false).catch(() => {});
    }
    this.render();
  }

  /** The other `.pdfpc` file the deck's plan is compared with, or null. */
  get comparing(): { name: string; text: string } | null {
    return this.comparison?.file ?? null;
  }

  /**
   * Compares the deck's plan with another `.pdfpc` file (ui/compare.ts), or
   * stops. Meanwhile, moving through the slides doesn't start the clock.
   */
  compareWith(other: { name: string; text: string } | null): void {
    const was = this.comparison;
    // Parsed first: a file that isn't a .pdfpc changes nothing.
    this.comparison = other && new Comparison(this.deck, this.opened.source.pdfpc?.name ?? "the deck", other);
    was?.dispose();
    this.talk.review = !!other;
    $("presenter").classList.toggle("comparing", !!other);
    this.compareBadge.hidden = !other;
    this.compareBadge.title = other ? `Comparing with ${other.name}. Click to end the comparison.` : "";
    this.nextNote = null;
    this.render();
  }

  /** Saves the run's times as a `.pdfpc` file of timing lines, to compare with the plan (core/compare.ts). */
  private async saveRun(): Promise<void> {
    const t = this.talk;
    const started = t.state.timer.startedAt;
    if (started === null) return toast("No run to save yet: the clock hasn't started.");
    const now = Date.now();
    const name = runName(this.deck.name, new Date(now));
    try {
      const where = await this.platform.save(name, runFile(this.deck, t.state.endSlide, t.spentBySlide(now)), this.deck.name);
      this.savedRun = started;
      toast(`${where ? `Saved ${where}` : `Downloaded ${name}`}. Drop it on this window to compare it with the plan.`, 8000);
      this.renderGuide(now);
    } catch (err) {
      reportError(err);
    }
  }

  private save(): void {
    if (!this.track) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.platform.store.saveSession(this.talk.save(Date.now())), 300);
  }
}
