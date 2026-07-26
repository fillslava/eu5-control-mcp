"use strict";

const CATALOG_ID = "eu5.control-procedure-catalog/v1";
const MAX_OBSERVATION_AGE_MS = 2_000;
const EU5_PROCESS_NAME = "eu5.exe";
const EU5_WINDOW_TITLE = "Europa Universalis V";

const COMMON_PRECONDITIONS = Object.freeze([
  "A fresh screenshot observation is available.",
  "Exactly one visible eu5.exe top-level window exists.",
  "No modal dialog is present.",
  "No text-entry field is focused.",
  "The disposable test-session marker and expected mod/build manifest match."
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function procedure(definition) {
  return deepFreeze({
    catalogId: CATALOG_ID,
    riskClass: "read_only",
    authorization: "one_use",
    idempotency: Object.freeze({
      keyRequired: true,
      automaticRetry: false,
      duplicateDispatch: "reject"
    }),
    retryPolicy: Object.freeze({
      mode: "never_automatic",
      onMissingAcknowledgement: "execution_unknown",
      onInconclusivePostState: "execution_unknown",
      requiresFreshDeclarationForRetry: true
    }),
    preconditions: COMMON_PRECONDITIONS,
    operationalStatus: "candidate_requires_live_proof",
    dispatch: null,
    ...definition,
    targetSchema: definition.targetSchema,
    expectedEvidence: definition.expectedEvidence
  });
}

const PROCEDURES = Object.freeze({
  focus_game: procedure({
    name: "focus_game",
    description: "Activate the unique visible EU5 window without clicking a screen coordinate.",
    allowedInitialScreens: ["*"],
    focusRequiredBeforeDispatch: false,
    targetSchema: {
      type: "application_window",
      processName: EU5_PROCESS_NAME,
      exactTitle: EU5_WINDOW_TITLE,
      uniqueVisibleWindowRequired: true
    },
    expectedEvidence: {
      kind: "active_window",
      processName: EU5_PROCESS_NAME,
      exactTitle: EU5_WINDOW_TITLE
    },
    nonOperationalReason:
      "Unique-window activation has not completed the required live-proof repetitions in this repository."
  }),

  pause: procedure({
    name: "pause",
    description: "Move the game to the paused desired state; never toggle from a stale observation.",
    riskClass: "reversible",
    allowedInitialScreens: ["*"],
    targetSchema: { type: "desired_game_state", paused: true },
    expectedEvidence: { kind: "game_state", paused: true },
    nonOperationalReason:
      "Programmatic keyboard delivery to EU5 is documented as non-operational; pause has no approved dispatch route."
  }),

  open_control_panel: procedure({
    name: "open_control_panel",
    description: "Open the installed mod's visible EU5 Control panel through its named UI control.",
    allowedInitialScreens: ["map", "control_panel"],
    targetSchema: {
      type: "visible_control",
      role: "button",
      exactLabels: ["EU5 Control"]
    },
    expectedEvidence: {
      kind: "screen",
      screenId: "control_panel",
      exactVisibleText: "EU5 Control"
    },
    nonOperationalReason:
      "No persistent visible EU5 Control opener exists; the panel was created through the debug console, which is out of scope."
  }),

  refresh_state: procedure({
    name: "refresh_state",
    description: "Request the fixed state-snapshot diagnostic record from the visible control panel.",
    allowedInitialScreens: ["control_panel"],
    targetSchema: {
      type: "visible_control",
      role: "button",
      exactLabels: ["Emit state snapshot"]
    },
    expectedEvidence: {
      kind: "debug_record",
      schemaVersion: "eu5.control-log/v1",
      recordType: "state_snapshot",
      procedure: "emit_state_snapshot",
      status: "acknowledged",
      freshnessRequired: true
    },
    nonOperationalReason:
      "The button was proven by a human click, but direct Computer Use activation has not been live-proven."
  }),

  open_capital: procedure({
    name: "open_capital",
    description: "Center the map on the controlled country's capital.",
    allowedInitialScreens: ["map"],
    targetSchema: { type: "reviewed_binding", bindingProfile: "agent-ctrl-fkeys.bindings" },
    expectedEvidence: { kind: "screen", screenId: "map", capitalCentered: true },
    nonOperationalReason:
      "The reviewed binding exists, but programmatic keyboard delivery to EU5 is documented as non-operational."
  }),

  economy: procedure({
    name: "economy",
    description: "Open the Economy screen without changing an economic setting.",
    allowedInitialScreens: ["map", "economy", "markets", "diplomacy", "military", "alerts"],
    targetSchema: { type: "reviewed_binding", bindingProfile: "agent-ctrl-fkeys.bindings" },
    expectedEvidence: { kind: "screen", screenId: "economy", exactVisibleText: "Экономика" },
    nonOperationalReason:
      "The reviewed binding works physically, but programmatic keyboard delivery to EU5 is documented as non-operational."
  }),

  markets: procedure({
    name: "markets",
    description: "Open the Markets sub-screen from an already verified Economy screen.",
    allowedInitialScreens: ["economy", "markets"],
    targetSchema: {
      type: "visible_control",
      role: "tab",
      exactLabels: ["Рынки", "Markets"]
    },
    expectedEvidence: { kind: "screen", screenId: "markets", exactVisibleText: "Рынки" },
    nonOperationalReason:
      "No coordinate-free semantic Computer Use route to the Markets tab has completed live proof."
  }),

  diplomacy: procedure({
    name: "diplomacy",
    description: "Open the Diplomacy screen without selecting a country or action.",
    allowedInitialScreens: ["map", "economy", "markets", "diplomacy", "military", "alerts"],
    targetSchema: { type: "reviewed_binding", bindingProfile: "agent-ctrl-fkeys.bindings" },
    expectedEvidence: { kind: "screen", screenId: "diplomacy", exactVisibleText: "Дипломатия" },
    nonOperationalReason:
      "The reviewed binding works physically, but programmatic keyboard delivery to EU5 is documented as non-operational."
  }),

  military: procedure({
    name: "military",
    description: "Open the Military screen without selecting a unit or issuing an order.",
    allowedInitialScreens: ["map", "economy", "markets", "diplomacy", "military", "alerts"],
    targetSchema: { type: "reviewed_binding", bindingProfile: "agent-ctrl-fkeys.bindings" },
    expectedEvidence: { kind: "screen", screenId: "military", exactVisibleText: "Военное дело" },
    nonOperationalReason:
      "The reviewed binding exists, but programmatic keyboard delivery to EU5 is documented as non-operational."
  }),

  alerts: procedure({
    name: "alerts",
    description: "Open the alerts screen without acknowledging an alert.",
    allowedInitialScreens: ["map", "economy", "markets", "diplomacy", "military", "alerts"],
    targetSchema: { type: "reviewed_binding", bindingProfile: "agent-ctrl-fkeys.bindings" },
    expectedEvidence: { kind: "screen", screenId: "alerts", alertsVisible: true },
    nonOperationalReason:
      "The reviewed binding exists, but programmatic keyboard delivery to EU5 is documented as non-operational."
  }),

  back: procedure({
    name: "back",
    description: "Activate the visible Back control once.",
    allowedInitialScreens: ["control_panel", "economy", "markets", "diplomacy", "military", "alerts"],
    targetSchema: {
      type: "visible_control",
      role: "button",
      exactLabels: ["Назад", "Back"]
    },
    expectedEvidence: { kind: "screen_transition", direction: "back", differentScreenRequired: true },
    nonOperationalReason:
      "No coordinate-free semantic Computer Use route to a Back control has completed live proof."
  }),

  close: procedure({
    name: "close",
    description: "Activate the visible Close control once; Escape is not used as an ambiguous fallback.",
    allowedInitialScreens: ["control_panel", "economy", "markets", "diplomacy", "military", "alerts"],
    targetSchema: {
      type: "visible_control",
      role: "button",
      exactLabels: ["Закрыть", "Close"],
      accessibleNameFallback: "close"
    },
    expectedEvidence: { kind: "screen", screenId: "map", panelClosed: true },
    nonOperationalReason:
      "No coordinate-free semantic Computer Use route to a Close control has completed live proof."
  })
});

function getProcedure(name) {
  if (typeof name !== "string" || !Object.hasOwn(PROCEDURES, name)) {
    throw new TypeError(`Unknown controlled EU5 procedure: ${name}`);
  }
  return PROCEDURES[name];
}

function listProcedures() {
  return Object.values(PROCEDURES);
}

module.exports = {
  CATALOG_ID,
  MAX_OBSERVATION_AGE_MS,
  EU5_PROCESS_NAME,
  EU5_WINDOW_TITLE,
  PROCEDURES,
  getProcedure,
  listProcedures
};
