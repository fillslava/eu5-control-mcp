"use strict";

const COMMANDS = Object.freeze({
  focus_capital: {
    hotkey: "ctrl+f11",
    expectedVisibleResult: "The map camera centers on the controlled country's capital.",
    risk: "read_only"
  },
  open_economy: {
    hotkey: "ctrl+f2",
    expectedVisibleResult: "The Economy panel is open.",
    risk: "read_only"
  },
  open_diplomacy: {
    hotkey: "ctrl+f5",
    expectedVisibleResult: "The Diplomacy panel is open.",
    risk: "read_only"
  },
  open_military: {
    hotkey: "ctrl+f6",
    expectedVisibleResult: "The Military panel is open.",
    risk: "read_only"
  },
  open_alerts: {
    hotkey: "ctrl+f9",
    expectedVisibleResult: "The alerts menu is visible.",
    risk: "read_only"
  },
  find_province: {
    hotkey: "ctrl+f10",
    expectedVisibleResult: "The province search interface is open without selecting a result.",
    risk: "read_only"
  }
});

function prepareNavigationCommand(name) {
  const command = COMMANDS[name];
  if (!command) throw new TypeError(`Unknown safe navigation command: ${name}`);
  return {
    id: `eu5.${name}`,
    name,
    ...command,
    preconditions: [
      "Europa Universalis V is the active window.",
      "No text-entry field or modal dialog is focused.",
      "The agent-navigation bindings profile is active."
    ],
    verification: "Capture the visible UI after the hotkey and compare it with expectedVisibleResult.",
    executor: "windows-mcp.shortcut"
  };
}

module.exports = { COMMANDS, prepareNavigationCommand };
