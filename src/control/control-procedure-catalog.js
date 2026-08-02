"use strict";

const {
  DEFAULT_OBSERVATION_MAX_AGE_MS
} = require("./observation-policy");

const CATALOG_ID = "eu5.control-procedure-catalog/v1";
const MAX_OBSERVATION_AGE_MS = DEFAULT_OBSERVATION_MAX_AGE_MS;
const EU5_PROCESS_NAME = "eu5.exe";
const EU5_WINDOW_TITLE = "Europa Universalis V";

const COMMON_PRECONDITIONS = Object.freeze([
  "A fresh screenshot observation is available.",
  "Exactly one visible eu5.exe top-level window exists.",
  "No modal dialog is present.",
  "No text-entry field is focused.",
  "The disposable test-session marker and expected mod/build manifest match."
]);

const PANEL_INTERACTION_PRECONDITIONS = Object.freeze([
  "A fresh screenshot observation is available.",
  "Exactly one visible eu5.exe top-level window exists.",
  "The EU5 Control panel is positively identified in that screenshot.",
  "The debug console is positively observed as closed.",
  "The exact enabled button label is visible in the fresh screenshot.",
  "No stored coordinate or prior panel position is reused.",
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
    description: "Compatibility alias for pause_now.",
    riskClass: "reversible",
    allowedInitialScreens: ["*"],
    targetSchema: { type: "desired_game_state", paused: true },
    expectedEvidence: { kind: "game_state", paused: true },
    nonOperationalReason:
      "Programmatic keyboard delivery to EU5 is documented as non-operational; pause has no approved dispatch route."
  }),

  pause_now: procedure({
    name: "pause_now",
    description: "Move a running test campaign to the paused desired state; never toggle from an unknown state.",
    riskClass: "reversible",
    allowedInitialScreens: ["*"],
    targetSchema: { type: "desired_game_state", paused: true },
    expectedEvidence: { kind: "game_state", paused: true },
    nonOperationalReason:
      "No live-proven desired-state pause dispatch exists; the coordinator must execute and record this named action externally."
  }),

  confirm_paused: procedure({
    name: "confirm_paused",
    description: "Confirm from a fresh observation that the campaign is paused without sending input.",
    executionMode: "observation_only",
    allowModalObservation: true,
    operationalStatus: "operational_observation_only",
    authorization: "not_required",
    allowedInitialScreens: ["*"],
    preconditions: Object.freeze([
      "A fresh screenshot observation is available.",
      "Exactly one visible eu5.exe top-level window exists.",
      "Pause state is directly observable even if a modal is visible.",
      "No text-entry field is focused.",
      "The disposable test-session marker and expected mod/build manifest match."
    ]),
    targetSchema: { type: "observed_game_state", paused: true },
    expectedEvidence: { kind: "game_state", paused: true }
  }),

  dismiss_information_modal: procedure({
    name: "dismiss_information_modal",
    description: "Dismiss one verified information-only modal through its exact visible acknowledgement control.",
    riskClass: "reversible",
    allowedInitialScreens: ["*"],
    allowInformationModal: true,
    preconditions: Object.freeze([
      "A fresh screenshot observation is available.",
      "Exactly one visible eu5.exe top-level window exists.",
      "The modal is classified as information-only, not a decision.",
      "No text-entry field is focused.",
      "The disposable test-session marker and expected mod/build manifest match."
    ]),
    targetSchema: {
      type: "visible_control",
      role: "button",
      exactLabels: ["OK", "Close", "Закрыть"]
    },
    expectedEvidence: {
      kind: "modal_state",
      modalPresent: false
    },
    nonOperationalReason:
      "No exact visible-control route for information modals has completed the required live-proof repetitions."
  }),

  abort_to_pause: procedure({
    name: "abort_to_pause",
    description: "Emergency recovery procedure whose only admitted target state is paused.",
    riskClass: "reversible",
    allowedInitialScreens: ["*"],
    targetSchema: { type: "desired_game_state", paused: true, emergencyStop: true },
    expectedEvidence: { kind: "game_state", paused: true },
    nonOperationalReason:
      "Emergency pause remains externally executed until a desired-state route passes live proof."
  }),

  recover_known_screen: procedure({
    name: "recover_known_screen",
    description: "Confirm recovery to the stable map screen; no generic Escape sequence or arbitrary macro is emitted.",
    executionMode: "observation_only",
    operationalStatus: "operational_observation_only",
    authorization: "not_required",
    allowedInitialScreens: ["map"],
    targetSchema: { type: "observed_screen", screenId: "map" },
    expectedEvidence: { kind: "screen", screenId: "map" }
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

  dismiss_debug_console: procedure({
    name: "dismiss_debug_console",
    description:
      "Dismiss the positively observed debug console with one reviewed Backquote key press.",
    riskClass: "reversible",
    allowedInitialScreens: ["*"],
    preconditions: Object.freeze([
      "A fresh screenshot observation is available.",
      "Exactly one visible eu5.exe top-level window exists.",
      "The debug console is positively observed as visible.",
      "No arbitrary console text or command is entered.",
      "The disposable test-session marker and expected mod/build manifest match."
    ]),
    targetSchema: {
      type: "reviewed_single_key",
      exactKey: "Backquote",
      onlyWhenConsoleVisible: true,
      keyPressCount: 1,
      arbitraryKeysAccepted: false
    },
    expectedEvidence: {
      kind: "console_state",
      consoleVisible: false,
      consoleClosed: true,
      freshnessRequired: true
    },
    nonOperationalReason:
      "The reviewed Backquote step requires positive console visibility and a direct Computer Use live-proof repetition before catalogue admission."
  }),

  refresh_state: procedure({
    name: "refresh_state",
    description: "Request the fixed state-snapshot diagnostic record from the visible control panel.",
    allowedInitialScreens: ["control_panel"],
    preconditions: PANEL_INTERACTION_PRECONDITIONS,
    targetSchema: {
      type: "visible_control",
      role: "button",
      exactLabels: ["Emit state snapshot"],
      semanticLocatorRequired: true,
      consoleClosedRequired: true,
      freshScreenshotRequired: true,
      storedCoordinatesAllowed: false,
      panelPositionMayChange: true
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
      "Use the coordinate-free exact-label panel protocol; direct Computer Use activation still requires its live-proof repetitions before catalogue admission."
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
