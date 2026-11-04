// The presenter's own browser window: fullscreen, and how many screens there are.

import type { System } from "../core/guide.ts";
import type { PresenterWindow } from "../platform.ts";

// Keyboard Lock and the system's name (Chromium); absent elsewhere.
declare global {
  interface Navigator {
    keyboard?: { lock(keys: string[]): Promise<void> };
    userAgentData?: { platform: string };
  }
}

/** Chromium names the system; elsewhere the older platform string tells it well enough. */
function system(): System {
  const name = navigator.userAgentData?.platform ?? navigator.platform;
  return /^mac/i.test(name) ? "mac" : /^win/i.test(name) ? "windows" : /linux/i.test(name) ? "linux" : null;
}

/**
 * Lets Esc reach a page while it's fullscreen, as it does in the Mac app;
 * holding Esc down then leaves fullscreen (Chrome, Edge). Elsewhere a press of
 * Esc leaves fullscreen at once: the browser's own rule.
 */
export const lockEscape = (win: Window) => void win.navigator.keyboard?.lock(["Escape"]).catch(() => {});

/**
 * Keeps the display from sleeping while a window shows, until the signal aborts or the window closes. Asks again when
 * it comes back, as the browser lets go while it's hidden, and at each key press or click until it has the lock:
 * WebKit wants one of those, and opening the audience window uses up the click that opened the deck.
 */
export function holdWakeLock(win: Window, signal?: AbortSignal): void {
  let lock: WakeLockSentinel | undefined;
  let asking = false;
  const hold = async () => {
    if (asking || (lock && !lock.released) || win.document.visibilityState !== "visible") return;
    asking = true;
    try {
      lock = await win.navigator.wakeLock.request("screen");
      if (signal?.aborted) void lock.release();
    } catch {
      // Absent over plain http and in older browsers, refused on low battery: the talk goes on without it.
    } finally {
      asking = false;
    }
  };
  void hold();
  for (const event of ["visibilitychange", "keydown", "pointerdown"]) win.document.addEventListener(event, () => void hold(), { signal });
  signal?.addEventListener("abort", () => void lock?.release());
}

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
  system: system(),
  onChange(cb, signal) {
    document.addEventListener("fullscreenchange", cb, { signal });
    // Chromium tells when a screen is plugged in or out.
    (screen as unknown as EventTarget).addEventListener?.("change", cb, { signal });
  },
  keepAwake: (signal) => holdWakeLock(window, signal),
};
