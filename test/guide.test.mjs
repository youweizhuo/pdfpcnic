import assert from "node:assert/strict";
import { test } from "node:test";
import { audienceReady, audienceStep } from "../src/core/guide.ts";

const status = (s) => ({ mode: "window", screen: null, remote: true, refused: false, ...s });

test("closed: open it, or say the slides are in this window", () => {
  const step = audienceStep(status({ mode: "closed" }), false);
  assert.equal(step.action, "openAudience");
  assert.equal(step.label, "Open audience window");
  assert.equal(step.status, "");
  assert.match(audienceStep(status({ mode: "closed" }), true).status, /^Presenting in this window/);
});

test("where the presenter can, Shift+W makes it fullscreen, and the line names the screen", () => {
  const step = audienceStep(status({ screen: "DELL U2720Q" }), false);
  assert.equal(step.action, "audienceFullscreen");
  assert.equal(step.label, "Audience fullscreen");
  assert.equal(step.key, "⇧W");
  assert.equal(step.status, "Audience window open; it goes fullscreen on DELL U2720Q.");
});

test("elsewhere, the audience window has to be double-clicked, and Shift+W isn't offered", () => {
  const step = audienceStep(status({ remote: false }), false);
  assert.equal(step.action, "openAudience");
  assert.equal(step.label, "Double-click the audience window");
  assert.equal(step.key, "");
  assert.equal(step.ask, false);
  const refused = audienceStep(status({ remote: false, refused: true }), false);
  assert.match(refused.status, /only the audience window go fullscreen: double-click it/);
  assert.equal(refused.ask, true);
});

test("fullscreen: the audience is ready, and the same button takes it back", () => {
  const s = status({ mode: "fullscreen", screen: "the other screen" });
  assert.equal(audienceStep(s, false).action, "audienceFullscreen");
  assert.equal(audienceStep(s, false).label, "Audience fullscreen");
  assert.equal(audienceStep(s, false).status, "Audience fullscreen on the other screen.");
  assert.equal(audienceReady(s, false), true);
  assert.equal(audienceReady(status(), false), false);
  assert.equal(audienceReady(status({ mode: "closed" }), true), true);
});
