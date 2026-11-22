// The presenter page: Présentation.app's layout, drawn from the talk
// (core/talk.ts). It turns keys and clicks into the talk's actions, and runs
// the platform's windows: its own and the audience's.

import { runFile, runName } from "../core/compare.ts";
import type { Deck, LinkTarget } from "../core/deck.ts";
import { audienceReady, guideLine } from "../core/guide.ts";
import { actionFor, isIgnored, isTalkAction, type Action } from "../core/keys.ts";
import { mark, span } from "../core/pace.ts";
import { Talk, type Point, type SavedSession } from "../core/talk.ts";
import * as T from "../core/timer.ts";
import type { Audience, Pdf, Platform } from "../platform.ts";
import { Comparison } from "./compare.ts";
import { $, el, label, renderInline, reportError, steadyLabel, toast, wheelStepper } from "./dom.ts";
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
  private focusBeforeOverlay: HTMLElement | null = null;
  /** Each thumbnail's slide line, by slide, shown while comparing. */
  private thumbLines: { strip: HTMLElement[]; overview: HTMLElement[] } = { strip: [], overview: [] };
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
  /** Where the mouse last was over the thumbnails, and the thumbnail it marks there. */
  private stripMouse = { x: -1, y: -1 };
  private stripHover: HTMLElement | null = null;
  private spoken = new Spoken();
  /** The other `.pdfpc` file the deck's plan is compared with, while it is. */
  private comparison: Comparison | null = null;
  /** When the run whose times were last saved started, so the guide stops asking. */
  private savedRun: number | null = null;
  /** Which existing control reopens the audience after it closes. */
  private reconnectAction: "prepareProjector" | "prepareSharing" = "prepareProjector";

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

    const states = $("slide-states");
    this.current = new SlideView($("current"), deck, this.cache, 1, { follow: this.follow, marked: true });
    this.current.root.append(states);
    this.current.onLayout = () => this.fitSlidebar();
    this.next = new SlideView($("next"), deck, this.cache, 2, { align: "start" });
    this.next.onLayout = () => this.fitLine($("talkbar"), this.next.canvas);
    this.cache.onRender((page) => this.thumbs.get(page)?.forEach((t) => t.draw()));
    audience.bind(deck, pdf, this.cache, { ...this.talk.audience, laserSize: this.settings.laserSize });

    $("start").hidden = true;
    $("presenter").hidden = false;
    $("presenter").focus({ preventScroll: true });
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
    if (this.view.help || this.view.overview) this.restoreOverlayFocus();
  }

  // Input

  act(action: Action): void {
    if (action === "escape" && this.escape()) return;
    // Comparing, the clock stands still, and its keys leave it as it is.
    if (this.comparison && (action === "timerStart" || action === "timerPause" || action === "timerReset")) return;
    if (isTalkAction(action)) {
      const said = this.talk.act(action);
      if (said) {
        if (action === "timerReset" && this.talk.state.timer.startedAt !== null) {
          toast(
            ["The clock is running. Pause it first with ", { button: "Pause" }, " ", { key: "p" }, ", then reset, or click ", { button: "Reset" }, " twice."],
            { tone: "warn" },
          );
        } else if (action === "bookmark") {
          toast([`Bookmarked slide ${this.talk.slide + 1}. `, { key: "⇧M" }, " returns here."]);
        } else {
          toast(said, action === "timerReset" ? 2500 : 4500);
        }
      }
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
        return this.setHelp(!v.help);
      case "openAudience":
        try {
          this.audience.open();
        } catch (err) {
          reportError(err);
        }
        return;
      case "prepareProjector":
        try {
          this.audience.open();
          if (this.audience.status.mode !== "fullscreen") this.audience.toggleFullscreen();
        } catch (err) {
          reportError(err);
        }
        return;
      case "prepareSharing":
        void this.audience.prepareSharing?.().then(() => {
          if (__BUILD__ !== "mac") {
            toast("If the audience window stayed small, use Window → Fill or maximize it manually.", 6000);
          }
        }).catch(reportError);
        return;
      case "slideSmaller":
      case "slideBigger":
        this.settings.setStage(this.settings.stage + (action === "slideBigger" ? 0.05 : -0.05));
        toast(`Slides at ${Math.round(this.settings.stage * 100)}% of their columns.`, 1500);
        return;
      case "settings":
        if (v.help) this.setHelp(false);
        if (v.overview) this.setOverview(false);
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
      case "endCompare":
        return this.compareWith(null);
    }
  }

  /**
   * Esc steps back one thing at a time, the same in the browser and the app:
   * what's open over the slides (the help, the overview, presenting in this
   * window), then what the audience sees instead of the slide (black, freeze,
   * the laser: the talk ends those), then the audience's fullscreen on one
   * screen, where it covers the presenter, then the presenter's. With a
   * projector, never the audience's: the room's screen changes only with
   * Shift+W, or a double-click on it.
   */
  private escape(): boolean {
    const v = this.view;
    const s = this.talk.state;
    if (v.help) this.setHelp(false);
    else if (v.overview) this.setOverview(false);
    else if (v.solo) this.setSolo(false);
    else if (s.black || s.frozen !== null || s.laser) return false;
    else if (this.audience.status.mode === "fullscreen" && this.platform.window.extended === false) this.audience.toggleFullscreen();
    else if (this.platform.window.fullscreen) this.platform.window.setFullscreen(false).catch(reportError);
    else return false;
    return true;
  }

  onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.isComposing) return;
    if (isIgnored(e)) {
      e.preventDefault();
      return;
    }
    // The audience can forward events from another window, whose HTMLElement type is different.
    const target = e.target as HTMLElement | null;
    if (target?.matches?.("input, textarea, select") || target?.isContentEditable || document.querySelector("dialog[open]")) return;
    const action = actionFor(e);
    if (!action) return;
    if ((e.key === "Enter" || e.key === " ") && target?.closest?.("button, a[href], summary")) return;
    if (this.view.help || this.view.overview) {
      if (this.view.overview && this.overviewKey(e)) {
        e.preventDefault();
        return;
      }
      if (action !== "help" && action !== "overview" && action !== "escape" && action !== "settings") return;
    }
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
    // A slide can stay up longer than a borrowed laptop's display stays on.
    this.platform.window.keepAwake(signal);
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
    // The thumbnails come in once the mouse rests within 64 px of the right
    // edge, and go the moment it leaves them. Watched from the mouse's position,
    // so nothing over the edge takes the clicks meant for what's under it.
    const strip = $("strip");
    let stripTimer = 0;
    const stay = () => (clearTimeout(stripTimer), (stripTimer = 0));
    window.addEventListener(
      "mousemove",
      (e) => {
        if (strip.classList.contains("open")) return;
        if (e.clientX < innerWidth - 64 || (e.target instanceof Element && e.target.closest("button"))) stay();
        else if (!stripTimer) stripTimer = window.setTimeout(() => ((stripTimer = 0), strip.classList.add("open")), 300);
      },
      { signal },
    );
    // Out of the window, to the projector's screen say.
    document.addEventListener("mouseout", (e) => e.relatedTarget || strip.classList.contains("open") || stay(), { signal });
    const mouse = (x: number, y: number) => {
      this.stripMouse = { x, y };
      this.hoverStrip();
    };
    for (const type of ["mouseover", "mousemove"] as const) {
      strip.addEventListener(type, (e) => mouse(e.clientX, e.clientY), { signal });
    }
    strip.addEventListener("scroll", () => this.hoverStrip(), { signal, passive: true });
    strip.addEventListener(
      "mouseleave",
      () => {
        strip.classList.remove("open");
        mouse(-1, -1);
        this.showPreview(null);
      },
      { signal },
    );
    const toggle = $("timer-toggle");
    toggle.addEventListener(
      "click",
      (e) => {
        if (e.detail) toggle.blur();
        this.act(this.talk.state.timer.startedAt === null ? "timerStart" : "timerPause");
      },
      { signal },
    );
    const reset = $("timer-reset");
    reset.addEventListener(
      "click",
      (e) => {
        if (e.detail) reset.blur();
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

    for (const b of document.querySelectorAll<HTMLButtonElement>("#presenter [data-action], #help [data-action], #overview [data-action]")) {
      b.addEventListener(
        "click",
        (e) => {
          const action = b.dataset.action as Action;
          if (e.detail && action !== "help" && action !== "overview") b.blur();
          this.act(action);
        },
        { signal },
      );
    }
    $("help").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) this.setHelp(false);
    }, { signal });
    const goto = $<HTMLDialogElement>("goto");
    goto.addEventListener("click", (e) => e.target === goto && goto.close(), { signal });
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
    const slideNum = here.slide + 1;
    const totalPlanned = s.endSlide + 1;
    const totalSlides = d.slides.length;
    const steps = d.slides[here.slide];
    const stepNum = steps.length > 1 ? steps.indexOf(s.page) + 1 : 0;
    const backup = here.slide > s.endSlide;
    const counterKey = `${slideNum}/${backup ? totalSlides : totalPlanned}/${stepNum}/${steps.length}/${backup}`;
    const counter = $("slide-counter");
    if (counter.dataset.key !== counterKey) {
      counter.dataset.key = counterKey;
      const num = el("span", "slide-num");
      num.append(el("span", "slide-cur", String(slideNum)), `/${backup ? totalSlides : totalPlanned}`);
      const parts: Array<Node | string> = [num];
      if (stepNum) {
        if (steps.length <= 6) {
          const dots = el("span", "step-dots");
          dots.setAttribute("aria-label", `step ${stepNum} of ${steps.length}`);
          for (let i = 1; i <= steps.length; i++) dots.append(el("i", i <= stepNum ? "step-dot done" : "step-dot"));
          parts.push(dots);
        } else {
          parts.push(el("span", "step-text", `step ${stepNum}/${steps.length}`));
        }
      }
      if (backup) parts.push(el("span", "backup-tag", "backup"));
      counter.replaceChildren(...parts);
      counter.title = backup
        ? `Backup slide ${slideNum - totalPlanned} of ${totalSlides - totalPlanned} (slide ${slideNum} of ${totalSlides})`
        : totalPlanned < totalSlides
          ? `Slide ${slideNum} of ${totalPlanned} planned (${totalSlides} total)`
          : `Slide ${slideNum} of ${totalSlides}`;
    }
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
      else {
        body.replaceChildren(
          el(
            "p",
            "empty",
            this.opened.source.pdfpc
              ? "No notes for this slide."
              : "No notes for this slide. Drop a .pdfpc file on this window any time to add notes and timing.",
          ),
        );
      }
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
    card.querySelector("strong")!.textContent = s.black ? "Screen black" : `Frozen on slide ${frozen! + 1}`;
    const audienceHint = card.querySelector("span")!;
    if (s.black) {
      audienceHint.replaceChildren(
        ...renderInline(["Click ", { button: "Black" }, " ", { key: "b" }, ` for slide ${(frozen ?? here.slide) + 1}${frozen === null ? "" : " (frozen)"}`]),
      );
    } else if (frozen === here.slide) {
      audienceHint.replaceChildren(...renderInline(["Click ", { button: "Freeze" }, " ", { key: "f" }, " to unfreeze"]));
    } else {
      audienceHint.replaceChildren(...renderInline(["Click ", { button: "Freeze" }, " ", { key: "f" }, ` for slide ${here.slide + 1}`]));
    }

    const status = this.audience.status;
    if (status.mode === "fullscreen") this.reconnectAction = "prepareProjector";
    else if (status.forSharing) this.reconnectAction = "prepareSharing";
    $("sharing-controls").hidden = !this.audience.prepareSharing;

    const on: Partial<Record<Action, boolean>> = {
      laserMode: s.laser,
      blank: s.black,
      freeze: s.frozen !== null,
      overview: this.view.overview,
      prepareProjector: status.mode === "fullscreen",
      prepareSharing: status.mode === "window" && status.forSharing,
      fullscreen: this.platform.window.fullscreen,
      help: this.view.help,
    };
    for (const b of document.querySelectorAll<HTMLElement>("#presenter [data-action]")) {
      const active = !!on[b.dataset.action as Action];
      b.classList.toggle("on", active);
      if (b.dataset.action === "prepareProjector" || b.dataset.action === "prepareSharing") {
        const closed = status.mode === "closed" && !this.view.solo && b.dataset.action === this.reconnectAction;
        b.classList.toggle("audience-closed", closed);
        if (b.dataset.action === "prepareProjector") {
          const canShortcut = status.remote && status.mode !== "closed";
          label(b, "Projector", canShortcut ? "⇧W" : "");
          b.title = closed
            ? "The audience window is closed. Click to reopen it."
            : canShortcut
              ? "Show the audience window fullscreen on a projector or second display (⇧W toggles fullscreen)."
              : status.remote
                ? "Open the audience window and show it fullscreen on a projector or second display."
                : "Focus the audience window; double-click it for fullscreen.";
        } else {
          b.title = closed
            ? "The audience window is closed. Click to reopen it."
            : "Resize the audience window for screen sharing in a meeting app (⇧O).";
        }
        b.setAttribute("aria-pressed", String(active));
      }
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
    this.audience.render({ ...room, laserSize: size });
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
    else if (this.talk.budget !== null && !this.comparison) {
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
    timer.title = this.settings.timeOfDay ? "The time of day. Click (t) for the talk's clock." : "The talk's clock. Click (t) for the time of day.";
    timer.classList.toggle("idle", t.startedAt === null);
    timer.classList.toggle("paused", t.pausedAt !== null);
    const stale = this.talk.stale;
    // The button by the clock says what it does next: start, pause, resume.
    // Start and Resume stand out; Reset is offered after a running rehearsal.
    const ours = audienceReady(this.audience.status, this.view.solo);
    const toggle = $<HTMLButtonElement>("timer-toggle");
    const running = t.startedAt !== null && t.pausedAt === null;
    // Start, Pause or Resume, the button as wide as the widest, so Reset beside it stays put.
    steadyLabel(toggle, [["Start", "s"], ["Pause", "p"], ["Resume", "p"]], t.startedAt === null ? 0 : running ? 1 : 2);
    if (t.startedAt === null) {
      const until = T.untilStart(this.deck, now);
      toggle.title = until
        ? `The talk starts at ${T.formatClock(now + until)}, in ${T.format(until)}.`
        : "Start the clock (s).";
    } else toggle.title = "";
    const comparing = !!this.comparison;
    const card = $("timer-state");
    const waiting = t.startedAt === null;
    const heading = waiting ? "Clock not started" : "Clock paused";
    const hintKey = waiting ? "start" : "resume";
    if (card.querySelector("strong")!.textContent !== heading) card.querySelector("strong")!.textContent = heading;
    if (card.dataset.hint !== hintKey) {
      card.dataset.hint = hintKey;
      const hint = card.querySelector("span")!;
      hint.replaceChildren(...renderInline(["Click ", { button: waiting ? "Start" : "Resume" }, " ", { key: waiting ? "s" : "p" }]));
    }
    card.title = waiting ? "Click Start or press s." : "Click Resume or press p.";
    card.hidden = running || comparing;
    toggle.disabled = comparing;
    toggle.classList.toggle("cta", !running && !comparing);
    const reset = $<HTMLButtonElement>("timer-reset");
    reset.title = running ? "While the clock runs, click twice." : "";
    reset.disabled = t.startedAt === null || comparing;
    reset.classList.toggle("cta", ours && stale && running && !this.resetArmed && !comparing);
    // Save run appears at the end of the plan. The same button ends a comparison on any slide.
    const save = $<HTMLButtonElement>("save-run");
    save.dataset.action = comparing ? "endCompare" : "saveRun";
    label(save, comparing ? "End comparison" : "Save run");
    save.hidden = !comparing && (t.startedAt === null || this.talk.slide !== this.talk.state.endSlide);
    save.title = comparing ? "" : "Saves the times this run took as a .pdfpc file, to compare with the plan: drop it on this window.";
    reset.classList.toggle("confirm", !!this.resetArmed);
    label(reset, this.resetArmed ? "Click again to reset" : "Reset", "⇧R");
    this.renderGuide(now);
  }

  /** The guide's line over the buttons: what to do next, or a hint or a fact, colored by which (core/guide.ts). */
  private renderGuide(now: number): void {
    const s = this.talk.state;
    const until = T.untilStart(this.deck, now);
    const lastPlanned = this.talk.slide === s.endSlide;
    const line = guideLine({
      audience: this.audience.status,
      reopenWith: this.reconnectAction === "prepareSharing" ? "Sharing" : "Projector",
      solo: this.view.solo,
      oneScreen: this.platform.window.extended === false,
      system: this.platform.window.system,
      clock: s.timer.startedAt === null ? "idle" : s.timer.pausedAt === null ? "running" : "paused",
      stale: this.talk.stale,
      startsAt: until ? { time: T.formatClock(now + until), in: T.format(until) } : null,
      laser: s.laser,
      lastPlanned: lastPlanned && s.endSlide < this.deck.slides.length - 1,
      finished: lastPlanned && this.talk.finished && this.savedRun !== s.timer.startedAt,
      comparing: this.comparison?.name ?? null,
    });
    const p = $("guide");
    p.className = `guide ${line?.kind ?? ""}`;
    p.replaceChildren(...(line?.fact ? [el("span", "fact", `${line.fact} · `)] : []), ...renderInline(line?.text ?? ""));
  }

  /** The talk bar's scale and target, as last laid out. */
  private barScale = "";

  /** The talk bar's parts, back to front. */
  private buildTalkbar(): void {
    $("talkbar").replaceChildren(
      el("div", "past"),
      el("div", "projected"),
      el("div", "spent"),
      el("div", "slide-window"),
      el("div", "window"),
      el("div", "target"),
    );
    this.barScale = "";
  }

  /** Dims the part of the note you'd have said by now. */
  private renderNotesDim(now = Date.now()): void {
    this.spoken.show(this.settings.dimNotes && !this.comparison ? this.talk.used(now) : null);
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
      // The lines as they would stand at the end of this slide, run in the other file's times.
      const { slide, talk } = this.comparison.renderTimes(this.talk.slide, this.talk.state.endSlide, this.settings.slack);
      for (const id of ["pace-slide", "talkbar"]) $(id).hidden = false;
      $("pace-slide").classList.toggle("none", !slide);
      if (slide) {
        $("slide-fill").className = `slide-fill t-${slide.tone}`;
        $("slide-fill").style.transform = `scaleX(${slide.share})`;
        this.fillAt = -1;
      }
      this.drawTalkbar(talk.scale, talk.target, talk.at, talk.finish, `t-${talk.tone}`, talk.window);
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

    const tone = `t-${p.started ? p.tone : "on"}`;
    const slideWindow = p.segments.find((s) => s.slide === this.talk.slide) ?? null;
    this.drawTalkbar(p.scale, p.target, p.at, p.finish, tone, own?.plan ?? slideWindow, slideWindow);
    // Where the talk would end, or how early or late, at the clock's right, under the target end.
    $("target-at").textContent = T.formatShort(p.target * 1000);
    const pace = p.tone === "on" || p.tone === "idle" ? "on time" : `${span(p.late)} ${p.late > 0 ? "late" : "early"}`;
    const plan = `Planned to end at ${mark(p.planned)}; target ${mark(p.target)}.`;
    const finish = $("finish");
    finish.className = `finish ${tone}`;
    if (this.settings.earlyLate) {
      finish.textContent = pace;
      finish.title = `How early or late the talk would end at this pace. ${plan} Click (e) for where it would end.`;
    } else {
      finish.textContent = T.formatShort(p.finish * 1000);
      finish.title = `Where the talk would end at this pace: ${pace}. ${plan} Click (e) for how early or late.`;
    }
  }

  /**
   * The whole talk's line: a red line at the `target` end, time spent `at` in
   * the pace's `tone` and going on lighter to where the talk would end, this
   * slide's planned `slideWindow` in soft yellow and the active step `window`
   * in solid yellow over them; all of it against `scale` seconds.
   */
  private drawTalkbar(
    scale: number,
    target: number,
    at: number,
    finish: number,
    tone: string,
    window: { start: number; end: number } | null,
    slideWindow: { start: number; end: number } | null = null,
  ): void {
    const bar = $("talkbar");
    const x = (t: number) => `${((Math.min(Math.max(t, 0), scale) / scale) * 100).toFixed(3)}%`;
    if (`${scale}:${target}` !== this.barScale) {
      this.barScale = `${scale}:${target}`;
      for (const part of [".target", ".past"]) bar.querySelector<HTMLElement>(part)!.style.left = x(target);
    }
    const spent = bar.querySelector<HTMLElement>(".spent")!;
    spent.style.width = x(at);
    spent.className = `spent ${tone}`;
    const projected = bar.querySelector<HTMLElement>(".projected")!;
    projected.style.width = x(finish);
    projected.className = `projected ${tone}`;
    const slideSlot = bar.querySelector<HTMLElement>(".slide-window")!;
    const showSlide = !!slideWindow && (!window || slideWindow.start !== window.start || slideWindow.end !== window.end);
    slideSlot.hidden = !showSlide;
    if (showSlide) {
      slideSlot.style.left = x(slideWindow.start);
      slideSlot.style.width = `calc(${x(slideWindow.end)} - ${x(slideWindow.start)})`;
    }
    const slot = bar.querySelector<HTMLElement>(".window")!;
    slot.hidden = !window;
    if (window) {
      slot.style.left = x(window.start);
      slot.style.width = `calc(${x(window.end)} - ${x(window.start)})`;
    }
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
    this.thumbLines.strip = [];
    this.stripSlide = -1;
    this.listSlides(strip, (slide) => {
      const li = el("li");
      li.classList.toggle("hidden", !t.slideVisible(slide));
      const thumb = this.thumb(t.lastOf(slide));
      li.append(el("span", "num", String(slide + 1)), thumb.canvas, (this.thumbLines.strip[slide] = el("i", "cmp")));
      li.addEventListener("click", () => (this.showPreview(null), this.go(t.firstOf(slide))));
      this.stripItems[slide] = li;
      items.push([li, thumb]);
      return li;
    });
    this.lazy(strip, items);
    this.drawThumbLines();
    this.stripHover = null;
    this.hoverStrip();
  }

  /**
   * Marks the thumbnail under the mouse, and shows its slide. Not the browser's
   * :hover, which in WebKit catches up only once scrolling has stopped.
   */
  private hoverStrip(): void {
    const { x, y } = this.stripMouse;
    const li = document.elementFromPoint(x, y)?.closest<HTMLElement>("#strip li:not(.divider)") ?? null;
    if (li === this.stripHover) return;
    this.stripHover?.classList.remove("hover");
    this.stripHover = li;
    if (!li) return;
    li.classList.add("hover");
    this.showPreview(this.talk.lastOf(this.stripItems.indexOf(li)));
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

  /** While comparing, each thumbnail's line: its slide's, run in the other file's times (ui/compare.ts). */
  private drawThumbLines(): void {
    const lines = this.comparison?.slideLines(this.talk.state.endSlide, this.settings.slack);
    for (const list of [this.thumbLines.strip, this.thumbLines.overview]) {
      list.forEach((line, slide) => {
        const l = lines?.[slide];
        line.hidden = !l;
        if (!l) return;
        line.className = `cmp t-${l.tone}`;
        line.style.setProperty("--fill", `${(l.share * 100).toFixed(1)}%`);
      });
    }
  }

  private setOverview(open: boolean): void {
    if (open && this.view.help) this.setHelp(false);
    this.view.overview = open;
    $("overview").hidden = !open;
    if (open) {
      this.rememberOverlayFocus();
      this.view.selected = this.talk.slide;
      this.buildOverview();
    } else this.restoreOverlayFocus();
    this.render();
  }

  private setHelp(open: boolean): void {
    if (open && this.view.overview) this.setOverview(false);
    this.view.help = open;
    this.render();
    if (open) {
      this.rememberOverlayFocus();
      $("help-close").focus();
    } else this.restoreOverlayFocus();
  }

  private rememberOverlayFocus(): void {
    const active = document.activeElement;
    this.focusBeforeOverlay = active instanceof HTMLElement ? active : null;
    $("presenter").inert = $("solo").inert = true;
  }

  private restoreOverlayFocus(): void {
    $("presenter").inert = $("solo").inert = false;
    this.focusBeforeOverlay?.focus({ preventScroll: true });
    this.focusBeforeOverlay = null;
  }

  private buildOverview(): void {
    const t = this.talk;
    const grid = $("overview-grid");
    const items: Array<[HTMLElement, Thumb]> = [];
    this.overviewItems = [];
    this.thumbLines.overview = [];
    this.listSlides(grid, (slide) => {
      const pages = this.deck.slides[slide];
      const li = el("li");
      li.classList.toggle("hidden", !t.slideVisible(slide));
      li.classList.toggle("current", slide === t.slide);
      const thumb = this.thumb(t.lastOf(slide));
      const cap = el("span", "cap");
      const detail = [pages.length > 1 ? `${pages.length} steps` : "", t.slideVisible(slide) ? "" : "hidden"].filter(Boolean).join(" · ");
      cap.append(
        el("span", "", String(slide + 1)),
        el("span", "", detail),
      );
      const button = el("button");
      button.type = "button";
      button.tabIndex = -1;
      button.setAttribute("aria-label", `Slide ${slide + 1}${detail ? `, ${detail}` : ""}`);
      if (slide === t.slide) button.setAttribute("aria-current", "true");
      button.append(thumb.canvas, (this.thumbLines.overview[slide] = el("i", "cmp")), cap);
      button.addEventListener("click", () => this.pick(slide));
      li.append(button);
      this.overviewItems[slide] = li;
      items.push([li, thumb]);
      return li;
    });
    this.lazy($("overview"), items);
    this.drawThumbLines();
    this.select(this.view.selected);
  }

  private select(slide: number): void {
    const v = this.view;
    const previous = this.overviewItems[v.selected];
    previous?.classList.remove("selected");
    const previousButton = previous?.querySelector("button");
    if (previousButton) previousButton.tabIndex = -1;
    v.selected = Math.max(0, Math.min(this.deck.slides.length - 1, slide));
    const item = this.overviewItems[v.selected];
    const button = item?.querySelector("button");
    item?.classList.add("selected");
    item?.scrollIntoView({ block: "nearest" });
    if (button) {
      button.tabIndex = 0;
      button.focus({ preventScroll: true });
    }
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
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns, PageDown: 1, PageUp: -1 };
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
    const total = this.deck.slides.length;
    input.value = "";
    input.max = String(total);
    $("goto-total").textContent = `of ${total}`;
    let submitted = false;
    dialog.querySelector("form")!.onsubmit = () => (submitted = true);
    dialog.onclose = () => {
      const n = Number.parseInt(input.value, 10);
      if (submitted && n >= 1 && n <= total) this.go(this.talk.firstOf(n - 1));
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
   * stops. Meanwhile the clock stands still, paused if it was running: its
   * keys and buttons do nothing.
   */
  compareWith(other: { name: string; text: string } | null): void {
    const was = this.comparison;
    // Parsed first: a file that isn't a .pdfpc changes nothing.
    this.comparison = other && new Comparison(this.deck, this.opened.source.pdfpc?.name ?? "the deck", other);
    was?.dispose();
    const t = this.talk.state.timer;
    if (other && t.startedAt !== null && t.pausedAt === null) this.talk.act("timerPause");
    $("presenter").classList.toggle("comparing", !!other);
    this.drawThumbLines();
    this.nextNote = null;
    this.render();
  }

  /** Saves the run's times as a `.pdfpc` file of lengths, to compare with the plan (core/compare.ts). */
  private async saveRun(): Promise<void> {
    const t = this.talk;
    const started = t.state.timer.startedAt;
    if (started === null) return toast("No run to save yet: the clock hasn't started.", { tone: "warn" });
    const now = Date.now();
    const name = runName(this.deck.name, new Date(now));
    try {
      const where = await this.platform.save(name, runFile(this.deck, t.state.endSlide, t.spentByPage(now), true), this.deck.name);
      this.savedRun = started;
      toast(`${where ? `Saved ${where}` : `Downloaded ${name}`}. Drop it on this window to compare it with the plan.`, { ms: 8000, tone: "hint" });
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
