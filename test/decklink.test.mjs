import assert from "node:assert/strict";
import { test } from "node:test";
import { deckToken } from "../src/core/decklink.ts";
import { fetchDeck } from "../src/web/decks.ts";
import { newestFiles, newToken, nextVersion, pairFiles } from "../deploy/upload/names.js";

const file = (name) => ({ name });

test("a token on this page's own server", () => {
  for (const text of ["k3j9x2", "#k3j9x2", " K3J9X2 "]) {
    assert.equal(deckToken(text), "k3j9x2", text);
  }
});

test("what names no deck", () => {
  for (const text of ["", " ", "#", "k3j9", "k3j9x2x", "k3j0x2", "https://example.com/#k3j9x2", "two words/#k3j9x2"]) {
    assert.equal(deckToken(text), null, text);
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
    assert.equal(deckToken(token), token);
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

test("fetchDeck checks file HTTP status and reports download progress", async () => {
  const realFetch = globalThis.fetch;
  const realLocation = globalThis.location;
  globalThis.location = new URL("https://slides.example.com/slides/#k3j9x2");
  const token = "k3j9x2";
  try {
    // A 502 on the PDF itself fails clearly instead of passing an error page as a PDF.
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/k3j9x2/")) return new Response(JSON.stringify([{ name: "talk.pdf" }]), { status: 200 });
      return new Response("Bad Gateway", { status: 502 });
    };
    await assert.rejects(() => fetchDeck(token), /answered 502 for talk\.pdf/);

    // Streaming progress reports bytes and percentage, and returns the whole file.
    const chunks = [new Uint8Array(600_000).fill(1), new Uint8Array(600_000).fill(2)];
    globalThis.fetch = async (url) => {
      const u = String(url);
      assert.ok(u.startsWith("https://slides.example.com/slides/decks/"));
      if (u.endsWith("/k3j9x2/")) return new Response(JSON.stringify([{ name: "talk.pdf" }, { name: "talk.pdfpc" }]), { status: 200 });
      if (u.endsWith("/talk.pdfpc")) return new Response('{"pdfpcFormat":2,"pages":[]}', { status: 200 });
      const stream = new ReadableStream({
        start(c) {
          for (const chunk of chunks) c.enqueue(chunk);
          c.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-length": "1200000" } });
    };
    const seen = [];
    const files = await fetchDeck(token, (progress) => seen.push(progress));
    assert.deepEqual(files.map((f) => [f.name, f.size]), [["talk.pdf", 1_200_000], ["talk.pdfpc", 28]]);
    assert.deepEqual(seen.slice(0, 3), [
      { name: "talk.pdf", received: 0, total: 0 },
      { name: "talk.pdf", received: 600_000, total: 1_200_000 },
      { name: "talk.pdf", received: 1_200_000, total: 1_200_000 },
    ]);
  } finally {
    globalThis.fetch = realFetch;
    if (realLocation === undefined) delete globalThis.location;
    else globalThis.location = realLocation;
  }
});
