// The .pdfpc reader, timing lines, the clock and the keys.

import assert from "node:assert/strict";
import { test } from "node:test";
import { actionFor, isIgnored, isTalkAction, keyName } from "../src/core/keys.ts";
import { grade, SLACK, layOut, readNote, readOldNote, slideLength } from "../src/core/pace.ts";
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

test("a note's length: seconds or minutes, at its start, on its first line or its own", () => {
  assert.deepEqual(readNote("[36s] Hello."), { seconds: 36, note: "Hello.", said: "[36s] Hello." });
  assert.equal(readNote("[36s]\n\nHello.").note, "Hello.");
  assert.equal(readNote("  [ 45 s ] Hello.").seconds, 45);
  assert.equal(readNote("[1.5min]").seconds, 90);
  assert.equal(readNote("[0s]").seconds, 0);
  for (const text of ["See [36s] here.", "[36 sec] typo", "[36] cite", "[ref] Table 3."]) {
    assert.deepEqual(readNote(text).seconds, null, text);
    assert.equal(readNote(text).note, text);
  }
  assert.equal(readNote("[9s] Same.\n\n[ref] One.").said, readNote("[9s] Same.\n\n[ref] Two.").said, "references don't make it another note");
});

test("the plan: lengths add up through the end slide; a slide with none takes no time", () => {
  const pages = [36, null, 20, null, 10, 45].map((seconds) => ({ seconds }));
  const slides = [[0], [1, 2, 3], [4], [5]];
  assert.deepEqual(layOut(pages, slides, 2), {
    timed: true,
    pages: [{ start: 0, end: 36 }, null, { start: 36, end: 56 }, { start: 36, end: 56 }, { start: 56, end: 66 }, null],
    slides: [{ start: 0, end: 36 }, { start: 36, end: 56 }, { start: 56, end: 66 }, null],
    end: 66,
  });
  assert.equal(layOut(pages, slides, 3).end, 111);
  assert.equal(layOut([{ seconds: null }], [[0]], 0).timed, false);
  assert.equal(slideLength(pages, slides[3]), 45);
});

test("deprecated: old timing lines read as lengths; a window's length only", () => {
  assert.deepEqual(readOldNote("**01:22 -> 61:05**\nrest").seconds, 3583);
  assert.equal(readOldNote("**01:22 -> 61:05**\nrest").note, "rest");
  assert.equal(readOldNote("**02:00**").seconds, 0);
  assert.equal(readOldNote("**45 s**\nbackup").seconds, 45);
  assert.equal(readOldNote("Intro **01:00**").seconds, null);
  assert.equal(readOldNote("**02:00 → 01:00**").seconds, null, "a window that ends before it starts");
  assert.equal(readOldNote("Said.\n\n*ref* A.\n\n*ref* B.").note, "Said.\n\n[ref] A.\n\n[ref] B.");
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
  // A presentation remote's black button, and its start button, which a browser would reload on.
  assert.equal(actionFor(key(".")), "blank");
  assert.equal(actionFor(key("b")), "blank");
  assert.equal(actionFor(key("Escape")), "escape");
  assert.equal(isIgnored(key("F5")), true);
  assert.equal(isIgnored(key("F5", { shiftKey: true })), true);
  assert.equal(isIgnored(key("F5", { ctrlKey: true })), false, "Ctrl+F5 still reloads");
  assert.equal(isIgnored(key("F5", { metaKey: true })), false);
  assert.equal(isIgnored(key("r", { ctrlKey: true })), false);
  assert.equal(isTalkAction("next"), true);
  assert.equal(isTalkAction("openAudience"), false);
});
