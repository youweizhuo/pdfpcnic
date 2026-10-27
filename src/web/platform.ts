// The web platform: the browser's side of each port, for the website and the offline file.

import { demoDeck } from "variant";
import type { Platform } from "../platform.ts";
import { PopupAudience } from "./audience.ts";
import { openPdf } from "./pdfjs.ts";
import { store } from "./store.ts";
import { presenterWindow } from "./window.ts";

export const web: Platform = {
  openPdf,
  audience: (events) => new PopupAudience(events),
  window: presenterWindow,
  store,
  demo: demoDeck,
};
