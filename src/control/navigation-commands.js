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
    risk: command.risk,
    expectedVisibleResult: command.expectedVisibleResult,
    bindingReference: command.hotkey,
    operational: false,
    status: "candidate_requires_live_proof",
    dispatch: null,
    nonOperationalReason:
      "The binding is documented, but programmatic keyboard delivery to EU5 is not live-proven and remains non-operational.",
    preconditions: [
      "Europa Universalis V is the active window.",
      "No text-entry field or modal dialog is focused.",
      "The agent-navigation bindings profile is active."
    ],
    verification:
      "No dispatch is allowed. A future route requires three clean live repetitions and independent review before admission."
  };
}

module.exports = { COMMANDS, prepareNavigationCommand };
