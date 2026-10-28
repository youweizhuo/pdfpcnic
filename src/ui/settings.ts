// What the presenter can size and tune, kept on this computer: the columns,
// the current slide against its notes, the notes and laser sizes, how much the
// notes dim, how the bar shows its times, and the pace colors' levels. The settings dialog (,) and the drag
// handles change them.

import type { Deck } from "../core/deck.ts";
import { SLACK, span, type Slack } from "../core/pace.ts";
import type { Store } from "../platform.ts";
import { $, draggable } from "./dom.ts";
import { Spoken } from "./spoken.ts";

const LEVELS = ["early", "serious", "severe"] as const;
type SlackLevel = (typeof LEVELS)[number];

/** Slider ranges for the pace levels: [min, max, step] in seconds, or in percent. */
const SLACK_RANGE: Record<Slack["unit"], Record<SlackLevel, [number, number, number]>> = {
  time: { early: [0, 180, 15], serious: [15, 300, 15], severe: [15, 300, 15] },
  share: { early: [0, 10, 1], serious: [1, 15, 1], severe: [1, 20, 1] },
};

export class Settings {
  /** Current slide width as a share of its column; what it gives up goes to the notes. */
  stage = 1;
  notesSize: number;
  /** Laser dot size, as a share of the slide's height. */
  laserSize: number;
  /** How much the covered part of a note dims, 0 for not at all. */
  notesDim: number;
  /** The bar's times as times of day, rather than on the clock. */
  timeOfDay: boolean;
  slack: Slack;
  private split = 0.5;

  constructor(
    private store: Store,
    private deck: Deck,
    /** Redraws after the pace levels or the dimming change. */
    private on: { pace(): void; dim(): void },
    /** The talk's target length in seconds, as last drawn: the levels show against it. */
    private target: () => number,
  ) {
    this.notesSize = store.pref<number | null>("notesSize", null) ?? this.deckNotesSize;
    this.laserSize = store.pref("laserSize", 0.035);
    this.notesDim = store.pref("notesDim", 0.5);
    this.timeOfDay = store.pref("barTimeOfDay", false);
    const saved = store.pref<Slack | null>("paceSlack", null);
    this.slack = saved && saved.unit in SLACK ? { ...SLACK[saved.unit], ...saved } : { ...SLACK.time };
  }

  /** Lays the presenter out as last left. */
  apply(): void {
    document.documentElement.style.setProperty("--notes", `${this.notesSize}px`);
    this.applyColumns(this.store.pref("split", 0.5));
    this.applyStage(this.store.pref("stage", 1));
    Spoken.setDim(this.notesDim);
  }

  open(): void {
    this.sync();
    $<HTMLDialogElement>("settings").showModal();
  }

  setStage(f: number): void {
    this.applyStage(f);
    this.store.setPref("stage", this.stage);
  }

  setNotesSize(px: number): void {
    this.notesSize = Math.min(72, Math.max(12, px));
    document.documentElement.style.setProperty("--notes", `${this.notesSize}px`);
    this.store.setPref("notesSize", this.notesSize);
  }

  /** Equal columns and the current slide at full size, as at first. */
  resetLayout(): void {
    this.applyColumns(0.5);
    this.store.setPref("split", this.split);
    this.setStage(1);
  }

  setTimeOfDay(on: boolean): void {
    this.timeOfDay = on;
    this.store.setPref("barTimeOfDay", on);
    this.on.pace();
  }

  setLaserSize(f: number): void {
    this.laserSize = Math.min(0.2, Math.max(0.01, f));
    this.store.setPref("laserSize", this.laserSize);
  }

  /** The dialog's controls and the drag handles. */
  wire(signal: AbortSignal): void {
    const dialog = $<HTMLDialogElement>("settings");
    dialog.addEventListener("click", (e) => e.target === dialog && dialog.close(), { signal });
    const range = (id: string, set: (value: number) => void) =>
      $<HTMLInputElement>(id).addEventListener(
        "input",
        (e) => {
          set(Number((e.target as HTMLInputElement).value));
          this.sync();
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
          const t = this.target();
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
          this.sync();
        },
        { signal },
      );
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>("#set-times button")) {
      b.addEventListener(
        "click",
        () => {
          this.setTimeOfDay(b.dataset.times === "day");
          this.sync();
        },
        { signal },
      );
    }
    $("set-defaults").addEventListener(
      "click",
      () => {
        this.resetLayout();
        this.setNotesSize(this.deckNotesSize);
        this.store.setPref("notesSize", null);
        this.setLaserSize(0.035);
        this.useSlack({ ...SLACK.time });
        this.setNotesDim(0.5);
        this.setTimeOfDay(false);
        this.sync();
      },
      { signal },
    );

    // The columns, and the current slide against its notes, can be dragged.
    draggable($("split"), signal, {
      move: (e) => {
        const left = $("notes").getBoundingClientRect().left;
        const right = $("next").parentElement!.getBoundingClientRect().right - $("split").offsetWidth;
        this.applyColumns((e.clientX - left) / (right - left));
      },
      end: () => this.store.setPref("split", this.split),
    });
    let from = { y: 0, height: 0, stage: 1 };
    draggable($("stage-split"), signal, {
      start: (e) => (from = { y: e.clientY, height: $("current").offsetHeight, stage: this.stage }),
      move: (e) => this.applyStage((from.stage * (from.height + e.clientY - from.y)) / from.height),
      end: () => this.store.setPref("stage", this.stage),
    });
  }

  /** Notes size the .pdfpc file asks for, in px. */
  private get deckNotesSize(): number {
    return this.deck.noteFontSize ? Math.round((this.deck.noteFontSize * 4) / 3) : 24;
  }

  private applyColumns(split: number): void {
    this.split = Math.min(0.8, Math.max(0.4, split || 0.5));
    $("presenter").style.gridTemplateColumns = `minmax(0, ${this.split}fr) 28px minmax(0, ${1 - this.split}fr)`;
  }

  private applyStage(f: number): void {
    this.stage = Math.min(1, Math.max(0.5, Math.round(f * 100) / 100));
    document.documentElement.style.setProperty("--stage", String(this.stage));
  }

  private setNotesDim(f: number): void {
    this.notesDim = Math.min(0.8, Math.max(0, f));
    this.store.setPref("notesDim", this.notesDim);
    Spoken.setDim(this.notesDim);
    this.on.dim();
  }

  private useSlack(slack: Slack): void {
    this.slack = slack;
    this.store.setPref("paceSlack", slack);
    this.on.pace();
  }

  /** The dialog's controls, as the settings stand. */
  private sync(): void {
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
    const t = this.target();
    for (const b of document.querySelectorAll<HTMLButtonElement>("#set-unit button")) {
      b.classList.toggle("on", b.dataset.unit === unit);
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>("#set-times button")) {
      b.classList.toggle("on", (b.dataset.times === "day") === this.timeOfDay);
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
}
