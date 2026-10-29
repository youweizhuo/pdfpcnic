// The talk: where it stands, what each key does to it, and how it keeps to
// its plan. Nothing here draws: the presenter page shows it (ui/presenter.ts),
// and the same rules hold wherever pdfpcnic runs.

import type { Deck, LinkTarget } from "./deck.ts";
import type { TalkAction } from "./keys.ts";
import { grade, type Grade, type Plan, type Slack } from "./pace.ts";
import * as T from "./timer.ts";

export interface Point {
  x: number;
  y: number;
}

/** Where the talk stands: what the keys change. Plain data, so it can be saved and inspected. */
export interface TalkState {
  page: number;
  /** Page the audience keeps seeing while frozen. */
  frozen: number | null;
  black: boolean;
  laser: boolean;
  /** Where the laser points, in fractions of the page, or null off the slide. */
  laserAt: Point | null;
  timer: T.TimerState;
  endSlide: number;
  /** Bookmarked page. */
  bookmark: number | null;
  back: number[];
  forward: number[];
}

/** What a reload keeps, to resume mid-talk. */
export interface SavedSession {
  pdfName: string;
  page: number;
  timer: T.TimerState;
  endSlide?: number;
  bookmark?: number | null;
  /** Seconds spent on each planned window, by the presenter's keys. */
  spent?: Record<string, number>;
  savedAt: number;
}

/** A session ends after this long; a later visit starts the talk afresh. */
const SESSION_TTL = 8 * 3600_000;

/** Whether a saved session is this PDF's talk, recent enough to resume. */
export const resumes = (saved: SavedSession | undefined, pdfName: string, now: number): saved is SavedSession =>
  !!saved && saved.pdfName === pdfName && now - saved.savedAt < SESSION_TTL;

/** How a time stands: idle before the talk starts, then early, on time, or late in three levels. */
export type Tone = Grade | "idle";

/** How the talk keeps to its plan, in seconds, for the pace display. */
export interface Progress {
  started: boolean;
  /** Seconds into the talk, whole, as the clock shows them. */
  at: number;
  /** Where the plan ends: from the timing lines, else the talk's set length. 0 when there's nothing to pace. */
  planned: number;
  /** The target end: the talk's set length, else where the plan ends. */
  target: number;
  /** This slide's own time, when it has some: its window (null off the plan), its length, and how far over it you are. */
  slide: { plan: Plan | null; budget: number; over: number; tone: Tone } | null;
  /** Where the talk would end if you moved on now, and how late that is against the target (negative: early). */
  finish: number;
  late: number;
  tone: Tone;
  /** The talk bar's span, and the planned windows on it. */
  scale: number;
  segments: Array<{ slide: number; start: number; end: number }>;
}

export class Talk {
  readonly deck: Deck;
  readonly state: TalkState;
  /** The slides on the talk bar. */
  onBar: number[] = [];
  /** Each slide's planned window, from its first step's start to its last step's end. */
  private plans: Array<Plan | null> = [];
  /** Whether any note has a timing line. */
  private timed = false;
  /** Planned length of the talk proper in seconds, from the timing lines. */
  private planned = 0;
  /** Seconds spent on each planned window (or slide without one) on earlier visits. */
  private spent = new Map<string, number>();
  /** The window you're on, and when you came to it (seconds into the talk). */
  private visit: { key: string; since: number } | null = null;
  /** The last planned window you were on. */
  private lastPlan: Plan | null = null;
  /** Your time on this slide, the talk's seconds plus `base`, against its planned `budget`; null before the start or without a plan. */
  private slideTime: { base: number; budget: number } | null = null;

  /** Starts the deck's talk, or picks up a saved one. */
  constructor(deck: Deck, saved: SavedSession | undefined, now: number) {
    this.deck = deck;
    const from = resumes(saved, deck.name, now) && saved.page < deck.pages.length ? saved : undefined;
    this.state = {
      page: from?.page ?? 0,
      frozen: null,
      black: false,
      laser: false,
      laserAt: null,
      timer: from?.timer ?? T.freshTimer(),
      endSlide: Math.min(from?.endSlide ?? deck.endSlide, deck.slides.length - 1),
      bookmark: from?.bookmark ?? (deck.savedSlide === null ? null : deck.slides[deck.savedSlide][0]),
      back: [],
      forward: [],
    };
    if (from?.spent) this.spent = new Map(Object.entries(from.spent));
    this.replan();
  }

