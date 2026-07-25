"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canExecute, validateActionPreview } = require("../src/control/action-gate");

const baseAction = {
  id: "eu5.open_economy",
  risk: "read_only",
  expectedVisibleResult: "The Economy panel is open.",
  preconditions: ["The intended EU5 window is focused."]
};

test("read-only previews execute without confirmation", () => {
  assert.equal(canExecute(baseAction), true);
});

test("consequential previews require confirmation", () => {
  const action = validateActionPreview({ ...baseAction, id: "eu5.recruit", risk: "consequential" });
  assert.equal(action.requiresConfirmation, true);
  assert.equal(canExecute(action), false);
  assert.equal(canExecute(action, "approved-once"), true);
});
