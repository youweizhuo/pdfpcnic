import assert from "node:assert/strict";
import { test } from "node:test";
import { SLACK } from "../src/core/pace.ts";
import { Talk } from "../src/core/talk.ts";
import { deck, pdfpc } from "./decks.mjs";

const T0 = 1_000_000_000_000;
const sec = (s) => T0 + s * 1000;

test("next steps through the visible pages, and leaving the first one starts the clock", () => {
  const talk = new Talk(deck(["1", "2", "3"], { meta: { pages: [{ idx: 1, hidden: true }] } }), undefined, T0);
  assert.equal(talk.state.timer.startedAt, null);
  talk.act("next", sec(5));
  assert.equal(talk.state.page, 2);
  assert.equal(talk.state.timer.startedAt, sec(5));
});

test("back steps through reveal steps, then jumps to the previous slide's first step", () => {
  const talk = new Talk(deck(["1", "2", "2", "2", "3"]), undefined, T0);
  talk.go(4);
  talk.act("prev");
  assert.equal(talk.state.page, 1, "from the next slide, to this one's first step (pdfpc's rule)");
  talk.go(3);
  talk.act("prev");
  assert.equal(talk.state.page, 2);
  assert.equal(talk.nextPage(), 4);
});

test("a jump can be undone with back and redone with forward", () => {
  const talk = new Talk(deck(["1", "2", "3", "4"]), undefined, T0);
  talk.act("last");
  assert.equal(talk.state.page, 3);
  talk.act("back");
  assert.equal(talk.state.page, 0);
  talk.act("forward");
  assert.equal(talk.state.page, 3);
});

test("links go to their page, or do what their named action says", () => {
  const talk = new Talk(deck(["1", "2", "3"]), undefined, T0);
  talk.follow({ page: 2 });
  assert.equal(talk.state.page, 2);
  talk.follow({ action: "GoBack" });
  assert.equal(talk.state.page, 0);
  talk.follow({ action: "NextPage" });
  assert.equal(talk.state.page, 1);
  talk.follow({ url: "https://example.com/" });
  assert.equal(talk.state.page, 1);
});

test("reset only while paused: a stray key can't zero the clock mid-talk", () => {
  const talk = new Talk(deck(["1", "2"]), undefined, T0);
  talk.act("next", sec(0));
  assert.match(talk.act("timerReset", sec(10)), /Pause it first/);
  assert.equal(talk.state.timer.startedAt, sec(0));
  talk.act("timerPause", sec(10));
  assert.match(talk.act("timerReset", sec(11)), /^Clock reset/);
  assert.equal(talk.state.timer.startedAt, null);
});

test("the room sees the frozen page, black, and the laser only on the page it shows", () => {
  const talk = new Talk(deck(["1", "2", "3"]), undefined, T0);
  assert.equal(talk.point({ x: 0.5, y: 0.5 }), false, "the laser is off");
  talk.act("laserMode");
  assert.equal(talk.point({ x: 0.5, y: 0.5 }), true);
  talk.act("freeze");
  talk.act("next");
  assert.deepEqual(talk.audience, { page: 0, black: false, laser: null });
  talk.act("prev");
  assert.deepEqual(talk.audience, { page: 0, black: false, laser: { x: 0.5, y: 0.5 } });
  talk.act("blank");
  talk.act("escape");
  assert.deepEqual(talk.audience, { page: 0, black: false, laser: null });
  assert.equal(talk.state.frozen, null);
});

test("back on slide 1 with time on the clock, the talk looks stale", () => {
  const talk = new Talk(deck(["1", "2"]), undefined, T0);
  assert.equal(talk.stale, false);
  talk.act("next", sec(0));
  talk.act("prev", sec(30));
  assert.equal(talk.stale, true);
});

/** Three slides planned for 1, 2 and 1 minutes. */
const timed = () =>
  deck(["1", "2", "3"], { meta: pdfpc({ 0: "**00:00 → 01:00**", 1: "**01:00 → 03:00**", 2: "**03:00 → 04:00**" }) });

test("pace: this slide against its window, the talk against its end", () => {
  const talk = new Talk(timed(), undefined, T0);
  let p = talk.progress(T0, SLACK.time);
  assert.equal(p.started, false);
  assert.equal(p.planned, 240);
  assert.equal(p.target, 240);
  assert.equal(p.slide.tone, "idle");
  assert.deepEqual(p.segments, [
    { slide: 0, start: 0, end: 60 },
    { slide: 1, start: 60, end: 180 },
    { slide: 2, start: 180, end: 240 },
  ]);

  talk.act("next", T0);
  talk.progress(T0, SLACK.time);
  p = talk.progress(sec(90), SLACK.time);
  assert.equal(p.slide.over, -30);
  assert.equal(p.late, -90, "moving on now ends the talk 1:30 early");
  assert.equal(p.tone, "early");
  assert.equal(talk.used(sec(90)), 0.75);

  p = talk.progress(sec(200), SLACK.time);
  assert.equal(p.slide.over, 80);
  assert.equal(p.slide.tone, "serious");
  assert.equal(p.late, 20);
  assert.equal(p.tone, "late");
});

test("a slide keeps its time over visits", () => {
  const talk = new Talk(timed(), undefined, T0);
  talk.act("next", T0);
  talk.progress(T0, SLACK.time);
  talk.act("prev", sec(100));
  talk.progress(sec(100), SLACK.time);
  talk.act("next", sec(110));
  assert.equal(talk.progress(sec(120), SLACK.time).slide.over, 110 - 120, "100 s before, 10 s now, of 120");
});

test("moving the end slide changes the plan and the bar", () => {
  const talk = new Talk(timed(), undefined, T0);
  talk.act("next");
  talk.act("endSlide");
  assert.deepEqual(talk.onBar, [0, 1]);
  assert.equal(talk.progress(T0, SLACK.time).planned, 180);
});

test("a talk without timing lines splits its length evenly", () => {
  const talk = new Talk(deck(["1", "2", "3", "4"], { meta: { pages: [], duration: 20 } }), undefined, T0);
  const p = talk.progress(T0, SLACK.time);
  assert.equal(p.planned, 1200);
  assert.deepEqual(p.segments[1], { slide: 1, start: 300, end: 600 });
});

test("a reload picks up the talk where it was, with its time per slide", () => {
  const d = timed();
  const talk = new Talk(d, undefined, T0);
  talk.act("next", T0);
  talk.progress(T0, SLACK.time);
  const saved = talk.save(sec(30));
  assert.deepEqual(saved.spent, { "1:60:180": 30 });

  const again = new Talk(d, saved, sec(40));
  assert.equal(again.state.page, 1);
  assert.equal(again.state.timer.startedAt, T0);
  again.progress(sec(40), SLACK.time);
  assert.equal(again.progress(sec(50), SLACK.time).slide.over, 30 + 10 - 120);
});

test("an old or another deck's session starts afresh", () => {
  const d = timed();
  const saved = new Talk(d, undefined, T0).save(T0);
  assert.equal(new Talk(d, { ...saved, page: 2 }, T0 + 9 * 3600_000).state.page, 0);
  assert.equal(new Talk(d, { ...saved, page: 2, pdfName: "other.pdf" }, T0).state.page, 0);
  assert.equal(new Talk(d, { ...saved, page: 2 }, T0).state.page, 2);
});