  // Navigation

  /** The slide shown now. */
  get slide(): number {
    return this.deck.pages[this.state.page].slide;
  }

  visible = (page: number) => !this.deck.pages[page].hidden;
  slideVisible = (slide: number) => this.deck.slides[slide].some(this.visible);

  firstOf(slide: number): number {
    const pages = this.deck.slides[slide];
    return pages.find(this.visible) ?? pages[0];
  }

  lastOf(slide: number): number {
    const pages = this.deck.slides[slide];
    return pages.findLast(this.visible) ?? pages[pages.length - 1];
  }

  /** The nearest slide that isn't hidden, from `slide` on in `dir`. */
  slideFrom(slide: number, dir: 1 | -1): number | null {
    for (let s = slide + dir; s >= 0 && s < this.deck.slides.length; s += dir) {
      if (this.slideVisible(s)) return s;
    }
    return null;
  }

  /** The next slide's final step, as pdfpc shows it, or null at the end. */
  nextPage(): number | null {
    const s = this.slideFrom(this.slide, 1);
    return s === null ? null : this.lastOf(s);
  }

  /** Goes to a page. A jump (a link, a slide number) can be undone with back. */
  go(page: number, jump = false, now = Date.now()): void {
    const s = this.state;
    if (page < 0 || page >= this.deck.pages.length || page === s.page) return;
    if (jump) {
      s.back.push(s.page);
      s.forward = [];
    }
    // As in pdfpc, the clock starts when the talk leaves its title page, or
    // at the first move after a reset.
    if (s.timer.startedAt === null) s.timer = T.start(s.timer, now);
    s.page = page;
    this.book(now);
  }

  /** Follows a link on the slide: a jump, so back (Shift+Backspace) returns. Web links open by themselves. */
  follow(to: LinkTarget): void {
    if ("page" in to) return this.go(to.page, true);
    if (!("action" in to)) return;
    // The named actions PDF viewers know, as pdf.js's viewer reads them.
    if (to.action === "NextPage") this.go(this.state.page + 1);
    else if (to.action === "PrevPage") this.go(this.state.page - 1);
    else if (to.action === "FirstPage") this.go(0, true);
    else if (to.action === "LastPage") this.go(this.deck.pages.length - 1, true);
    else if (to.action === "GoBack") this.act("back");
    else if (to.action === "GoForward") this.act("forward");
  }

  /** Does what a key asks. Returns what to tell the presenter, if anything. */
  act(action: TalkAction, now = Date.now()): string | void {
    const s = this.state;
    const d = this.deck;
    const here = d.pages[s.page];
    const slide = here.slide;
    switch (action) {
      case "next": {
        const next = d.pages.findIndex((_, i) => i > s.page && this.visible(i));
        if (next >= 0) this.go(next, false, now);
        return;
      }
      case "prev": {
        // Inside reveal steps, step back; otherwise jump to the previous
        // slide's first step (pdfpc's rule).
        const step = d.slides[slide].slice(0, here.step).findLast(this.visible);
        if (step !== undefined) return this.go(step, false, now);
        const p = this.slideFrom(slide, -1);
        if (p !== null) this.go(this.firstOf(p), false, now);
        return;
      }
      case "nextSlide":
      case "prevSlide": {
        const p = this.slideFrom(slide, action === "nextSlide" ? 1 : -1);
        if (p !== null) this.go(this.firstOf(p), false, now);
        return;
      }
      case "next10":
      case "prev10": {
        const dir = action === "next10" ? 1 : -1;
        let target = Math.max(0, Math.min(d.slides.length - 1, slide + 10 * dir));
        // A hidden slide is passed over, as stepping does.
        if (!this.slideVisible(target)) target = this.slideFrom(target, dir) ?? this.slideFrom(target, dir === 1 ? -1 : 1) ?? slide;
        return this.go(this.firstOf(target), true, now);
      }
      case "nextAny":
        return this.go(s.page + 1, false, now);
      case "prevAny":
        return this.go(s.page - 1, false, now);
      case "first":
        return this.go(0, true, now);
      case "last":
        return this.go(this.lastOf(s.endSlide), true, now);
      case "back":
      case "forward": {
        const from = action === "back" ? s.back : s.forward;
        const to = action === "back" ? s.forward : s.back;
        let page = from.pop();
        while (page === s.page) page = from.pop();
        if (page === undefined) return;
        to.push(s.page);
        return this.go(page, false, now);
      }
      case "bookmark":
        s.bookmark = s.page;
        return `Bookmarked slide ${slide + 1}. Shift+M returns here.`;
      case "toBookmark":
        if (s.bookmark !== null) this.go(s.bookmark, true, now);
        return;
      case "normalMode":
        s.laser = false;
        return;
      case "laserMode":
        s.laser = !s.laser;
        return;
      case "freeze":
        s.frozen = s.frozen === null ? s.page : null;
        return;
      case "blank":
        s.black = !s.black;
        return;
      case "escape":
        s.black = false;
        s.frozen = null;
        s.laser = false;
        return;
      case "timerStart":
        s.timer = T.start(s.timer, now);
        this.book(now);
        return;
      case "timerPause":
        s.timer = T.togglePause(s.timer, now);
        return;
      case "timerReset":
        // Never mid-talk by a stray key: the clock has to be paused first.
        if (s.timer.startedAt === null) return;
        if (s.timer.pausedAt === null) return "The clock is running. Pause it first (p), then reset, or click Reset twice.";
        s.timer = T.freshTimer();
        this.forgetVisits();
        return "Clock reset to 0:00:00. It starts again at your next move, or press s.";
      case "endSlide":
        s.endSlide = slide;
        this.replan();
        return `Slide ${slide + 1} is now the end slide; later ones count as backup.`;
    }
  }

