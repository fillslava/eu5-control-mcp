"use strict";

const {
  EU5_PROCESS_NAME,
  EU5_WINDOW_TITLE,
  getProcedure
} = require("./control-procedure-catalog");
const { resolveObservationMaxAgeMs } = require("./observation-policy");

const REJECTION = Object.freeze({
  INVALID_OBSERVATION: "invalid_observation",
  STALE_OBSERVATION: "stale_observation",
  GAME_WINDOW_AMBIGUOUS: "game_window_ambiguous",
  WRONG_FOCUS: "wrong_focus",
  MODAL_PRESENT: "modal_present",
  TEXT_ENTRY_FOCUSED: "text_entry_focused",
  TEST_SESSION_MISMATCH: "test_session_mismatch",
  UNEXPECTED_SCREEN: "unexpected_screen",
  TARGET_NOT_VISIBLE: "target_not_visible",
  POSTCONDITION_NOT_MET: "postcondition_not_met",
  NON_OPERATIONAL_ROUTE: "non_operational_route"
});

function reject(code, message) {
  return Object.freeze({
    allowed: false,
    code,
    message,
    dispatch: null,
    automaticRetryAllowed: false,
    nextStep: "capture_fresh_observation_and_redeclare"
  });
}

function validateObservationShape(observation) {
  if (!observation || typeof observation !== "object") return "observation is required";
  if (typeof observation.id !== "string" || observation.id.trim() === "") return "observation.id is required";
  if (!Number.isFinite(Date.parse(observation.capturedAtUtc))) return "observation.capturedAtUtc must be ISO-8601";
  if (!observation.window || typeof observation.window !== "object") return "observation.window is required";
  if (!observation.game || typeof observation.game !== "object") return "observation.game is required";
  if (!observation.session || typeof observation.session !== "object") return "observation.session is required";
  if (typeof observation.screenId !== "string" || observation.screenId.trim() === "") return "observation.screenId is required";
  if (!Array.isArray(observation.visibleControls)) return "observation.visibleControls must be an array";
  return null;
}

function evaluateProcedureGate(
  name,
  observation,
  { now = Date.now(), maxObservationAgeMs } = {}
) {
  const selected = getProcedure(name);
  const shapeError = validateObservationShape(observation);
  if (shapeError) return reject(REJECTION.INVALID_OBSERVATION, shapeError);

  const capturedAtMs = Date.parse(observation.capturedAtUtc);
  const ageMs = now - capturedAtMs;
  const allowedAgeMs = resolveObservationMaxAgeMs({ maxAgeMs: maxObservationAgeMs });
  if (ageMs < 0 || ageMs > allowedAgeMs) {
    return reject(REJECTION.STALE_OBSERVATION, "The UI observation is not within the allowed freshness window.");
  }

  if (
    observation.window.visibleEu5WindowCount !== 1 ||
    observation.window.processName !== EU5_PROCESS_NAME ||
    observation.window.title !== EU5_WINDOW_TITLE
  ) {
    return reject(REJECTION.GAME_WINDOW_AMBIGUOUS, "Exactly one matching visible EU5 window is required.");
  }

  if (
    selected.focusRequiredBeforeDispatch !== false &&
    observation.window.focused !== true
  ) {
    return reject(REJECTION.WRONG_FOCUS, "EU5 must be the confirmed foreground window.");
  }

  if (selected.allowInformationModal === true) {
    if (
      observation.game.modalPresent !== true ||
      observation.game.modalKind !== "information"
    ) {
      return reject(
        REJECTION.POSTCONDITION_NOT_MET,
        "The dismiss procedure requires a verified information-only modal."
      );
    }
  } else if (
    selected.allowModalObservation !== true &&
    observation.game.modalPresent !== false
  ) {
    return reject(REJECTION.MODAL_PRESENT, "A modal dialog blocks controlled execution.");
  }

  if (observation.game.textEntryFocused !== false) {
    return reject(REJECTION.TEXT_ENTRY_FOCUSED, "A text-entry field blocks controlled execution.");
  }

  if (
    observation.session.testMarkerMatched !== true ||
    observation.session.gameBuildMatched !== true ||
    observation.session.modManifestMatched !== true
  ) {
    return reject(REJECTION.TEST_SESSION_MISMATCH, "The test marker, game build, and mod manifest must all match.");
  }

  if (
    !selected.allowedInitialScreens.includes("*") &&
    !selected.allowedInitialScreens.includes(observation.screenId)
  ) {
    return reject(
      REJECTION.UNEXPECTED_SCREEN,
      `Procedure ${name} is not admitted from screen ${observation.screenId}.`
    );
  }

  if (
    ["pause", "pause_now", "confirm_paused", "abort_to_pause"].includes(name) &&
    typeof observation.game.paused !== "boolean"
  ) {
    return reject(REJECTION.INVALID_OBSERVATION, "Pause state must be a known boolean.");
  }

  if (name === "confirm_paused" && observation.game.paused !== true) {
    return reject(REJECTION.POSTCONDITION_NOT_MET, "The campaign is not paused.");
  }

  if (selected.executionMode === "observation_only") {
    return Object.freeze({
      allowed: true,
      code: "already_satisfied",
      procedure: selected,
      observationId: observation.id,
      observationAgeMs: ageMs,
      maxObservationAgeMs: allowedAgeMs,
      dispatch: null,
      postcondition: selected.expectedEvidence,
      automaticRetryAllowed: false
    });
  }

  if (
    ["pause", "pause_now", "abort_to_pause"].includes(name) &&
    observation.game.paused === true
  ) {
    return Object.freeze({
      allowed: true,
      code: "already_satisfied",
      procedure: selected,
      observationId: observation.id,
      observationAgeMs: ageMs,
      maxObservationAgeMs: allowedAgeMs,
      dispatch: null,
      postcondition: selected.expectedEvidence,
      automaticRetryAllowed: false
    });
  }

  if (!selected.dispatch) {
    return reject(
      REJECTION.NON_OPERATIONAL_ROUTE,
      selected.nonOperationalReason || `Procedure ${name} has no live-proven dispatch route.`
    );
  }

  if (selected.dispatch.operation === "click_visible_control") {
    const targetVisible = observation.visibleControls.some((control) =>
      control &&
      control.role === selected.dispatch.role &&
      selected.dispatch.exactLabels.includes(control.label) &&
      control.visible === true &&
      control.enabled === true
    );
    if (!targetVisible) {
      return reject(
        REJECTION.TARGET_NOT_VISIBLE,
        `The exact enabled ${selected.dispatch.role} target for ${name} was not observed.`
      );
    }
  }

  return Object.freeze({
    allowed: true,
    code: "ready_for_authorized_dispatch",
    procedure: selected,
    observationId: observation.id,
    dispatch: selected.dispatch,
    postcondition: selected.expectedEvidence,
    automaticRetryAllowed: false
  });
}

