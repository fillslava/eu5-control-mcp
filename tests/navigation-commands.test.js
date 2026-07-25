"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareNavigationCommand } = require("../src/control/navigation-commands");

test("navigation commands are finite hotkey procedures", () => {
  const command = prepareNavigationCommand("open_economy");
  assert.equal(command.hotkey, "ctrl+alt+e");
  assert.equal(command.risk, "read_only");
  assert.equal(command.executor, "windows-mcp.shortcut");
  assert.equal(command.preconditions.length, 3);
});

test("unknown navigation commands are rejected", () => {
  assert.throws(() => prepareNavigationCommand("save_game"));
});
