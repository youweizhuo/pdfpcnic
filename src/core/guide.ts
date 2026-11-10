// What the presenter is told to do: the audience's button at the foot of the
// column, and the one line over the buttons, colored by what it says. Yellow is
// the next thing to do, as the outlined button it names; orange, something in
// the way that no button fixes; purple, a hint; grey, a fact. While two plans
// are compared, it names the other file.
//
// It goes by what the platform can do with the audience window, never by which
// browser this is: where the presenter can make it fullscreen (Chrome, Edge,
// the Mac app), Shift+W does; elsewhere the audience window itself has to be
// double-clicked.

/** The audience window, as the platform reports it. */
export interface AudienceStatus {
  mode: "closed" | "window" | "fullscreen";
  /** The screen it is fullscreen on, or would go to, when the platform names screens. */
  screen: string | null;
  /** Whether the presenter can make it fullscreen; elsewhere only the audience window itself can. */
  remote: boolean;
  /** Fullscreen was asked for from the presenter and refused, until it goes fullscreen. */
  refused: boolean;
  /** Prepared for window sharing; this does not mean a meeting app is sharing it yet. */
  forSharing?: boolean;
}

/** The presenter's system, for the keys that extend the displays; null when it isn't known. */
export type System = "mac" | "windows" | "linux" | null;

export interface Situation {
  audience: AudienceStatus;
  /** Presenting in the presenter's own window. */
  solo: boolean;
  /** The platform sees one screen only, or two mirrored. */
  oneScreen: boolean;
  system: System;
  clock: "idle" | "running" | "paused";
  /** Back on slide 1 after other slides, with time on the clock. */
  stale: boolean;
  /** Before the talk's set start time: that time, and how long until it. */
  startsAt: { time: string; in: string } | null;
  laser: boolean;
  /** On the last planned slide, with backup slides after it. */
  lastPlanned: boolean;
  /** At the end of a run through the talk, its times not saved yet. */
  finished: boolean;
  /** The other `.pdfpc` file's name, while comparing the deck's plan with it. */
  comparing: string | null;
}

export interface Line {
  kind: "next" | "blocked" | "hint" | "fact";
  text: string;
  /** Where things stand, in grey before it. */
  fact?: string;
}

/** Whether the display is prepared: fullscreen, a window for sharing, or the presenter's own window (solo). */
export const audienceReady = (a: AudienceStatus, solo: boolean) => a.mode === "fullscreen" || (a.mode === "window" && !!a.forSharing) || solo;

/** One screen, or two mirrored: each system's way to a second one. */
const EXTEND = {
  mac: "connect the projector, or stop mirroring (⌘ + brightness down)",
  windows: "connect the projector and choose Extend (Win+P)",
  linux: "connect the projector and extend the displays (Super+P)",
  other: "connect the projector and extend the displays, not mirror",
};

/** The audience's next step, while it doesn't see the slides. */
function audienceStep(a: AudienceStatus): string {
  if (a.mode === "closed") return "Press o to open the audience window for the projector.";
  if (!a.remote) return "Drag the audience window to the projector, then double-click it.";
  return a.screen ? `Press ⇧W to make the audience window fullscreen on ${a.screen}.` : "Drag the audience window to the projector, then press ⇧W.";
}

/** The line over the buttons, or null for none. */
export function guideLine(s: Situation): Line | null {
  const a = s.audience;
  const ready = audienceReady(a, s.solo);
  // Looking through the plans, not presenting: nothing else matters.
  if (s.comparing) return { kind: "hint", text: `Comparing with ${s.comparing}.` };
  // In the way, whenever it is.
  if (s.oneScreen && !ready) return { kind: "blocked", text: `One screen only: ${EXTEND[s.system ?? "other"]}.` };
  if (a.mode === "window" && a.refused) {
    return { kind: "blocked", text: "Can't go fullscreen from here: double-click the audience window." };
  }
  // Before the talk, as the buttons stand out: the audience first, then the clock.
  if (s.clock === "idle" || s.stale) {
    if (!ready) return { kind: "next", text: audienceStep(a) };
    // Reset, not Shift+R: that waits for a pause, and the clock likely runs.
    if (s.stale) return { kind: "next", text: "The clock has time from a rehearsal: click Reset before the talk." };
    if (a.mode === "window" && a.forSharing) {
      return { kind: "next", text: "Share the audience window in your meeting app; keep it windowed." };
    }
    const fact = s.startsAt
      ? `The talk starts at ${s.startsAt.time}, in ${s.startsAt.in}`
      : a.mode === "fullscreen"
        ? `Audience fullscreen${a.screen ? ` on ${a.screen}` : ""}`
        : undefined;
    return { kind: "next", text: "Ready: press s to start the clock.", fact };
  }
  if (s.finished) return { kind: "hint", text: "Click Save run to keep this run's times, to compare with the plan." };
  if (s.clock === "paused") return { kind: "hint", text: "Paused: p or a click on the clock resumes; ⇧R resets." };
  if (s.laser) return { kind: "hint", text: "Laser on: + and − size the dot; l turns it off." };
  if (s.lastPlanned) return { kind: "fact", text: "Last planned slide: backup slides follow." };
  return null;
}
