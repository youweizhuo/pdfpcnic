// Dims the part of a note you'd have said by now, character by character.
// It uses the CSS Custom Highlight API, so the note's markup stays as it is;
// browsers without it just don't dim.

const NAME = "spoken";
const supported = typeof CSS !== "undefined" && "highlights" in CSS;

/** A paragraph that opens with *ref* is a reference, not spoken (TokenSlides' convention). */
function isRef(block: Element): boolean {
  const first = [...block.childNodes].find((n) => n.nodeType !== Node.TEXT_NODE || n.textContent!.trim());
  return first instanceof HTMLElement && first.tagName === "EM" && first.textContent!.trim().toLowerCase() === "ref";
}

/** Characters that count: everything but whitespace. */
const counted = (text: string) => text.replace(/\s/g, "").length;

/** Offset in `text` just after its `k`-th counted character, carried on to the end of a Latin word. */
function offsetAfter(text: string, k: number): number {
  let i = 0;
  for (; i < text.length && k > 0; i++) if (!/\s/.test(text[i])) k--;
  while (i < text.length && /\w/.test(text[i]) && /\w/.test(text[i - 1])) i++;
  return i;
}

export class Spoken {
  private nodes: Array<{ node: Text; count: number }> = [];
  private total = 0;
  private shown = 0;

  /** Indexes the spoken text of a freshly rendered note. */
  index(root: HTMLElement): void {
    const refs = [...root.querySelectorAll("p, li")].filter(isRef);
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

  /** Dims the first `share` (0 to 1) of the spoken text, or none for null. */
  show(share: number | null): void {
    if (!supported) return;
    const n = share === null ? 0 : Math.round(share * this.total);
    if (n === this.shown) return;
    this.shown = n;
    if (!n) {
      CSS.highlights.delete(NAME);
      return;
    }
    const ranges: Range[] = [];
    let left = n;
    for (const { node, count } of this.nodes) {
      if (!left) break;
      const r = new Range();
      r.setStart(node, 0);
      r.setEnd(node, count <= left ? node.length : offsetAfter(node.data, left));
      left = Math.max(0, left - count);
      ranges.push(r);
    }
    CSS.highlights.set(NAME, new Highlight(...ranges));
  }

  /** How dim the said part is: 0 for not at all, up to 1. */
  static setDim(dim: number): void {
    let style = document.getElementById("spoken-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "spoken-style";
      document.head.append(style);
    }
    style.textContent = `::highlight(${NAME}) { color: rgb(245 245 247 / ${(1 - dim).toFixed(2)}); }`;
  }
}
