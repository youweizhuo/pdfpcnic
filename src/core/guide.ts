// The audience's next step, as the presenter is told it: the yellow button by
// the clock and the line under the slides. It goes by what the platform can do
// with the audience window, never by which browser this is: where the presenter
// can make it fullscreen (Chrome, Edge, the Mac app), Shift+W does; elsewhere
// the audience window itself has to be double-clicked.

/** The audience window, as the platform reports it. */
export interface AudienceStatus {
  mode: "closed" | "window" | "fullscreen";
  /** The screen it is fullscreen on, or would go to, when the platform names screens. */
  screen: string | null;
  /** Whether the presenter can make it fullscreen; elsewhere only the audience window itself can. */
  remote: boolean;
  /** Fullscreen was asked for from the presenter and refused, until it goes fullscreen. */
  refused: boolean;
}

export interface Step {
  /** What the button does. */
  action: "openAudience" | "audienceFullscreen";
  label: string;
  key: string;
  /** The line under the slides. */
  status: string;
  /** The line asks the presenter to do something. */
  ask: boolean;
}

/** Whether the audience sees the slides: fullscreen, or presented in the presenter's window (solo). */
export const audienceReady = (a: AudienceStatus, solo: boolean) => a.mode === "fullscreen" || solo;

export function audienceStep(a: AudienceStatus, solo: boolean): Step {
  const on = a.screen ? ` on ${a.screen}` : "";
  switch (a.mode) {
    case "closed":
      return {
        action: "openAudience",
        label: "Open audience window",
        key: "o",
        status: solo ? "Presenting in this window. Esc returns to the presenter view." : "",
        ask: false,
      };
    case "fullscreen":
      return { action: "audienceFullscreen", label: "Exit audience fullscreen", key: "⇧W", status: `Audience fullscreen${on}.`, ask: false };
    case "window": {
      const status = a.refused
        ? "This browser lets only the audience window go fullscreen: double-click it."
        : a.screen
          ? "Audience window open, not fullscreen yet."
          : "Audience window open; drag it to the projector, then double-click it for fullscreen.";
      // Where the presenter can't, the button brings the window forward (as o does) and says what to do there.
      if (!a.remote) return { action: "openAudience", label: "Double-click the audience window", key: "", status, ask: a.refused };
      return { action: "audienceFullscreen", label: `Audience fullscreen${on}`, key: "⇧W", status, ask: a.refused };
    }
  }
}
