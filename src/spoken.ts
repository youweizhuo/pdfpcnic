// Dims the part of a note you'd have said by now, character by character.
// It uses the CSS Custom Highlight API, so the note's markup stays as it is;
// browsers without it just don't dim.

const NAME = "spoken";
/** Shades the edge fades through, from not yet said to said: the dim part grows smoothly. */
const SHADES = 6;
const supported = typeof CSS !== "undefined" && "highlights" in CSS;

/** A paragraph that opens with *ref* is a reference, not spoken (TokenSlides' convention). */
function isRef(block: Element): boolean {
  const first = [...block.childNodes].find((n) => n.nodeType !== Node.TEXT_NODE || n.textContent!.trim());
  return first instanceof HTMLElement && first.tagName === "EM" && first.textContent!.trim().toLowerCase() === "ref";
}

/** Characters that count: everything but whitespace. */
const counted = (text: string) => text.replace(/\s/g, "").length;

/** Offset in `text` of its `k`-th counted character (from 0), or its length if it has fewer. */
function offsetOf(text: string, k: number): number {
  let i = 0;
  for (; i < text.length; i++) if (!/\s/.test(text[i]) && k-- <= 0) break;
  return i;
}

function paint(name: string, ranges: Range[]): void {
  if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
  else CSS.highlights.delete(name);
}

export class Spoken {
  private nodes: Array<{ node: Text; count: number }> = [];
  private total = 0;
  private shown = "";

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
    this.shown = "";
    this.show(null);
  }

  /**
   * Dims the first `share` (0 to 1) of the spoken text, or none for null. The
   * edge fades over about `soft` of the text, so it moves on a character at a
   * time instead of in jumps; nothing is redrawn until a character's shade changes.
   */
  show(share: number | null, soft = 0): void {
    if (!supported) return;
    // Each shade covers whole characters, so the edge moves on all at once.
    const step = Math.max(1, Math.round((soft * this.total) / SHADES));
    const fade = step * SHADES;
    // The edge runs on past the end by the fade, so it's all dim when the time is up.
    const at = share === null ? 0 : share * (this.total + fade) - 0.5;
    // Shade j (1 to SHADES - 1) is from cut(j) to cut(j - 1); fully dim is before cut(SHADES - 1).
    const cuts = Array.from({ length: SHADES }, (_, j) => Math.min(this.total, Math.max(0, Math.ceil(at - j * step))));
    const key = cuts.join();
    if (key === this.shown) return;
    this.shown = key;
    paint(NAME, this.ranges(0, cuts[SHADES - 1]));
    for (let j = 1; j < SHADES; j++) paint(`${NAME}-${j}`, this.ranges(cuts[j], cuts[j - 1]));
  }

  /** Ranges over the counted characters from `from` up to `to`. */
  private ranges(from: number, to: number): Range[] {
    const out: Range[] = [];
    if (from >= to) return out;
    let at = 0;
    for (const { node, count } of this.nodes) {
      if (at >= to) break;
      if (at + count > from) {
        const r = new Range();
        r.setStart(node, offsetOf(node.data, from - at));
        r.setEnd(node, offsetOf(node.data, to - at));
        out.push(r);
      }
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
    style.textContent = Array.from({ length: SHADES }, (_, j) => {
      const alpha = 1 - (dim * (j || SHADES)) / SHADES;
      return `::highlight(${j ? `${NAME}-${j}` : NAME}) { color: rgb(245 245 247 / ${alpha.toFixed(3)}); }`;
    }).join("\n");
  }
}
