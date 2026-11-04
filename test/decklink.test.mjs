import assert from "node:assert/strict";
import { test } from "node:test";
import { deckLink, newestFiles } from "../src/core/decklink.ts";
import { newToken, nextVersion, pairFiles } from "../deploy/upload/names.js";

const file = (name) => ({ name });

test("a token on this page's own server", () => {
  for (const text of ["k3j9x2", "#k3j9x2", " K3J9X2 "]) {
    assert.deepEqual(deckLink(text), { server: "", token: "k3j9x2" }, text);
  }
});

test("a server's link, however it's pasted", () => {
  for (const text of ["https://pdfpcnic.youwei.xyz/#k3j9x2", "pdfpcnic.youwei.xyz/#k3j9x2", "pdfpcnic.youwei.xyz#k3j9x2", " https://pdfpcnic.youwei.xyz/#K3J9X2 "]) {
    assert.deepEqual(deckLink(text), { server: "https://pdfpcnic.youwei.xyz/", token: "k3j9x2" }, text);
  }
  assert.deepEqual(deckLink("https://example.com/slides/#k3j9x2"), { server: "https://example.com/slides/", token: "k3j9x2" });
  assert.deepEqual(deckLink("localhost:28613/#k3j9x2"), { server: "https://localhost:28613/", token: "k3j9x2" });
  assert.deepEqual(deckLink("http://127.0.0.1:28613/#k3j9x2"), { server: "http://127.0.0.1:28613/", token: "k3j9x2" });
});

test("what names no deck", () => {
  for (const text of ["", " ", "#", "k3j9", "k3j9x2x", "k3j0x2", "https://example.com/", "https://example.com/page.html", "https://example.com/talk.pdf", "two words/#k3j9x2", "ftp://x.org/#k3j9x2", "javascript:alert(1)//#k3j9x2"]) {
    assert.equal(deckLink(text), null, text);
  }
});

test("the highest version opens, with the notes of that version alone", () => {
  assert.deepEqual(newestFiles(["talk.pdf", "talk.pdfpc"]), { pdf: "talk.pdf", notes: "talk.pdfpc" });
  assert.deepEqual(newestFiles(["talk.pdf"]), { pdf: "talk.pdf" });
  assert.deepEqual(newestFiles(["talk.pdf", "talk.pdfpc", "talk.v2.pdf", "talk.v2.pdfpc", "talk.v10.pdf", "talk.v10.pdfpc"]), { pdf: "talk.v10.pdf", notes: "talk.v10.pdfpc" });
  assert.deepEqual(newestFiles(["talk.pdf", "talk.pdfpc", "talk.v2.pdf"]), { pdf: "talk.v2.pdf" }, "old notes don't reach a changed deck");
  assert.deepEqual(newestFiles(["My Talk v2 final.pdf"]), { pdf: "My Talk v2 final.pdf" }, "a name's own v2 isn't a version");
  assert.equal(newestFiles(["talk.pdfpc"]), null);
  assert.equal(newestFiles([]), null);
});

test("what's uploaded as a next version is what opens next", () => {
  let names = ["talk.pdf", "talk.pdfpc"];
  for (const [stem, version] of [["talk.v2", 2], ["talk.v3", 3]]) {
    assert.equal(nextVersion(names), stem);
    names = [...names, `${stem}.pdf`];
    assert.equal(newestFiles(names).pdf, `talk.v${version}.pdf`);
  }
  assert.equal(nextVersion(["a.v9.pdf", "a.pdf"]), "a.v10");
  assert.equal(nextVersion(["My Long Talk Final.pdf"]), "My Long Talk Final.v2");
});

test("tokens: six characters a link accepts, without look-alikes", () => {
  for (let i = 0; i < 500; i++) {
    const token = newToken();
    assert.match(token, /^[a-z2-9]{6}$/);
    assert.doesNotMatch(token, /[ilo]/);
    assert.equal(deckLink(token).token, token);
  }
});

test("files dropped together become decks", () => {
  const pair = (...names) => pairFiles(names.map(file)).map((d) => [d.pdf.name, d.notes?.name]);
  assert.deepEqual(pair("a.pdf"), [["a.pdf", undefined]]);
  assert.deepEqual(pair("a.pdf", "a.pdfpc"), [["a.pdf", "a.pdfpc"]]);
  assert.deepEqual(pair("a.pdf", "other.pdfpc"), [["a.pdf", "other.pdfpc"]], "the only PDF takes the only notes");
  assert.deepEqual(pair("a.pdf", "b.pdf", "b.pdfpc"), [["a.pdf", undefined], ["b.pdf", "b.pdfpc"]]);
  assert.throws(() => pair("a.pdfpc"), /Add the PDF/);
  assert.throws(() => pair("a.pdf", "b.pdf", "c.pdfpc"), /c\.pdfpc has no PDF/);
  assert.throws(() => pair("a.pdf", "a.html"), /neither/);
});
