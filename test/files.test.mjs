// The .pdfpc reader, timing lines, the clock and the keys.

import assert from "node:assert/strict";
import { test } from "node:test";
import { actionFor, isTalkAction, keyName } from "../src/core/keys.ts";
import { grade, SLACK, splitPlan } from "../src/core/pace.ts";
import { parsePdfpc } from "../src/core/pdfpc.ts";
import * as T from "../src/core/timer.ts";
import { at } from "./decks.mjs";

test(".pdfpc: reads pdfpcFormat 2, dropping what doesn't fit the schema", () => {
  const f = parsePdfpc(
    JSON.stringify({ pdfpcFormat: 2, duration: 20, endTime: "25:00", noteFontSize: -3, pages: [{ idx: 0, label: "1", note: "Hi" }, { label: "no index" }] }),
  );
  assert.equal(f.duration, 20);
  assert.equal(f.endTime, undefined);
  assert.equal(f.noteFontSize, undefined);
  assert.deepEqual(f.pages, [{ idx: 0, label: "1", overlay: undefined, forcedOverlay: undefined, hidden: undefined, note: "Hi" }]);
});

test(".pdfpc: says what's wrong with a file it can't read", () => {
  assert.throws(() => parsePdfpc("not json"), /isn't valid JSON/);
  assert.throws(() => parsePdfpc("[file]\nslides.pdf"), /old-style \.pdfpc file/);
  assert.throws(() => parsePdfpc('{"pdfpcFormat": 1}'), /Unsupported pdfpcFormat 1/);
});

test("timing lines: a window, a moment, a backup slide's length; or none", () => {
  assert.deepEqual(splitPlan("**01:22 -> 61:05**\nrest"), { plan: { start: 82, end: 3665 }, length: null, note: "rest" });
  assert.deepEqual(splitPlan("**02:00**"), { plan: { start: 120, end: 120 }, length: null, note: "" });
  assert.deepEqual(splitPlan("**45 s**\nbackup"), { plan: null, length: 45, note: "backup" });
  assert.equal(splitPlan("Intro **01:00**").plan, null);
  assert.equal(splitPlan("**02:00 → 01:00**").plan, null, "a window that ends before it starts");
});

test("pace levels: early only past the slack, late always, deeper as it gets serious", () => {
  assert.equal(grade(-30, 600, SLACK.time), "on");
  assert.equal(grade(-90, 600, SLACK.time), "early");
  assert.equal(grade(10, 600, SLACK.time), "late");
  assert.equal(grade(60, 600, SLACK.time), "serious");
  assert.equal(grade(120, 600, SLACK.time), "severe");
  assert.equal(grade(20, 600, SLACK.share), "serious", "3% of a 10-minute talk is 18 s");
});

test("the clock counts the time not paused", () => {
  let t = T.start(T.freshTimer(), 0);
  t = T.togglePause(t, 10_000);
  assert.equal(T.elapsed(t, 50_000), 10_000);
  t = T.togglePause(t, 60_000);
  assert.equal(T.elapsed(t, 70_000), 20_000);
  assert.equal(T.format(3_725_000), "1:02:05");
  assert.deepEqual([600_000, 550_000, 30_000, 3_725_000].map(T.formatShort), ["10:00", "9:10", "0:30", "1:02:05"]);
});

test("the talk's length: from its end time if set, else its duration", () => {
  const times = { duration: 20, startTime: "10:00", endTime: "10:45" };
  assert.equal(T.talkLength(T.freshTimer(), times, at(9, 0)), 45 * 60_000, "from the start time, before the clock starts");
  assert.equal(T.talkLength(T.start(T.freshTimer(), at(10, 5)), times, at(10, 6)), 40 * 60_000);
  assert.equal(T.talkLength(T.freshTimer(), { duration: 20 }, at(9, 0)), 20 * 60_000);
  assert.equal(T.untilStart(times, at(9, 30)), 30 * 60_000);
});

test("keys: pdfpc's bindings, read the same whatever the case or the Shift for symbols", () => {
  const key = (key, mods = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
  assert.equal(keyName(key("PageDown", { shiftKey: true })), "Shift+PageDown");
  assert.equal(keyName(key("T", { ctrlKey: true, shiftKey: true })), "Ctrl+Shift+t");
  assert.equal(actionFor(key("?", { shiftKey: true })), "help");
  assert.equal(actionFor(key("W", { shiftKey: true })), "audienceFullscreen");
  assert.equal(actionFor(key("o", { metaKey: true })), null, "Cmd is left to the browser");
  assert.equal(isTalkAction("next"), true);
  assert.equal(isTalkAction("openAudience"), false);
});
