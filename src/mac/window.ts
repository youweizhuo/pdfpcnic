// The presenter's window in the Mac app: fullscreen on its own screen, as
// Présentation.app does it, and whether there's a second screen.

import type { PresenterWindow } from "../platform.ts";
import { call, on } from "./bridge.ts";

let state = { fullscreen: false, extended: true as boolean | undefined };
on<typeof state>("window", (s) => (state = s));

export const presenterWindow: PresenterWindow = {
  get fullscreen() {
    return state.fullscreen;
  },
  get extended() {
    return state.extended;
  },
  async setFullscreen(full) {
    await call("presenterFullscreen", { on: full });
  },
  onChange: (cb, signal) => on("window", cb, signal),
};