  /** Moves the laser, from the presenter's slide. Returns whether there's anything to redraw. */
  point(at: Point | null): boolean {
    const s = this.state;
    if (!s.laser || (at === null && s.laserAt === null)) return false;
    s.laserAt = at;
    return true;
  }

  /** What the room sees: the page (the frozen one, while frozen), black or not, and the laser when it's on that page. */
  get audience(): { page: number; black: boolean; laser: Point | null } {
    const s = this.state;
    const laser = s.laser && (s.frozen === null || s.frozen === s.page) ? s.laserAt : null;
    return { page: s.frozen ?? s.page, black: s.black, laser };
  }

  /**
   * Back on slide 1 with time on the clock, after other slides: likely a look
   * through the slides before the talk, which would throw its pace off. Reset
   * is the way out. Not when the clock was started on slide 1 itself.
   */
  get stale(): boolean {
    return this.state.timer.startedAt !== null && this.slide === 0 && [...this.spent.keys()].some((key) => parseInt(key) !== 0);
  }

  // Pace

  /** How the talk keeps to its plan at `now`. */
  progress(now: number, slack: Slack): Progress {
    this.slideTime = null;
    const s = this.state;
    const { slide, length, plan, budget } = this.book(now);
    // Whole seconds, as the clock shows them, so every number here turns over with it.
    const at = Math.floor(T.elapsed(s.timer, now) / 1000);
    const started = s.timer.startedAt !== null;
    const planned = this.timed ? this.planned : length;
    const target = length || planned;
    if (!planned) return { started, at, planned, target, slide: null, finish: 0, late: 0, tone: "idle", scale: 0, segments: [] };
    const base = this.visit ? (this.spent.get(this.visit.key) ?? 0) - this.visit.since : 0;

    // This slide: its planned time against your time on it. Late always
    // shows, in three levels. A slide planned to take no time has none.
    let own: Progress["slide"] = null;
    if (budget) {
      const over = (this.visit ? base + at : 0) - budget;
      own = { plan, budget, over, tone: !started ? "idle" : over > 0 ? grade(over, target, slack) : "on" };
      if (started) this.slideTime = { base, budget };
    }

    // All slides: where the talk would end if you moved on now, with the
    // slides after this one as planned. A slide off the plan (a backup slide,
    // say) doesn't move you through it: you'd go on from the last planned
    // slide you were on.
    const from = plan ?? this.lastPlan ?? this.planBefore(slide, length);
    const finish = planned + (started ? at - (from?.end ?? 0) : 0);
    const late = Math.round(finish - target);
    return {
      started,
      at,
      planned,
      target,
      slide: own,
      finish,
      late,
      tone: started ? grade(late, target, slack) : "idle",
      // Fixed, with room past the target end.
      scale: Math.max(target * 1.1, planned),
      segments: this.onBar.map((i) => ({ slide: i, ...this.planOf(i, length)! })),
    };
  }

