"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareNavigationCommand } = require("../src/control/navigation-commands");

test("navigation commands are finite disabled binding candidates", () => {
  const command = prepareNavigationCommand("open_economy");
  assert.equal(command.bindingReference, "ctrl+f2");
  assert.equal(command.risk, "read_only");
  assert.equal(command.operational, false);
  assert.equal(command.status, "candidate_requires_live_proof");
  assert.equal(command.dispatch, null);
  assert.equal("directWindowsMcpProcedure" in command, false);
  assert.match(command.nonOperationalReason, /not live-proven/);
  assert.equal("executor" in command, false);
  assert.equal(command.preconditions.length, 3);
});

test("unknown navigation commands are rejected", () => {
  assert.throws(() => prepareNavigationCommand("save_game"));
});
