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

test("a note's timing line becomes the page's plan, and comes off the note", () => {
  const d = deck(["1", "2"], { meta: pdfpc({ 0: "**01:22 → 01:58** · 36 s\nSay hello.", 1: "**45 s**\nBackup." }) });
  assert.deepEqual(d.pages[0].plan, { start: 82, end: 118 });
  assert.equal(d.pages[0].note, "Say hello.");
  assert.equal(d.pages[1].length, 45);
  assert.equal(d.pages[1].note, "Backup.");
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
