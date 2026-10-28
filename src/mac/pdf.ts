// PDFs through the Mac app: PDFKit reads the pages, and Quartz draws them, as Preview does.

import type { OutlineEntry, PageInfo } from "../core/deck.ts";
import type { Pdf } from "../platform.ts";
import { base64, call } from "./bridge.ts";

/** A PDF the app holds, by its id there. */
export interface MacPdf extends Pdf {
  readonly id: number;
}

export async function openPdf(data: ArrayBuffer): Promise<MacPdf> {
  const { id, pages, outline } = await call<{ id: number; pages: PageInfo[]; outline: OutlineEntry[] }>("openPdf", { data: await base64(data) });
  return {
    id,
    pages,
    outline,
    async draw(page, width) {
      // Raw pixels, so nothing is encoded on the way: the width and height, then the rows, RGBA.
      const res = await fetch(`page?doc=${id}&page=${page}&width=${Math.round(width)}`);
      if (!res.ok) throw new Error(`The app didn't draw page ${page + 1} (${res.status}).`);
      const buf = await res.arrayBuffer();
      const [w, h] = new Uint32Array(buf, 0, 2);
      return createImageBitmap(new ImageData(new Uint8ClampedArray(buf, 8), w, h));
    },
    close: () => call("closePdf", { id }).then(() => {}),
  };
}
