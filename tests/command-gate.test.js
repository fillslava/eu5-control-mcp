"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_OBSERVATION_AGE_MS,
  validateFreshNavigationObservation
} = require("../src/control/command-gate");

const now = Date.parse("2026-07-25T21:30:00.000Z");
const valid = {
  id: "ui-001",
  capturedAtUtc: "2026-07-25T21:29:59.500Z",
  paused: true,
  modalPresent: false,
  textEntryFocused: false
};

test("fresh paused observations validate navigation preparation", () => {
  const result = validateFreshNavigationObservation(valid, now);
  assert.equal(result.id, "ui-001");
  assert.equal(result.maxObservationAgeMs, 45_000);
  assert.equal(MAX_OBSERVATION_AGE_MS, 45_000);
});

test("stale or unsafe observations are rejected", () => {
  assert.throws(() => validateFreshNavigationObservation({ ...valid, paused: false }, now));
  assert.throws(() => validateFreshNavigationObservation({ ...valid, modalPresent: true }, now));
  assert.throws(() => validateFreshNavigationObservation({
    ...valid,
    capturedAtUtc: "2026-07-25T21:29:14.999Z"
  }, now));
});

test("freshness is configurable per caller without weakening other gates", () => {
  const tenSecondsOld = {
    ...valid,
    capturedAtUtc: "2026-07-25T21:29:50.000Z"
  };
  assert.equal(
    validateFreshNavigationObservation(tenSecondsOld, now, { maxAgeMs: 15_000 }).observationAgeMs,
    10_000
  );
  assert.throws(
    () => validateFreshNavigationObservation(tenSecondsOld, now, { maxAgeMs: 5_000 }),
    /stale/
  );
  assert.throws(
    () => validateFreshNavigationObservation(valid, now, { maxAgeMs: 999 }),
    /between 1000 and 300000/
  );
});
