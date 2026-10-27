// The presenter's own browser window: fullscreen, and how many screens there are.

import type { PresenterWindow } from "../platform.ts";

export const presenterWindow: PresenterWindow = {
  get fullscreen() {
    return !!document.fullscreenElement;
  },
  async setFullscreen(on) {
    if (!on) {
      if (document.fullscreenElement) await document.exitFullscreen();
      return;
    }
    try {
      await document.documentElement.requestFullscreen();
    } catch (err) {
      throw new Error("The browser refused fullscreen for this window.", { cause: err });
    }
  },
  // Chromium knows (Window Management API); other browsers don't say.
  get extended() {
    return screen.isExtended;
  },
  onChange(cb, signal) {
    document.addEventListener("fullscreenchange", cb, { signal });
    // Chromium tells when a screen is plugged in or out.
    (screen as unknown as EventTarget).addEventListener?.("change", cb, { signal });
  },
};