  /** Share of this slide's planned time used by `now`, or null while its time isn't running (as of the last progress()). */
  used(now: number): number | null {
    const t = this.slideTime;
    return t && Math.min(1, Math.max(0, (t.base + T.elapsed(this.state.timer, now) / 1000) / t.budget));
  }

  /** This slide's planned seconds while its time is running (as of the last progress()). */
  get budget(): number | null {
    return this.slideTime?.budget ?? null;
  }

  /** What a reload keeps. */
  save(now: number): SavedSession {
    const s = this.state;
    const spent = new Map(this.spent);
    const v = this.visit;
    if (v) spent.set(v.key, (spent.get(v.key) ?? 0) + Math.floor(T.elapsed(s.timer, now) / 1000) - v.since);
    return { pdfName: this.deck.name, page: s.page, timer: s.timer, endSlide: s.endSlide, bookmark: s.bookmark, spent: Object.fromEntries(spent), savedAt: now };
  }

  /**
   * Where you are in the plan: the planned window you're in (a step with a
   * window of its own, a forced overlay say, goes by that), or for a slide
   * without one, a backup slide, how long it may take.
   */
  private place(now: number): { slide: number; length: number; plan: Plan | null; budget: number; key: string } {
    const s = this.state;
    const slide = this.slide;
    const length = Math.round(T.talkLength(s.timer, this.deck, now) / 1000);
    const page = this.deck.pages[s.page];
    const plan = slide > s.endSlide ? null : (this.timed && page.plan) || this.planOf(slide, length);
    const budget = plan ? plan.end - plan.start : (page.length ?? 0);
    return { slide, length, plan, budget, key: plan ? `${slide}:${plan.start}:${plan.end}` : String(slide) };
  }

  /** Books your time on the window you were on, once you're on another: at every move, and whenever the pace is read. */
  private book(now: number): ReturnType<Talk["place"]> {
    const place = this.place(now);
    if (this.state.timer.startedAt === null) return place;
    const at = Math.floor(T.elapsed(this.state.timer, now) / 1000);
    if (this.visit && at < this.visit.since) this.forgetVisits();
    if (this.visit?.key !== place.key) {
      if (this.visit) this.spent.set(this.visit.key, (this.spent.get(this.visit.key) ?? 0) + at - this.visit.since);
      this.visit = { key: place.key, since: at };
    }
    if (place.plan) this.lastPlan = place.plan;
    return place;
  }

  /** Works out the plan: at the start, and again when the end slide moves. */
  private replan(): void {
    const d = this.deck;
    this.plans = d.slides.map((pages) => {
      const own = pages.flatMap((p) => d.pages[p].plan ?? []);
      return own.length ? { start: Math.min(...own.map((p) => p.start)), end: Math.max(...own.map((p) => p.end)) } : null;
    });
    this.timed = this.plans.some(Boolean);
    const main = this.plans.slice(0, this.state.endSlide + 1);
    this.planned = Math.max(0, ...main.map((p) => p?.end ?? 0));
    // With timing lines, the slides planned to take time; without, every slide of the talk proper.
    this.onBar = main.flatMap((p, slide) => (!this.timed || (p && p.end > p.start) ? [slide] : []));
  }

  /** A slide's planned window. Without timing lines, the talk's length is split evenly over the slides. */
  private planOf(slide: number, length: number): Plan | null {
    const n = this.state.endSlide + 1;
    if (slide >= n) return null;
    if (this.timed) return this.plans[slide];
    return length ? { start: (slide * length) / n, end: ((slide + 1) * length) / n } : null;
  }

  /** The planned window of the nearest slide at or before `slide`, for slides off the plan. */
  private planBefore(slide: number, length: number): Plan | null {
    for (let i = Math.min(slide, this.state.endSlide); i >= 0; i--) {
      const p = this.planOf(i, length);
      if (p) return p;
    }
    return null;
  }

  /** Forgets your time on each slide, as when the clock goes back to zero. */
  private forgetVisits(): void {
    this.spent.clear();
    this.visit = null;
    this.lastPlan = null;
  }
}
