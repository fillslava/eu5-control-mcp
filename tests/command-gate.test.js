"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateFreshNavigationObservation } = require("../src/control/command-gate");

const now = Date.parse("2026-07-25T21:30:00.000Z");
const valid = {
  id: "ui-001",
  capturedAtUtc: "2026-07-25T21:29:59.500Z",
  paused: true,
  modalPresent: false,
  textEntryFocused: false
};

test("fresh paused observations validate navigation preparation", () => {
  assert.equal(validateFreshNavigationObservation(valid, now).id, "ui-001");
});

test("stale or unsafe observations are rejected", () => {
  assert.throws(() => validateFreshNavigationObservation({ ...valid, paused: false }, now));
  assert.throws(() => validateFreshNavigationObservation({ ...valid, modalPresent: true }, now));
  assert.throws(() => validateFreshNavigationObservation({ ...valid, capturedAtUtc: "2026-07-25T21:29:57.000Z" }, now));
});
