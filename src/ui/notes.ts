import DOMPurify from "dompurify";
import { marked } from "marked";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** Fills `el` with a note: Markdown (as pdfpc renders it) or plain text. From the first `[ref]` to its end it's a reference, not spoken. */
export function renderNote(el: HTMLElement, note: string, markdown: boolean): void {
  el.classList.toggle("plain", !markdown);
  const at = note.indexOf("[ref]");
  const said = at < 0 ? note : note.slice(0, at);
  const ref = at < 0 ? "" : note.slice(at).replaceAll("[ref]", "").trim();
  if (!markdown) {
    el.textContent = said;
    if (ref) {
      const block = document.createElement("div");
      block.className = "ref";
      block.textContent = `ref ${ref}`;
      el.append(block);
    }
    return;
  }
  const md = (text: string) => marked.parse(text, { async: false, gfm: true });
  el.innerHTML = DOMPurify.sanitize(md(said) + (ref ? `<div class="ref">${md(`*ref* ${ref}`)}</div>` : ""));
}
