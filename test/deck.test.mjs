import assert from "node:assert/strict";
import { test } from "node:test";
import { deck, pdfpc } from "./decks.mjs";

test("pages that share a label are one slide, its reveal steps", () => {
  const d = deck(["1", "2", "2", "3"]);
  assert.deepEqual(d.slides, [[0], [1, 2], [3]]);
  assert.equal(d.pages[2].slide, 1);
  assert.equal(d.pages[2].step, 1);
  assert.equal(d.endSlide, 2);
});

test("without labels, each page is a slide, labeled by its number", () => {
  const d = deck([null, null, null]);
  assert.deepEqual(d.slides, [[0], [1], [2]]);
  assert.deepEqual(
    d.pages.map((p) => p.label),
    ["1", "2", "3"],
  );
});

test("a forced overlay joins the slide before it, whatever its label", () => {
  const d = deck(["1", "2", "3"], { meta: { pages: [{ idx: 2, label: "3", forcedOverlay: true }] } });
  assert.deepEqual(d.slides, [[0], [1, 2]]);
});

test("notes in the PDF win over the .pdfpc file's", () => {
  const d = deck(["1", "2"], { meta: pdfpc({ 0: "from pdfpc", 1: "only pdfpc" }), notes: ["from the PDF"] });
  assert.equal(d.pages[0].note, "from the PDF");
  assert.equal(d.pages[1].note, "only pdfpc");
});

test("a note's length becomes the page's seconds, and comes off the note", () => {
  const d = deck(["1", "2", "3"], { meta: pdfpc({ 0: "[36s] Say hello.", 1: "[45s]\n\nBackup.", 2: "See [9s] here." }) });
  assert.equal(d.pages[0].seconds, 36);
  assert.equal(d.pages[0].note, "Say hello.");
  assert.equal(d.pages[1].seconds, 45);
  assert.equal(d.pages[1].note, "Backup.");
  assert.equal(d.pages[2].seconds, null, "only at the note's start");
  assert.equal(d.pages[2].note, "See [9s] here.");
});

test("a note repeated on a slide's steps counts once; a step with another note adds its own", () => {
  // As Touying exports a note on a slide with reveal steps: the same text on each.
  const d = deck(["1", "1", "1", "2", "2"], {
    meta: pdfpc({ 0: "[20s] Same.", 1: "[20s] Same.", 2: "[20s] Same.\n\n[ref] Only here.", 3: "[10s] First.", 4: "[10s] Second." }),
  });
  assert.deepEqual(d.pages.map((p) => p.seconds), [20, null, null, 10, 10]);
});

test("a hidden page takes no time, even if a step after it repeats its note", () => {
  const meta = { pages: [{ idx: 0, label: "1", note: "[20s] Same.", hidden: true }, { idx: 1, label: "1", overlay: 1, note: "[20s] Same." }, { idx: 2, label: "2", note: "[30s] Gone.", hidden: true }] };
  assert.deepEqual(deck(["1", "1", "2"], { meta }).pages.map((p) => p.seconds), [null, 20, null]);
});

test("deprecated: a file with no lengths is read by its old timing lines", () => {
  const d = deck(["1", "2", "2", "3", "4"], {
    meta: pdfpc({ 0: "**00:00 → 00:36** · 36 s\n\nHello.\n\n*ref* Table 3.", 1: "**00:36 → 01:06**", 2: "**00:36 → 01:06**", 3: "**01:06**", 4: "**45 s**\nBackup." }),
  });
  assert.deepEqual(d.pages.map((p) => p.seconds), [36, 30, null, 0, 45]);
  assert.equal(d.pages[0].note, "Hello.\n\n[ref] Table 3.");
  assert.equal(d.pages[4].note, "Backup.");
  // One length anywhere and the old lines are just text.
  const mixed = deck(["1", "2"], { meta: pdfpc({ 0: "[9s] New.", 1: "**45 s**\nOld." }) });
  assert.deepEqual(mixed.pages.map((p) => [p.seconds, p.note]), [[9, "New."], [null, "**45 s**\nOld."]]);
});

test("a .pdfpc entry is found by its label when its index doesn't match", () => {
  const d = deck(["1", "2", "2", "3"], { meta: { pages: [{ idx: 7, label: "2", overlay: 1, note: "second step" }] } });
  assert.equal(d.pages[2].note, "second step");
  assert.deepEqual(d.warnings, []);
});

test("entries past the end of the PDF are counted in a warning", () => {
  const d = deck(["1"], { meta: pdfpc({ 3: "lost", 4: "lost" }) });
  assert.match(d.warnings[0], /^2 pages in the \.pdfpc file are past the end of the PDF/);
});

test("the end and bookmarked slides stay inside the deck", () => {
  const d = deck(["1", "2", "3"], { meta: { pages: [], endSlide: 9, savedSlide: 1 } });
  assert.equal(d.endSlide, 2);
  assert.equal(d.savedSlide, 1);
});

test("the outline's top level makes sections, each from the slide its page is on", () => {
  // Pages 2 and 3 are one slide's reveal steps; the second section opens on its second step.
  const d = deck(["1", "2", "2", "3", "4", "5"], {
    outline: [
      { title: "1. Intro", page: 1 },
      { title: "2. Method ", page: 2 },
    ],
  });
  assert.deepEqual(d.sections, [{ title: "1. Intro", slide: 1 }]);
  const e = deck(["1", "2", "3", "4", "5", "6"], { outline: [{ title: "Intro", page: 1 }, { title: "Results", page: 4 }] });
  assert.deepEqual(e.sections, [
    { title: "Intro", slide: 1 },
    { title: "Results", slide: 4 },
  ]);
});

test("an outline that names most slides isn't sections, nor is one without titles or pages", () => {
  assert.deepEqual(deck(["1", "2", "3", "4"], { outline: [1, 2, 3].map((page) => ({ title: `Slide ${page}`, page })) }).sections, []);
  assert.deepEqual(deck(["1", "2", "3", "4", "5", "6"], { outline: [{ title: " ", page: 1 }, { title: "Late", page: 9 }] }).sections, []);
  assert.deepEqual(deck(["1", "2"]).sections, []);
});
