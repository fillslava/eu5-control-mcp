"use strict";

const crypto = require("node:crypto");
const { stableStringify } = require("./control-ledger");
const { CATALOG_ID, getProcedure } = require("./control-procedure-catalog");

const RISK_CLASSES = new Set(["read_only", "reversible", "consequential", "critical"]);
const ACTION_FAMILIES = new Set(["navigation", "economy", "diplomacy", "military"]);
const ACTION_CAPABILITIES = new Set([
  "economy_decision",
  "diplomacy_decision",
  "recruitment_inspection"
]);
const CAPABILITY_FAMILIES = Object.freeze({
  economy_decision: "economy",
  diplomacy_decision: "diplomacy",
  recruitment_inspection: "military"
});
const ACTION_FIELDS = new Set([
  "id",
  "risk",
  "expectedVisibleResult",
  "preconditions",
  "requiresConfirmation",
  "actionFamily",
  "procedure",
  "capability"
]);
const PROCEDURE_ACTIONS = Object.freeze({
  focus_game: Object.freeze({ id: "eu5.focus_game", actionFamily: "navigation", capability: null }),
  pause: Object.freeze({ id: "eu5.pause", actionFamily: "navigation", capability: null }),
  pause_now: Object.freeze({ id: "eu5.pause_now", actionFamily: "navigation", capability: null }),
  confirm_paused: Object.freeze({ id: "eu5.confirm_paused", actionFamily: "navigation", capability: null }),
  dismiss_information_modal: Object.freeze({ id: "eu5.dismiss_information_modal", actionFamily: "navigation", capability: null }),
  abort_to_pause: Object.freeze({ id: "eu5.abort_to_pause", actionFamily: "navigation", capability: null }),
  recover_known_screen: Object.freeze({ id: "eu5.recover_known_screen", actionFamily: "navigation", capability: null }),
  open_control_panel: Object.freeze({ id: "eu5.open_control_panel", actionFamily: "navigation", capability: null }),
  refresh_state: Object.freeze({ id: "eu5.refresh_state", actionFamily: "navigation", capability: null }),
  open_capital: Object.freeze({ id: "eu5.open_capital", actionFamily: "navigation", capability: null }),
  economy: Object.freeze({ id: "eu5.open_economy", actionFamily: "economy", capability: "economy_decision" }),
  markets: Object.freeze({ id: "eu5.open_markets", actionFamily: "economy", capability: "economy_decision" }),
  diplomacy: Object.freeze({ id: "eu5.open_diplomacy", actionFamily: "diplomacy", capability: "diplomacy_decision" }),
  military: Object.freeze({ id: "eu5.open_military", actionFamily: "military", capability: "recruitment_inspection" }),
  alerts: Object.freeze({ id: "eu5.open_alerts", actionFamily: "navigation", capability: null }),
  back: Object.freeze({ id: "eu5.back", actionFamily: "navigation", capability: null }),
  close: Object.freeze({ id: "eu5.close", actionFamily: "navigation", capability: null })
});

function catalogueEntryDigest(procedureName) {
  const selected = getProcedure(procedureName);
  return crypto
    .createHash("sha256")
    .update(stableStringify(selected))
    .digest("hex");
}

function catalogueAction(procedureName) {
  const selected = getProcedure(procedureName);
  const semantics = PROCEDURE_ACTIONS[procedureName];
  if (!semantics) throw new TypeError(`Procedure ${procedureName} has no lifecycle action contract`);
  const risk = selected.riskClass;
  return Object.freeze({
    id: semantics.id,
    risk,
    expectedVisibleResult: stableStringify(selected.expectedEvidence),
    preconditions: [...selected.preconditions],
    requiresConfirmation: risk === "consequential" || risk === "critical",
    actionFamily: semantics.actionFamily,
    procedure: procedureName,
    capability: semantics.capability
  });
}

function validateActionPreview(action) {
  if (!action || typeof action !== "object") throw new TypeError("action must be an object");
  const unexpectedFields = Object.keys(action).filter((field) => !ACTION_FIELDS.has(field));
  if (unexpectedFields.length > 0) {
    throw new TypeError(`action contains unsupported fields: ${unexpectedFields.join(", ")}`);
  }
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

function validateActionSemantics(action) {
  const validated = validateActionPreview(action);
  if (!ACTION_FAMILIES.has(validated.actionFamily)) {
    throw new TypeError("action.actionFamily is invalid");
  }
  if (
    typeof validated.procedure !== "string" ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(validated.procedure)
  ) {
    throw new TypeError("action.procedure must be a bounded named procedure");
  }
  const capability = validated.capability === undefined ? null : validated.capability;
  if (capability !== null && !ACTION_CAPABILITIES.has(capability)) {
    throw new TypeError("action.capability is invalid");
  }
  if (validated.actionFamily === "navigation" && capability !== null) {
    throw new TypeError("navigation actions cannot declare a gameplay capability");
  }
  if (capability !== null && CAPABILITY_FAMILIES[capability] !== validated.actionFamily) {
    throw new TypeError(
      `action capability ${capability} requires actionFamily ${CAPABILITY_FAMILIES[capability]}`
    );
  }
  const normalized = { ...validated, capability };
  const canonical = catalogueAction(normalized.procedure);
  if (stableStringify(normalized) !== stableStringify(canonical)) {
    throw new TypeError(
      `action must exactly match catalogue entry ${CATALOG_ID}:${normalized.procedure}`
    );
  }
  return canonical;
}

function canExecute(preview, confirmationToken) {
  const action = validateActionPreview(preview);
  return !action.requiresConfirmation || Boolean(confirmationToken);
}

module.exports = {
  ACTION_CAPABILITIES,
  ACTION_FAMILIES,
  CAPABILITY_FAMILIES,
  PROCEDURE_ACTIONS,
  catalogueAction,
  catalogueEntryDigest,
  validateActionPreview,
  validateActionSemantics,
  canExecute
};
