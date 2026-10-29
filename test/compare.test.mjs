import assert from "node:assert/strict";
import { test } from "node:test";
import { otherPages, plansOf, runFile, runName, wordDiff, words } from "../src/core/compare.ts";
import { parsePdfpc } from "../src/core/pdfpc.ts";
import { Talk } from "../src/core/talk.ts";
import { deck, pdfpc } from "./decks.mjs";

const T0 = 1_000_000_000_000;
const sec = (s) => T0 + s * 1000;

/** Three slides, the second with two reveal steps, then a backup slide: planned for 1, 2 and 1 minutes. */
const planned = () =>
  deck(["1", "2", "2", "3", "4"], {
    meta: pdfpc({ 0: "**00:00 → 01:00**\n\nHello.", 1: "**01:00 → 03:00**", 2: "**01:00 → 03:00**", 3: "**03:00 → 04:00**", 4: "**45 s**" }, { endSlide: 2 }),
  });

test("a run's times as a .pdfpc file: each slide's window as long as the run took, in the slides' order", () => {
  const d = planned();
  const talk = new Talk(d, undefined, T0);
  talk.act("next", sec(0));
  talk.act("next", sec(70));
  talk.act("next", sec(100));
  talk.act("next", sec(200));
  assert.deepEqual(talk.spentBySlide(sec(260)), [0, 100, 100, 60], "the clock started on leaving slide 1; reveal steps count to their slide");
  const text = runFile(d, 2, talk.spentBySlide(sec(260)));
  const file = parsePdfpc(text);
  assert.equal(file.endSlide, 2);
  assert.deepEqual(
    file.pages.map((p) => [p.label, p.overlay, p.note]),
    [
      ["1", 0, "**00:00**"],
      ["2", 0, "**00:00 → 01:40** · 100 s"],
      ["2", 1, "**00:00 → 01:40** · 100 s"],
      ["3", 0, "**01:40 → 03:20** · 100 s"],
      ["4", 0, "**60 s**"],
    ],
  );
  // Read back onto the deck, it's a plan like any other.
  const run = plansOf("run.pdfpc", otherPages(d, file), d, 2);
  assert.deepEqual(run.lengths, [0, 100, 100, 60]);
  assert.equal(run.end, 200);
  assert.deepEqual(run.notes, ["", "", "", "", ""], "only times: the notes are the deck's");
});

test("the deck's plan and another, slide by slide: windows, lengths, notes", () => {
  const d = planned();
  const ours = plansOf("talk.pdfpc", d.pages, d, 2);
  assert.deepEqual(ours.windows, [{ start: 0, end: 60 }, { start: 60, end: 180 }, { start: 180, end: 240 }, null]);
  assert.deepEqual(ours.lengths, [60, 120, 60, 45], "a backup slide by its length");
  assert.equal(ours.end, 240);
  assert.equal(ours.notes[0], "Hello.");
  // A slide moved to the backup slides is off the plan.
  assert.equal(plansOf("talk.pdfpc", d.pages, d, 1).end, 180);
  // Without timing lines, the talk's length split evenly.
  const even = deck(["1", "2"], { meta: pdfpc({}, { duration: 10 }) });
  assert.deepEqual(plansOf("x", even.pages, even, 1).lengths, [300, 300]);
  // The other file goes by the deck's slides, whatever its own say.
  const other = otherPages(d, parsePdfpc(JSON.stringify({ pdfpcFormat: 2, pages: [{ idx: 2, note: "**01:00 → 04:00**\n\nMore." }] })));
  assert.deepEqual(plansOf("v2.pdfpc", other, d, 2).windows[1], { start: 60, end: 240 });
  assert.equal(other[2].note, "More.");
});

test("the run file is named for the PDF and when it was saved", () => {
  assert.equal(runName("talk.pdf", new Date(2026, 9, 28, 14, 5)), "talk-20261028-1405.pdfpc");
});

test("a word diff of two notes: what each has that the other doesn't, Chinese by the character", () => {
  assert.deepEqual(
    words("Don't stop — it's 2.5 x").map((w) => w.word),
    ["Don't", "stop", "—", "it's", "2", ".", "5", "x"],
  );
  assert.deepEqual(
    words("中文和Markdown。").map((w) => w.word),
    ["中", "文", "和", "Markdown", "。"],
  );
  const a = words("The clock starts when you leave this page").map((w) => w.word);
  const b = words("The clock starts at your first move").map((w) => w.word);
  const { removed, added } = wordDiff(a, b);
  assert.deepEqual(removed.map((i) => a[i]), ["when", "you", "leave", "this", "page"]);
  assert.deepEqual(added.map((i) => b[i]), ["at", "your", "first", "move"]);
  assert.deepEqual(wordDiff(a, a), { removed: [], added: [] });
});