function classifyProcedureOutcome(name, outcome) {
  const selected = getProcedure(name);
  if (!selected.dispatch && selected.executionMode !== "observation_only") {
    return Object.freeze({
      state: "rejected",
      code: REJECTION.NON_OPERATIONAL_ROUTE,
      verified: false,
      stopRequired: true,
      automaticRetryAllowed: false,
      reason: selected.nonOperationalReason
    });
  }
  if (!outcome || typeof outcome !== "object") {
    return executionUnknown("No post-dispatch outcome was supplied.");
  }
  if (outcome.acknowledged !== true) {
    return executionUnknown("Dispatch acknowledgement is missing.");
  }
  if (outcome.evidenceConclusive !== true) {
    return executionUnknown("Post-state evidence is inconclusive.");
  }
  const matchesExpected = matchExpectedEvidence(selected.expectedEvidence, outcome.evidence);
  if (matchesExpected === null) {
    return executionUnknown("Post-state evidence is incomplete for this procedure.");
  }
  if (matchesExpected === false) {
    return Object.freeze({
      state: "failed",
      verified: false,
      stopRequired: true,
      automaticRetryAllowed: false,
      expectedEvidence: selected.expectedEvidence,
      reason: "The conclusive post-state did not match the expected evidence."
    });
  }
  return Object.freeze({
    state: "attested_untrusted",
    verified: false,
    stopRequired: true,
    automaticRetryAllowed: false,
    requiresIndependentSignedVerification: true,
    expectedEvidence: selected.expectedEvidence
  });
}

function matchExpectedEvidence(expected, evidence) {
  if (!evidence || typeof evidence !== "object" || evidence.kind !== expected.kind) return null;
  switch (expected.kind) {
    case "active_window":
      if (typeof evidence.processName !== "string" || typeof evidence.title !== "string") return null;
      return evidence.processName === expected.processName && evidence.title === expected.exactTitle;
    case "game_state":
      if (typeof evidence.paused !== "boolean") return null;
      return evidence.paused === expected.paused;
    case "modal_state":
      if (typeof evidence.modalPresent !== "boolean") return null;
      return evidence.modalPresent === expected.modalPresent;
    case "debug_record": {
      if (!evidence.record || typeof evidence.record !== "object" || typeof evidence.fresh !== "boolean") return null;
      const fieldsMatch = ["schemaVersion", "recordType", "procedure", "status"]
        .every((field) => evidence.record[field] === expected[field]);
      return fieldsMatch && (!expected.freshnessRequired || evidence.fresh === true);
    }
    case "screen": {
      if (typeof evidence.screenId !== "string") return null;
      if (evidence.screenId !== expected.screenId) return false;
      if (expected.exactVisibleText) {
        if (!Array.isArray(evidence.visibleTexts)) return null;
        if (!evidence.visibleTexts.includes(expected.exactVisibleText)) return false;
      }
      for (const [field, value] of Object.entries(expected)) {
        if (["kind", "screenId", "exactVisibleText"].includes(field)) continue;
        if (!(field in evidence)) return null;
        if (evidence[field] !== value) return false;
      }
      return true;
    }
    case "screen_transition":
      if (typeof evidence.previousScreenId !== "string" || typeof evidence.currentScreenId !== "string") return null;
      return evidence.previousScreenId !== evidence.currentScreenId;
    default:
      return null;
  }
}

function executionUnknown(reason) {
  return Object.freeze({
    state: "execution_unknown",
    verified: false,
    stopRequired: true,
    automaticRetryAllowed: false,
    requiresExplicitHumanRecovery: true,
    reason
  });
}

module.exports = {
  REJECTION,
  evaluateProcedureGate,
  classifyProcedureOutcome
};
