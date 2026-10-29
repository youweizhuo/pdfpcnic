import assert from "node:assert/strict";
import { test } from "node:test";
import { audienceButton, audienceReady, guideLine } from "../src/core/guide.ts";

const status = (s) => ({ mode: "window", screen: null, remote: true, refused: false, ...s });
/** Before the talk, two screens, the audience window open. */
const at = (s = {}) => ({
  audience: status(),
  solo: false,
  oneScreen: false,
  system: "mac",
  clock: "idle",
  stale: false,
  startsAt: null,
  laser: false,
  lastPlanned: false,
  finished: false,
  comparing: null,
  ...s,
});

test("the audience's button: open it, then fullscreen where the presenter can, else double-click it", () => {
  assert.deepEqual(audienceButton(status({ mode: "closed" })), { action: "openAudience", label: "Open audience window", key: "o" });
  assert.deepEqual(audienceButton(status()), { action: "audienceFullscreen", label: "Audience fullscreen", key: "⇧W" });
  assert.deepEqual(audienceButton(status({ remote: false })), { action: "openAudience", label: "Double-click the audience window", key: "" });
  // Fullscreen, the same button takes it back.
  assert.equal(audienceButton(status({ mode: "fullscreen", remote: false })).action, "audienceFullscreen");
  assert.equal(audienceReady(status({ mode: "fullscreen" }), false), true);
  assert.equal(audienceReady(status(), false), false);
  assert.equal(audienceReady(status({ mode: "closed" }), true), true);
});

test("before the talk, in yellow: the audience's step, by the button that does it", () => {
  const next = (a) => guideLine(at({ audience: status(a) }));
  assert.deepEqual(next({ mode: "closed" }), { kind: "next", text: "Press o to open the audience window for the projector." });
  assert.equal(next({ screen: "DELL U2720Q" }).text, "Press ⇧W to make the audience window fullscreen on DELL U2720Q.");
  // Not knowing the screens, it goes fullscreen where it is: there first.
  assert.equal(next({}).text, "Drag the audience window to the projector, then press ⇧W.");
  assert.equal(next({ remote: false }).text, "Drag the audience window to the projector, then double-click it.");
});

test("then the clock, after where the audience is, or when the talk starts, in grey", () => {
  const fullscreen = status({ mode: "fullscreen", screen: "DELL U2720Q" });
  assert.deepEqual(guideLine(at({ audience: fullscreen })), {
    kind: "next",
    text: "Ready: press s to start the clock.",
    fact: "Audience fullscreen on DELL U2720Q",
  });
  const scheduled = guideLine(at({ audience: fullscreen, startsAt: { time: "14:00", in: "0:12:34" } }));
  assert.equal(scheduled.fact, "The talk starts at 14:00, in 0:12:34");
  // Presenting in this window: nothing to say where.
  assert.equal(guideLine(at({ audience: status({ mode: "closed" }), solo: true })).fact, undefined);
});

test("in orange, what no button fixes: one screen, by the system's keys, and a browser that says no", () => {
  const one = (system) => guideLine(at({ oneScreen: true, system }));
  assert.deepEqual(one("mac"), { kind: "blocked", text: "One screen only: connect the projector, or stop mirroring (⌘ + brightness down)." });
  assert.match(one("windows").text, /\(Win\+P\)\.$/);
  assert.match(one("linux").text, /\(Super\+P\)\.$/);
  assert.equal(one(null).text, "One screen only: connect the projector and extend the displays, not mirror.");
  // Mid-talk too, until the audience sees the slides.
  assert.equal(guideLine(at({ oneScreen: true, clock: "running" })).kind, "blocked");
  assert.equal(guideLine(at({ oneScreen: true, audience: status({ mode: "fullscreen" }) })).kind, "next");
  const refused = guideLine(at({ audience: status({ remote: false, refused: true }), clock: "running" }));
  assert.deepEqual(refused, { kind: "blocked", text: "This browser can't make it fullscreen from here: double-click the audience window." });
});

test("after a rehearsal, Reset; the audience's step first", () => {
  const fullscreen = status({ mode: "fullscreen" });
  const stale = guideLine(at({ audience: fullscreen, clock: "running", stale: true }));
  assert.deepEqual(stale, { kind: "next", text: "The clock has time from a rehearsal: click Reset before the talk." });
  assert.equal(guideLine(at({ clock: "running", stale: true })).text, "Drag the audience window to the projector, then press ⇧W.");
});

test("during the talk: paused and the laser in purple, the last planned slide in grey, else nothing", () => {
  const talk = (s) => guideLine(at({ audience: status({ mode: "fullscreen" }), clock: "running", ...s }));
  assert.equal(talk({}), null);
  assert.deepEqual(talk({ clock: "paused", laser: true }), { kind: "hint", text: "Paused: p or a click on the clock resumes; ⇧R resets." });
  assert.deepEqual(talk({ laser: true, lastPlanned: true }), { kind: "hint", text: "Laser on: + and − size the dot; l turns it off." });
  assert.deepEqual(talk({ lastPlanned: true }), { kind: "fact", text: "Last planned slide: backup slides follow." });
  // An audience window closed mid-talk is left to its button.
  assert.equal(guideLine(at({ audience: status({ mode: "closed" }), clock: "running" })), null);
});

test("at the end of a run, in purple, a click on the line saves its times", () => {
  const end = (s) => guideLine(at({ audience: status({ mode: "fullscreen" }), clock: "running", finished: true, ...s }));
  assert.deepEqual(end({ lastPlanned: true }), { kind: "hint", text: "Click here to save this run's times, to compare with the plan.", action: "saveRun" });
  assert.equal(end({ clock: "paused" }).action, "saveRun", "paused at the end, saving comes first");
});

test("comparing two plans, the line names the other file, before anything else", () => {
  const line = guideLine(at({ oneScreen: true, comparing: "talk-20261028-1405.pdfpc" }));
  assert.deepEqual(line, { kind: "hint", text: "Comparing with talk-20261028-1405.pdfpc." });
});
