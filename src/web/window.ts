// The presenter's own browser window: fullscreen, and how many screens there are.

import type { PresenterWindow } from "../platform.ts";

// Keyboard Lock (Chromium); absent elsewhere.
declare global {
  interface Navigator {
    keyboard?: { lock(keys: string[]): Promise<void> };
  }
}

/**
 * Lets Esc reach a page while it's fullscreen, as it does in the Mac app;
 * holding Esc down then leaves fullscreen (Chrome, Edge). Elsewhere a press of
 * Esc leaves fullscreen at once: the browser's own rule.
 */
export const lockEscape = (win: Window) => void win.navigator.keyboard?.lock(["Escape"]).catch(() => {});

export const presenterWindow: PresenterWindow = {
  get fullscreen() {
    return !!document.fullscreenElement;
  },
  async setFullscreen(on) {
    if (!on) {
      if (document.fullscreenElement) await document.exitFullscreen();
      return;
    }
    lockEscape(window);
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
