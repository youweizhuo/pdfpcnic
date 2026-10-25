import DOMPurify from "dompurify";
import { marked } from "marked";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** Fills `el` with a note: Markdown (as pdfpc renders it) or plain text. */
export function renderNote(el: HTMLElement, note: string, markdown: boolean): void {
  el.classList.toggle("plain", !markdown);
  if (!markdown) {
    el.textContent = note;
    return;
  }
  const html = marked.parse(note, { async: false, gfm: true });
  el.innerHTML = DOMPurify.sanitize(html);
}
