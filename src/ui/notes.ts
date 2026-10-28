import DOMPurify from "dompurify";
import { marked } from "marked";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** A paragraph that opens with *ref* is a reference, not spoken (TokenSlides' convention). */
function isRef(block: Element): boolean {
  const first = [...block.childNodes].find((n) => n.nodeType !== Node.TEXT_NODE || n.textContent!.trim());
  return first instanceof HTMLElement && first.tagName === "EM" && first.textContent!.trim().toLowerCase() === "ref";
}

/** Fills `el` with a note: Markdown (as pdfpc renders it) or plain text. References are marked `ref`. */
export function renderNote(el: HTMLElement, note: string, markdown: boolean): void {
  el.classList.toggle("plain", !markdown);
  if (!markdown) {
    el.textContent = note;
    return;
  }
  const html = marked.parse(note, { async: false, gfm: true });
  el.innerHTML = DOMPurify.sanitize(html);
  for (const block of el.querySelectorAll("p, li")) block.classList.toggle("ref", isRef(block));
}
