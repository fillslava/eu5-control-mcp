"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CATALOG_ID,
  PROCEDURES,
  getProcedure,
  listProcedures
} = require("../src/control/control-procedure-catalog");
const {
  REJECTION,
  evaluateProcedureGate,
  classifyProcedureOutcome
} = require("../src/control/control-procedure-gate");

const NOW = Date.parse("2026-07-26T17:30:00.000Z");

function observation(overrides = {}) {
  const base = {
    id: "obs-001",
    capturedAtUtc: new Date(NOW - 500).toISOString(),
    screenId: "map",
    visibleControls: [],
    window: {
      visibleEu5WindowCount: 1,
      processName: "eu5.exe",
      title: "Europa Universalis V",
      focused: true
    },
    game: {
      paused: true,
      modalPresent: false,
      textEntryFocused: false
    },
    session: {
      testMarkerMatched: true,
      gameBuildMatched: true,
      modManifestMatched: true
    }
  };
  return {
    ...base,
    ...overrides,
    window: { ...base.window, ...(overrides.window || {}) },
    game: { ...base.game, ...(overrides.game || {}) },
    session: { ...base.session, ...(overrides.session || {}) }
  };
}

test("catalog is versioned, finite, named, and exposes no generic execution primitive", () => {
  assert.equal(CATALOG_ID, "eu5.control-procedure-catalog/v1");
  assert.deepEqual(Object.keys(PROCEDURES), [
    "focus_game",
    "pause",
    "pause_now",
    "confirm_paused",
    "dismiss_information_modal",
    "abort_to_pause",
    "recover_known_screen",
    "open_control_panel",
    "refresh_state",
    "open_capital",
    "economy",
    "markets",
    "diplomacy",
    "military",
    "alerts",
    "back",
    "close"
  ]);
  assert.equal(listProcedures().length, 17);
  assert.throws(() => getProcedure("execute_effect"), /Unknown controlled EU5 procedure/);
});

test("every candidate has fixed policy and evidence but no unproven dispatch metadata", () => {
  for (const item of listProcedures()) {
    assert.equal(item.catalogId, CATALOG_ID);
    assert.match(item.name, /^[a-z_]+$/);
    assert.ok(["read_only", "reversible"].includes(item.riskClass));
    assert.ok(["one_use", "not_required"].includes(item.authorization));
    assert.equal(item.idempotency.keyRequired, true);
    assert.equal(item.idempotency.automaticRetry, false);
    assert.equal(item.retryPolicy.mode, "never_automatic");
    assert.equal(item.retryPolicy.onMissingAcknowledgement, "execution_unknown");
    assert.ok(item.preconditions.length >= 5);
    assert.ok(item.targetSchema.type);
    assert.ok(item.expectedEvidence.kind);
    assert.equal(item.dispatch, null);
    if (item.executionMode === "observation_only") {
      assert.equal(item.operationalStatus, "operational_observation_only");
      assert.equal(item.authorization, "not_required");
    } else {
      assert.equal(item.operationalStatus, "candidate_requires_live_proof");
      assert.equal(typeof item.nonOperationalReason, "string");
      assert.ok(item.nonOperationalReason.length > 20);
    }
  }
});

test("valid fresh focused observations still reject an unproven route", () => {
  const result = evaluateProcedureGate("economy", observation(), { now: NOW });
  assert.equal(result.allowed, false);
  assert.equal(result.code, REJECTION.NON_OPERATIONAL_ROUTE);
  assert.equal(result.dispatch, null);
  assert.equal(result.automaticRetryAllowed, false);
});

test("wrong focus is rejected for game input procedures", () => {
  const result = evaluateProcedureGate(
    "economy",
    observation({ window: { focused: false } }),
    { now: NOW }
  );
  assert.equal(result.allowed, false);
  assert.equal(result.code, REJECTION.WRONG_FOCUS);
  assert.equal(result.dispatch, null);
});

test("focus_game may inspect an unfocused EU5 window but has no dispatch route", () => {
  const result = evaluateProcedureGate(
    "focus_game",
    observation({ window: { focused: false } }),
    { now: NOW }
  );
  assert.equal(result.allowed, false);
  assert.equal(result.code, REJECTION.NON_OPERATIONAL_ROUTE);
  assert.equal(result.dispatch, null);
});

test("stale and future observations are rejected", () => {
  for (const capturedAtUtc of [
    new Date(NOW - 45_001).toISOString(),
    new Date(NOW + 1).toISOString()
  ]) {
    const result = evaluateProcedureGate(
      "economy",
      observation({ capturedAtUtc }),
      { now: NOW }
    );
    assert.equal(result.allowed, false);
    assert.equal(result.code, REJECTION.STALE_OBSERVATION);
  }
});

