"use strict";

const RISK_CLASSES = new Set(["read_only", "reversible", "consequential", "critical"]);

function validateActionPreview(action) {
  if (!action || typeof action !== "object") throw new TypeError("action must be an object");
  if (!action.id || typeof action.id !== "string") throw new TypeError("action.id is required");
  if (!RISK_CLASSES.has(action.risk)) throw new TypeError("action.risk is invalid");
  if (!action.expectedVisibleResult) throw new TypeError("action.expectedVisibleResult is required");
  if (!Array.isArray(action.preconditions) || action.preconditions.length === 0) {
    throw new TypeError("at least one precondition is required");
  }
  return {
    ...action,
    requiresConfirmation: action.risk === "consequential" || action.risk === "critical"
  };
}

function canExecute(preview, confirmationToken) {
  const action = validateActionPreview(preview);
  return !action.requiresConfirmation || Boolean(confirmationToken);
}

module.exports = { validateActionPreview, canExecute };
