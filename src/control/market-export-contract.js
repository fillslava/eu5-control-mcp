"use strict";

const TOOL_NAME = "eu5_prepare_market_capacity_export";
const CONSOLE_COMMAND = "export_market_capacity";
const RISK = "blocked_by_policy";
const BLOCK_REASON = "The supervised test protocol forbids console commands.";

function validatePreparationInput(input) {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("preparation input must be an object");
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length > 0) {
    throw new TypeError("eu5_prepare_market_capacity_export accepts no parameters");
  }
  return {};
}

function prepareMarketCapacityExport(input) {
  validatePreparationInput(input);
  return {
    tool: TOOL_NAME,
    risk: RISK,
    executesCommand: false,
    eligibleForExecution: false,
    blockReason: BLOCK_REASON,
    candidateConsoleCommand: CONSOLE_COMMAND,
    safetyStatus: "unconfirmed"
  };
}

module.exports = {
  CONSOLE_COMMAND,
  BLOCK_REASON,
  RISK,
  TOOL_NAME,
  prepareMarketCapacityExport,
  validatePreparationInput
};
