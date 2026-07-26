"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_OBSERVATION_MAX_AGE_MS,
  OBSERVATION_MAX_AGE_ENV,
  resolveObservationMaxAgeMs
} = require("../src/control/observation-policy");

test("observation policy defaults to practical tool latency", () => {
  assert.equal(DEFAULT_OBSERVATION_MAX_AGE_MS, 45_000);
  assert.equal(resolveObservationMaxAgeMs({ env: {} }), 45_000);
});

test("observation policy accepts bounded environment and explicit overrides", () => {
  assert.equal(
    resolveObservationMaxAgeMs({ env: { [OBSERVATION_MAX_AGE_ENV]: "60000" } }),
    60_000
  );
  assert.equal(
    resolveObservationMaxAgeMs({
      maxAgeMs: 30_000,
      env: { [OBSERVATION_MAX_AGE_ENV]: "60000" }
    }),
    30_000
  );
});

test("observation policy rejects invalid or dangerously broad windows", () => {
  for (const configured of ["abc", "999", "300001", "1.5"]) {
    assert.throws(
      () => resolveObservationMaxAgeMs({
        env: { [OBSERVATION_MAX_AGE_ENV]: configured }
      }),
      /must be an integer between/
    );
  }
});