test("modal and text-entry observations are rejected without dispatch", () => {
  const modal = evaluateProcedureGate(
    "economy",
    observation({ game: { modalPresent: true } }),
    { now: NOW }
  );
  assert.equal(modal.code, REJECTION.MODAL_PRESENT);
  assert.equal(modal.dispatch, null);

  const text = evaluateProcedureGate(
    "economy",
    observation({ game: { textEntryFocused: true } }),
    { now: NOW }
  );
  assert.equal(text.code, REJECTION.TEXT_ENTRY_FOCUSED);
  assert.equal(text.dispatch, null);
});

test("session mismatch and ambiguous EU5 windows fail closed", () => {
  const mismatch = evaluateProcedureGate(
    "economy",
    observation({ session: { modManifestMatched: false } }),
    { now: NOW }
  );
  assert.equal(mismatch.code, REJECTION.TEST_SESSION_MISMATCH);

  const ambiguous = evaluateProcedureGate(
    "focus_game",
    observation({ window: { visibleEu5WindowCount: 2 } }),
    { now: NOW }
  );
  assert.equal(ambiguous.code, REJECTION.GAME_WINDOW_AMBIGUOUS);
});

test("unexpected screens fail closed and markets requires Economy or Markets", () => {
  const result = evaluateProcedureGate("markets", observation(), { now: NOW });
  assert.equal(result.allowed, false);
  assert.equal(result.code, REJECTION.UNEXPECTED_SCREEN);

  const candidate = evaluateProcedureGate(
    "markets",
    observation({
      screenId: "economy",
      visibleControls: [{ role: "tab", label: "Рынки", visible: true, enabled: true }]
    }),
    { now: NOW }
  );
  assert.equal(candidate.allowed, false);
  assert.equal(candidate.code, REJECTION.NON_OPERATIONAL_ROUTE);
});

test("a human-proven visible button remains non-dispatchable without Computer Use proof", () => {
  const result = evaluateProcedureGate(
    "refresh_state",
    observation({
      screenId: "control_panel",
      visibleControls: [{
        role: "button",
        label: "Emit state snapshot",
        visible: true,
        enabled: true
      }]
    }),
    { now: NOW }
  );
  assert.equal(result.allowed, false);
  assert.equal(result.code, REJECTION.NON_OPERATIONAL_ROUTE);
  assert.equal(result.dispatch, null);
});

test("pause is a disabled candidate and never blindly toggles", () => {
  const alreadyPaused = evaluateProcedureGate("pause", observation(), { now: NOW });
  assert.equal(alreadyPaused.allowed, true);
  assert.equal(alreadyPaused.code, "already_satisfied");
  assert.equal(alreadyPaused.dispatch, null);

  const running = evaluateProcedureGate(
    "pause",
    observation({ game: { paused: false } }),
    { now: NOW }
  );
  assert.equal(running.allowed, false);
  assert.equal(running.code, REJECTION.NON_OPERATIONAL_ROUTE);
  assert.equal(running.dispatch, null);

  const unknown = evaluateProcedureGate(
    "pause",
    observation({ game: { paused: null } }),
    { now: NOW }
  );
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.code, REJECTION.INVALID_OBSERVATION);
});

test("named pause and recovery procedures fail closed or prove already-satisfied state", () => {
  for (const name of ["pause_now", "abort_to_pause"]) {
    const satisfied = evaluateProcedureGate(name, observation(), { now: NOW });
    assert.equal(satisfied.allowed, true);
    assert.equal(satisfied.code, "already_satisfied");
    assert.equal(satisfied.dispatch, null);

    const running = evaluateProcedureGate(
      name,
      observation({ game: { paused: false } }),
      { now: NOW }
    );
    assert.equal(running.allowed, false);
    assert.equal(running.code, REJECTION.NON_OPERATIONAL_ROUTE);
  }

  const confirmed = evaluateProcedureGate("confirm_paused", observation(), { now: NOW });
  assert.equal(confirmed.allowed, true);
  assert.equal(confirmed.code, "already_satisfied");
  assert.equal(confirmed.observationAgeMs, 500);

  const confirmedBehindModal = evaluateProcedureGate(
    "confirm_paused",
    observation({ game: { modalPresent: true, modalKind: "decision" } }),
    { now: NOW }
  );
  assert.equal(confirmedBehindModal.allowed, true);
  assert.equal(confirmedBehindModal.code, "already_satisfied");

  const notPaused = evaluateProcedureGate(
    "confirm_paused",
    observation({ game: { paused: false } }),
    { now: NOW }
  );
  assert.equal(notPaused.allowed, false);
  assert.equal(notPaused.code, REJECTION.POSTCONDITION_NOT_MET);

  const mapRecovery = evaluateProcedureGate("recover_known_screen", observation(), { now: NOW });
  assert.equal(mapRecovery.allowed, true);
  assert.equal(mapRecovery.code, "already_satisfied");

  const unknownScreen = evaluateProcedureGate(
    "recover_known_screen",
    observation({ screenId: "economy" }),
    { now: NOW }
  );
  assert.equal(unknownScreen.allowed, false);
  assert.equal(unknownScreen.code, REJECTION.UNEXPECTED_SCREEN);
});

