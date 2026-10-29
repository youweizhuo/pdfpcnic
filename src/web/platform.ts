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
  // To the browser's downloads: it says where.
  async save(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return null;
  },
};
