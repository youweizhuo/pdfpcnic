import assert from "node:assert/strict";
import { test } from "node:test";
import { audienceReady, guideLine } from "../src/core/guide.ts";

const status = (s) => ({ mode: "window", screen: null, remote: true, refused: false, ...s });
const projector = { button: "Projector" };
const sharing = { button: "Sharing" };
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

test("the audience is ready fullscreen or in solo mode, but not in an ordinary window", () => {
  assert.equal(audienceReady(status({ mode: "fullscreen" }), false), true);
  assert.equal(audienceReady(status(), false), false);
  assert.equal(audienceReady(status({ mode: "closed" }), true), true);
});

test("before the talk, in yellow: the audience's step, by the button that does it", () => {
  const next = (a) => guideLine(at({ audience: status(a) }));
  assert.deepEqual(next({ screen: "DELL U2720Q" }).text, ["Click ", projector, " for fullscreen on DELL U2720Q, or ", sharing, " for a meeting."]);
  // Not knowing the screens, it goes fullscreen where it is: there first.
  assert.deepEqual(next({}).text, ["Drag the audience window to the projector and click ", projector, ", or click ", sharing, " for a meeting."]);
  assert.deepEqual(next({ remote: false }).text, ["Drag the audience window to the projector and double-click it, or click ", sharing, " for a meeting."]);
});

test("a window prepared for sharing needs no projector or fullscreen, but still needs sharing in the meeting app", () => {
  const audience = status({ forSharing: true });
  assert.equal(audienceReady(audience, false), true);
  assert.deepEqual(guideLine(at({ audience, oneScreen: true })), {
    kind: "next", text: "Ready to share: select the audience window in your meeting app (keep it windowed).",
  });
  assert.equal(guideLine(at({ audience, oneScreen: true, clock: "running" })), null);
  assert.equal(audienceReady(status({ mode: "closed", forSharing: true }), false), false);
});

test("readiness shows audience or scheduled-time facts without repeating the clock indicator", () => {
  const fullscreen = status({ mode: "fullscreen", screen: "DELL U2720Q" });
  assert.deepEqual(guideLine(at({ audience: fullscreen })), {
    kind: "fact",
    text: "Audience fullscreen on DELL U2720Q",
  });
  const scheduled = guideLine(at({ audience: fullscreen, startsAt: { time: "2:00 PM", in: "0:12:34" } }));
  assert.equal(scheduled.text, "The talk starts at 2:00 PM, in 0:12:34");
  // Presenting in this window: nothing to say where.
  assert.equal(guideLine(at({ audience: status({ mode: "closed" }), solo: true })), null);
});

test("one screen offers sharing before the talk (yellow) and warns mid-talk (orange); refused fullscreen is orange", () => {
  const one = (system) => guideLine(at({ oneScreen: true, system }));
  assert.deepEqual(one("mac"), { kind: "next", text: ["One screen: click ", sharing, " for a meeting, or connect/extend a projector (⌘ + brightness down)."] });
  assert.match(one("windows").text.at(-1), /\(Win\+P\)\.$/);
  assert.match(one("linux").text.at(-1), /\(Super\+P\)\.$/);
  assert.deepEqual(one(null).text, ["One screen: click ", sharing, " for a meeting, or connect and extend a projector."]);
  // Mid-talk, until the audience sees the slides, it's orange.
  assert.equal(guideLine(at({ oneScreen: true, clock: "running" })).kind, "blocked");
  assert.equal(guideLine(at({ oneScreen: true, audience: status({ mode: "fullscreen" }) })).kind, "fact");
  const refused = guideLine(at({ audience: status({ remote: false, refused: true }), clock: "running" }));
  assert.deepEqual(refused, { kind: "blocked", text: ["Can't go fullscreen from here: double-click the audience window, or click ", sharing, " for a meeting."] });
});

test("after a rehearsal, Reset; the audience's step first", () => {
  const fullscreen = status({ mode: "fullscreen" });
  const stale = guideLine(at({ audience: fullscreen, clock: "running", stale: true }));
  assert.deepEqual(stale, { kind: "next", text: ["The clock has time from a rehearsal: click ", { button: "Reset" }, " before the talk."] });
  assert.deepEqual(guideLine(at({ clock: "running", stale: true })).text, ["Drag the audience window to the projector and click ", projector, ", or click ", sharing, " for a meeting."]);
});

test("during the talk: no duplicate pause hint; laser and last-slide guidance remain", () => {
  const talk = (s) => guideLine(at({ audience: status({ mode: "fullscreen" }), clock: "running", ...s }));
  assert.equal(talk({}), null);
  assert.equal(talk({ clock: "paused" }), null);
  const laser = { kind: "hint", text: ["Laser on: + and − size the dot; click ", { button: "Laser" }, " to turn it off."] };
  assert.deepEqual(talk({ clock: "paused", laser: true }), laser);
  assert.deepEqual(talk({ laser: true, lastPlanned: true }), laser);
  assert.deepEqual(talk({ lastPlanned: true }), { kind: "fact", text: "Last planned slide: backup slides follow." });
  assert.deepEqual(talk({ audience: status({ mode: "closed" }) }).text, ["Audience window closed. Click ", projector, " to reopen it, or ", sharing, " for a meeting."]);
  assert.deepEqual(talk({ audience: status({ mode: "closed" }), reopenWith: "Sharing" }).text, ["Audience window closed. Click ", sharing, " to reopen it."]);
});

test("at the end of a run, in purple, the button that saves its times", () => {
  const end = (s) => guideLine(at({ audience: status({ mode: "fullscreen" }), clock: "running", finished: true, ...s }));
  const save = { kind: "hint", text: ["Click ", { button: "Save run" }, " to keep this run's times, to compare with the plan."] };
  assert.deepEqual(end({ lastPlanned: true }), save);
  assert.deepEqual(end({ clock: "paused" }), save, "paused at the end, saving comes first");
});

test("comparing two plans, the line names the other file, before anything else", () => {
  const line = guideLine(at({ oneScreen: true, comparing: "talk-20261028-1405.pdfpc" }));
  assert.deepEqual(line, { kind: "hint", text: "Comparing with talk-20261028-1405.pdfpc." });
});
