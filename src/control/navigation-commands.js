"use strict";

const COMMANDS = Object.freeze({
  focus_capital: {
    hotkey: "ctrl+alt+c",
    expectedVisibleResult: "The map camera centers on the controlled country's capital.",
    risk: "read_only"
  },
  open_economy: {
    hotkey: "ctrl+alt+e",
    expectedVisibleResult: "The Economy panel is open.",
    risk: "read_only"
  },
  open_diplomacy: {
    hotkey: "ctrl+alt+u",
    expectedVisibleResult: "The Diplomacy panel is open.",
    risk: "read_only"
  },
  open_military: {
    hotkey: "ctrl+alt+h",
    expectedVisibleResult: "The Military panel is open.",
    risk: "read_only"
  },
  open_alerts: {
    hotkey: "ctrl+alt+t",
    expectedVisibleResult: "The alerts menu is visible.",
    risk: "read_only"
  },
  find_province: {
    hotkey: "ctrl+alt+q",
    expectedVisibleResult: "The province search interface is open without selecting a result.",
    risk: "read_only"
  },
  close_left_panel: {
    hotkey: "ctrl+alt+j",
    expectedVisibleResult: "The left-side panel is closed when one is open.",
    risk: "reversible"
  },
  close_right_panel: {
    hotkey: "ctrl+alt+k",
    expectedVisibleResult: "The right-side panel is closed when one is open.",
    risk: "reversible"
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
