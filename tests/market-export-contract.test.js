"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  prepareMarketCapacityExport,
  validatePreparationInput
} = require("../src/control/market-export-contract");

test("market capacity export preparation is blocked by the no-console policy", () => {
  assert.deepEqual(prepareMarketCapacityExport(), {
    tool: "eu5_prepare_market_capacity_export",
    risk: "blocked_by_policy",
    executesCommand: false,
    eligibleForExecution: false,
    blockReason: "The supervised test protocol forbids console commands.",
    candidateConsoleCommand: "export_market_capacity",
    safetyStatus: "unconfirmed"
  });
});

test("market capacity export preparation rejects every caller-supplied parameter", () => {
  assert.deepEqual(validatePreparationInput({}), {});
  assert.throws(() => prepareMarketCapacityExport({ command: "anything" }), /accepts no parameters/);
  assert.throws(() => prepareMarketCapacityExport({ consoleCommand: "export_market_capacity" }), /accepts no parameters/);
  assert.throws(() => prepareMarketCapacityExport({ note: "candidate is safe" }), /accepts no parameters/);
  assert.throws(
    () => prepareMarketCapacityExport(Object.defineProperty({}, "command", { value: "hidden", enumerable: false })),
    /accepts no parameters/
  );
  assert.throws(() => prepareMarketCapacityExport(null), /must be an object/);
  assert.throws(() => prepareMarketCapacityExport([]), /must be an object/);
});