test("information modal dismissal admits only a classified information modal", () => {
  const missingModal = evaluateProcedureGate(
    "dismiss_information_modal",
    observation(),
    { now: NOW }
  );
  assert.equal(missingModal.code, REJECTION.POSTCONDITION_NOT_MET);

  const decision = evaluateProcedureGate(
    "dismiss_information_modal",
    observation({ game: { modalPresent: true, modalKind: "decision" } }),
    { now: NOW }
  );
  assert.equal(decision.code, REJECTION.POSTCONDITION_NOT_MET);

  const information = evaluateProcedureGate(
    "dismiss_information_modal",
    observation({
      game: { modalPresent: true, modalKind: "information" },
      visibleControls: [{ role: "button", label: "OK", visible: true, enabled: true }]
    }),
    { now: NOW }
  );
  assert.equal(information.code, REJECTION.NON_OPERATIONAL_ROUTE);
  assert.equal(information.dispatch, null);
});

test("observation-only outcomes remain unverified without an independent artifact", () => {
  const attested = classifyProcedureOutcome("confirm_paused", {
    acknowledged: true,
    evidenceConclusive: true,
    evidence: { kind: "game_state", paused: true }
  });
  assert.equal(attested.state, "attested_untrusted");
  assert.equal(attested.verified, false);
  assert.equal(attested.requiresIndependentSignedVerification, true);

  const unknown = classifyProcedureOutcome("confirm_paused", {
    acknowledged: false,
    evidenceConclusive: false
  });
  assert.equal(unknown.state, "execution_unknown");
  assert.equal(unknown.automaticRetryAllowed, false);
});

test("outcomes cannot be recorded as verified for non-operational candidates", () => {
  for (const outcome of [
    null,
    { acknowledged: false, evidenceConclusive: false },
    { acknowledged: true, evidenceConclusive: false }
  ]) {
    const result = classifyProcedureOutcome("economy", outcome);
    assert.equal(result.state, "rejected");
    assert.equal(result.code, REJECTION.NON_OPERATIONAL_ROUTE);
    assert.equal(result.stopRequired, true);
    assert.equal(result.automaticRetryAllowed, false);
  }
});

test("even exact claimed post-state cannot verify a non-operational candidate", () => {
  const failed = classifyProcedureOutcome("economy", {
    acknowledged: true,
    evidenceConclusive: true,
    evidence: {
      kind: "screen",
      screenId: "diplomacy",
      visibleTexts: ["Дипломатия"]
    }
  });
  assert.equal(failed.state, "rejected");
  assert.equal(failed.code, REJECTION.NON_OPERATIONAL_ROUTE);
  assert.equal(failed.stopRequired, true);
  assert.equal(failed.automaticRetryAllowed, false);

  const verified = classifyProcedureOutcome("economy", {
    acknowledged: true,
    evidenceConclusive: true,
    evidence: {
      kind: "screen",
      screenId: "economy",
      visibleTexts: ["Экономика"]
    }
  });
  assert.equal(verified.state, "rejected");
  assert.equal(verified.code, REJECTION.NON_OPERATIONAL_ROUTE);
  assert.equal(verified.verified, false);
  assert.equal(verified.automaticRetryAllowed, false);
});

test("a caller cannot verify an outcome with only a matchesExpected claim", () => {
  const result = classifyProcedureOutcome("economy", {
    acknowledged: true,
    evidenceConclusive: true,
    matchesExpected: true
  });
  assert.equal(result.state, "rejected");
  assert.equal(result.code, REJECTION.NON_OPERATIONAL_ROUTE);
  assert.equal(result.stopRequired, true);
});
