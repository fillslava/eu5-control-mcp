"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  catalogueAction,
  canExecute,
  validateActionPreview,
  validateActionSemantics
} = require("../src/control/action-gate");

const baseAction = {
  id: "eu5.open_economy",
  risk: "read_only",
  expectedVisibleResult: "The Economy panel is open.",
  preconditions: ["The intended EU5 window is focused."],
  actionFamily: "navigation",
  procedure: "economy",
  capability: null
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

test("action previews reject arbitrary input and console-shaped fields", () => {
  for (const injected of [
    { command: "pause" },
    { console: "cash 1000" },
    { macro: ["ctrl", "f2"] },
    { coordinates: [84, 120] }
  ]) {
    assert.throws(
      () => validateActionPreview({ ...baseAction, ...injected }),
      /unsupported fields/
    );
  }
});

test("gameplay capabilities are bound to their exact action family", () => {
  const economy = catalogueAction("economy");
  assert.equal(
    validateActionSemantics(economy).capability,
    "economy_decision"
  );
  for (const [capability, actionFamily] of [
    ["economy_decision", "diplomacy"],
    ["diplomacy_decision", "military"],
    ["recruitment_inspection", "economy"]
  ]) {
    assert.throws(
      () => validateActionSemantics({ ...economy, capability, actionFamily }),
      /requires actionFamily|exactly match catalogue/
    );
  }
  assert.throws(
    () => validateActionSemantics({ ...economy, id: "eu5.attacker_supplied" }),
    /exactly match catalogue/
  );
});
