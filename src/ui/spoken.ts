// Dims the part of a note you'd have said by now, a character at a time, as a
// typewriter would. It uses the CSS Custom Highlight API, so the note's markup
// stays as it is; browsers without it just don't dim.

const NAME = "spoken";
const supported = typeof CSS !== "undefined" && "highlights" in CSS;

/** Characters that count: everything but whitespace. */
const counted = (text: string) => text.replace(/\s/g, "").length;

/** Offset in `text` of its `k`-th counted character (from 0), or its length if it has fewer. */
function offsetOf(text: string, k: number): number {
  let i = 0;
  for (; i < text.length; i++) if (!/\s/.test(text[i]) && k-- <= 0) break;
  return i;
}

export class Spoken {
  private nodes: Array<{ node: Text; count: number }> = [];
  /** Characters in the spoken text. */
  total = 0;
  private shown = -1;

  /** Indexes the spoken text of a freshly rendered note: all but its references. */
  index(root: HTMLElement): void {
    const refs = [...root.querySelectorAll(".ref")];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    this.nodes = [];
    this.total = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const node = n as Text;
      const count = counted(node.data);
      if (!count || refs.some((r) => r.contains(node))) continue;
      this.nodes.push({ node, count });
      this.total += count;
    }
    this.shown = -1;
    this.show(null);
  }

  /** Dims the first `share` (0 to 1) of the spoken text, or none for null; redrawn only as it reaches another character. */
  show(share: number | null): void {
    if (!supported) return;
    const at = share === null ? 0 : Math.floor(share * this.total);
    if (at === this.shown) return;
    this.shown = at;
    const ranges = this.ranges(at);
    if (ranges.length) CSS.highlights.set(NAME, new Highlight(...ranges));
    else CSS.highlights.delete(NAME);
  }

  /** Ranges over the first `to` counted characters. */
  private ranges(to: number): Range[] {
    const out: Range[] = [];
    let at = 0;
    for (const { node, count } of this.nodes) {
      if (at >= to) break;
      const r = new Range();
      r.setStart(node, 0);
      r.setEnd(node, offsetOf(node.data, to - at));
      out.push(r);
      at += count;
    }
    return out;
  }

  /** How dim the said part is: 0 for not at all, up to 1. */
  static setDim(dim: number): void {
    let style = document.getElementById("spoken-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "spoken-style";
      document.head.append(style);
    }
    style.textContent = `::highlight(${NAME}) { color: rgb(245 245 247 / ${(1 - dim).toFixed(3)}); }`;
  }
}
