// The Mac platform: the app's side of each port. Its other half is the Swift
// app in mac/, which answers over the bridge.

import demoPdf from "../../demo/demo.pdf?url";
import demoPdfpc from "../../demo/demo.pdfpc?raw";
import type { Platform } from "../platform.ts";
import { store } from "../web/store.ts";
import { MacAudience } from "./audience.ts";
import { call, on } from "./bridge.ts";
import { openPdf } from "./pdf.ts";
import { presenterWindow } from "./window.ts";

export const mac: Platform = {
  openPdf,
  audience: (events) => new MacAudience(events),
  window: presenterWindow,
  // The app's web view keeps the browser's storage, on this Mac.
  store,
  demo: async () => ({ pdf: await (await fetch(demoPdf)).arrayBuffer(), pdfpc: demoPdfpc }),
  updated: (show) => on<string>("updated", show),
  files(open) {
    // Opened from the Finder or File > Open: the app serves each file's bytes.
    on<Array<{ name: string }>>("open", async (files) =>
      open(await Promise.all(files.map(async ({ name }, i) => new File([await (await fetch(`opened/${i}`)).arrayBuffer()], name)))),
    );
    void call("ready");
  },
  // The app knows where each file came from: opened, chosen or dropped.
  notes: (name) => call<string | null>("notes", { name }),
  // Beside the PDF, as the notes are; the app says where it went.
  save: (name, text, pdfName) => call<string>("save", { name, text, pdfName }),
};
