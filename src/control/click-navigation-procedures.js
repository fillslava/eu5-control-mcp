"use strict";

const {
  resolveObservationMaxAgeMs
} = require("./observation-policy");
const {
  EU5_PROCESS_NAME,
  EU5_WINDOW_TITLE
} = require("./control-procedure-catalog");

// Kept only to fail closed for the deprecated viewport-shaped MCP request.
// These are dimensions, not click positions, and never produce coordinates.
const LEGACY_BASELINE_VIEWPORT = Object.freeze({ width: 1536, height: 900 });
const LEGACY_MAX_VIEWPORT_DEVIATION = 0.02;

const CLICK_PROCEDURES = Object.freeze({
  open_government_click: Object.freeze({
    role: "button",
    exactLabels: Object.freeze(["Government", "Правительство"]),
    expectedVisibleResult: "The Government panel is open."
  }),
  open_economy_click: Object.freeze({
    role: "button",
    exactLabels: Object.freeze(["Economy", "Экономика"]),
    expectedVisibleResult: "The Economy panel is open."
  }),
  open_production_click: Object.freeze({
    role: "button",
    exactLabels: Object.freeze(["Production", "Производство"]),
    expectedVisibleResult: "The Production panel is open."
  }),
  open_society_click: Object.freeze({
    role: "button",
    exactLabels: Object.freeze(["Society", "Общество"]),
    expectedVisibleResult: "The Society panel is open."
  }),
  open_diplomacy_click: Object.freeze({
    role: "button",
    exactLabels: Object.freeze(["Diplomacy", "Дипломатия"]),
    expectedVisibleResult: "The Diplomacy panel is open."
  }),
  open_military_click: Object.freeze({
    role: "button",
    exactLabels: Object.freeze(["Military", "Военное дело"]),
    expectedVisibleResult: "The Military panel is open."
  }),
  open_geopolitics_click: Object.freeze({
    role: "button",
    exactLabels: Object.freeze(["Geopolitics", "Геополитика"]),
    expectedVisibleResult: "The Geopolitics panel is open."
  }),
  open_advances_click: Object.freeze({
    role: "button",
    exactLabels: Object.freeze(["Advances", "Улучшения"]),
    expectedVisibleResult: "The Advances panel is open."
  })
});

const PANEL_BUTTON_PROCEDURES = Object.freeze({
  emit_ping: Object.freeze({
    role: "button",
    exactLabel: "Emit ping",
    expectedRecordType: "bridge_health",
    expectedProcedure: "emit_ping"
  }),
  emit_player_scope: Object.freeze({
    role: "button",
    exactLabel: "Emit player scope",
    expectedRecordType: "player_scope",
    expectedProcedure: "emit_player_scope"
  }),
  emit_state_snapshot: Object.freeze({
    role: "button",
    exactLabel: "Emit state snapshot",
    expectedRecordType: "state_snapshot",
    expectedProcedure: "emit_state_snapshot"
  }),
  export_nation_summary: Object.freeze({
    role: "button",
    exactLabel: "Export nation summary",
    expectedRecordType: "player_summary",
    expectedProcedure: "emit_player_summary"
  }),
  export_economy: Object.freeze({
    role: "button",
    exactLabel: "Export economy",
    expectedRecordType: "economy_snapshot",
    expectedProcedure: "emit_economy_snapshot"
  }),
  export_markets: Object.freeze({
    role: "button",
    exactLabel: "Export capital market",
    expectedRecordType: "markets_snapshot",
    expectedProcedure: "emit_markets_snapshot"
  }),
  export_diplomacy: Object.freeze({
    role: "button",
    exactLabel: "Export diplomacy",
    expectedRecordType: "diplomacy_snapshot",
    expectedProcedure: "emit_diplomacy_snapshot"
  }),
  export_military: Object.freeze({
    role: "button",
    exactLabel: "Export military",
    expectedRecordType: "military_snapshot",
    expectedProcedure: "emit_military_snapshot"
  })
});

const PANEL_PROCEDURE_ALIASES = Object.freeze({
  refresh_state: "emit_state_snapshot"
});

const DISMISS_DEBUG_CONSOLE = Object.freeze({
  name: "dismiss_debug_console",
  key: "Backquote",
  operation: "press_reviewed_key",
  expectedVisibleResult: "The debug console is no longer visible."
});
const PANEL_BUTTON_LABELS = new Set(
  Object.values(PANEL_BUTTON_PROCEDURES).map(({ exactLabel }) => exactLabel)
);
const CLICK_BUTTON_LABELS = new Set(
  Object.values(CLICK_PROCEDURES).flatMap(({ exactLabels }) => exactLabels)
);

function requireExactKeys(value, allowedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new TypeError(`${label}.${key} is not allowed.`);
    }
  }
}

function requireFreshScreenshot(observation, { now = Date.now(), maxObservationAgeMs } = {}) {
  if (!observation || typeof observation !== "object") {
    throw new TypeError("A screenshot observation is required.");
  }
  if (typeof observation.id !== "string" || observation.id.trim() === "") {
    throw new TypeError("observation.id is required.");
  }
  if (
    !observation.screenshot ||
    typeof observation.screenshot !== "object" ||
    typeof observation.screenshot.reference !== "string" ||
    observation.screenshot.reference.trim() === ""
  ) {
    throw new TypeError("A fresh screenshot reference is required.");
  }

  const capturedAtMs = Date.parse(observation.capturedAtUtc);
  if (!Number.isFinite(capturedAtMs)) {
    throw new TypeError("observation.capturedAtUtc must be ISO-8601.");
  }
  const allowedAgeMs = resolveObservationMaxAgeMs({ maxAgeMs: maxObservationAgeMs });
  const ageMs = now - capturedAtMs;
  if (ageMs < 0 || ageMs > allowedAgeMs) {
    throw new RangeError("The screenshot observation is stale or from the future.");
  }
  return Object.freeze({
    observationId: observation.id,
    screenshotReference: observation.screenshot.reference,
    observationAgeMs: ageMs,
    maxObservationAgeMs: allowedAgeMs
  });
}

function requireSafeControlContext(
  observation,
  allowedControlLabels = PANEL_BUTTON_LABELS
) {
  requireExactKeys(
    observation,
    [
      "id",
      "capturedAtUtc",
      "screenshot",
      "window",
      "game",
      "session",
      "screenId",
      "consoleVisible",
      "consoleClosed",
      "visibleControls"
    ],
    "observation"
  );
  requireExactKeys(observation.screenshot, ["reference"], "observation.screenshot");
  if (observation.screenshot.reference.length > 512) {
    throw new TypeError("observation.screenshot.reference is too long.");
  }
  if (!observation.window || typeof observation.window !== "object") {
    throw new TypeError("observation.window is required.");
  }
  requireExactKeys(
    observation.window,
    ["visibleEu5WindowCount", "processName", "title", "focused"],
    "observation.window"
  );
  if (
    observation.window.visibleEu5WindowCount !== 1 ||
    observation.window.processName !== EU5_PROCESS_NAME ||
    observation.window.title !== EU5_WINDOW_TITLE
  ) {
    throw new RangeError("Exactly one matching visible EU5 window is required.");
  }
  if (observation.window.focused !== true) {
    throw new RangeError("EU5 must be the confirmed foreground window.");
  }
  if (!observation.game || typeof observation.game !== "object") {
    throw new TypeError("observation.game is required.");
  }
  requireExactKeys(
    observation.game,
    ["paused", "modalPresent", "modalKind", "textEntryFocused"],
    "observation.game"
  );
  if (typeof observation.game.paused !== "boolean") {
    throw new TypeError("observation.game.paused must be a known boolean.");
  }
  if (
    observation.game.modalKind !== undefined &&
    !["none", "information", "decision", "unknown"].includes(
      observation.game.modalKind
    )
  ) {
    throw new TypeError("observation.game.modalKind is not allowed.");
  }
  if (observation.game.modalPresent !== false) {
    throw new RangeError("A modal dialog blocks controlled execution.");
  }
  if (observation.game.textEntryFocused !== false) {
    throw new RangeError("A text-entry field blocks controlled execution.");
  }
  if (!observation.session || typeof observation.session !== "object") {
    throw new TypeError("observation.session is required.");
  }
  requireExactKeys(
    observation.session,
    ["testMarkerMatched", "gameBuildMatched", "modManifestMatched"],
    "observation.session"
  );
  if (
    observation.session.testMarkerMatched !== true ||
    observation.session.gameBuildMatched !== true ||
    observation.session.modManifestMatched !== true
  ) {
    throw new RangeError(
      "The test marker, game build, and mod manifest must all match."
    );
  }
  if (
    !Array.isArray(observation.visibleControls) ||
    observation.visibleControls.length > 16
  ) {
    throw new TypeError(
      "observation.visibleControls must contain at most 16 controls."
    );
  }
  for (const [index, control] of observation.visibleControls.entries()) {
    const label = `observation.visibleControls[${index}]`;
    requireExactKeys(
      control,
      ["role", "label", "visible", "enabled"],
      label
    );
    if (
      control.role !== "button" ||
      !allowedControlLabels.has(control.label) ||
      typeof control.visible !== "boolean" ||
      typeof control.enabled !== "boolean"
    ) {
      throw new TypeError(`${label} is not an allowed semantic control.`);
    }
  }
}

function findExactVisibleControl(observation, role, exactLabels) {
  if (!Array.isArray(observation.visibleControls)) {
    throw new TypeError("observation.visibleControls must be an array.");
  }
  return observation.visibleControls.find((control) =>
    control &&
    control.role === role &&
    exactLabels.includes(control.label) &&
    control.visible === true &&
    control.enabled === true
  );
}

function semanticDispatch({ operation, role, exactLabels, observationId }) {
  return Object.freeze({
    operation,
    locator: Object.freeze({
      strategy: "exact_visible_label",
      role,
      exactLabels: Object.freeze([...exactLabels]),
      observationId
    }),
    coordinateSource: "fresh_screenshot_only",
    storedCoordinates: false,
    automaticRetry: false
  });
}

function isCompatibleLegacyViewport(viewport) {
  if (
    !viewport ||
    !Number.isInteger(viewport.width) ||
    !Number.isInteger(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return false;
  }
  const deviation = (actual, expected) => Math.abs(actual - expected) / expected;
  const baselineAspect = LEGACY_BASELINE_VIEWPORT.width / LEGACY_BASELINE_VIEWPORT.height;
  const actualAspect = viewport.width / viewport.height;
  return (
    deviation(viewport.width, LEGACY_BASELINE_VIEWPORT.width) <= LEGACY_MAX_VIEWPORT_DEVIATION &&
    deviation(viewport.height, LEGACY_BASELINE_VIEWPORT.height) <= LEGACY_MAX_VIEWPORT_DEVIATION &&
    deviation(actualAspect, baselineAspect) <= LEGACY_MAX_VIEWPORT_DEVIATION
  );
}

function preparePanelInteraction(
  name,
  observation,
  { now = Date.now(), maxObservationAgeMs } = {}
) {
  const canonicalName = PANEL_PROCEDURE_ALIASES[name] || name;
  const selected = PANEL_BUTTON_PROCEDURES[canonicalName];
  if (!selected) {
    throw new TypeError(`Unknown read-only panel procedure: ${name}`);
  }
  const freshness = requireFreshScreenshot(observation, { now, maxObservationAgeMs });
  requireSafeControlContext(observation);
  if (observation.screenId !== "control_panel") {
    throw new RangeError("The EU5 Control panel must be positively observed.");
  }
  if (observation.consoleVisible !== false || observation.consoleClosed !== true) {
    throw new RangeError(
      "The debug console must be positively observed as closed before a panel button is prepared."
    );
  }
  const target = findExactVisibleControl(
    observation,
    selected.role,
    [selected.exactLabel]
  );
  if (!target) {
    throw new RangeError(`The exact visible panel button "${selected.exactLabel}" was not observed.`);
  }

  return Object.freeze({
    schemaVersion: "eu5.semantic-panel-interaction/v1",
    name,
    risk: "read_only",
    observationId: freshness.observationId,
    screenshotReference: freshness.screenshotReference,
    observationAgeMs: freshness.observationAgeMs,
    maxObservationAgeMs: freshness.maxObservationAgeMs,
    consoleClosed: true,
    dispatch: semanticDispatch({
      operation: "click_visible_control",
      role: selected.role,
      exactLabels: [selected.exactLabel],
      observationId: freshness.observationId
    }),
    expectedEvidence: Object.freeze({
      kind: "fresh_debug_record",
      recordType: selected.expectedRecordType,
      procedure: selected.expectedProcedure
    }),
    verificationRequired: true
  });
}

function prepareConsoleDismiss(
  observation,
  { now = Date.now(), maxObservationAgeMs } = {}
) {
  const freshness = requireFreshScreenshot(observation, { now, maxObservationAgeMs });
  requireSafeControlContext(observation);
  if (observation.screenId !== "debug_console") {
    throw new RangeError("The EU5 debug console must be positively observed.");
  }
  if (observation.consoleVisible !== true || observation.consoleClosed === true) {
    throw new RangeError(
      "Backquote may be prepared only when the debug console is positively observed as visible."
    );
  }
  return Object.freeze({
    schemaVersion: "eu5.console-dismiss/v1",
    name: DISMISS_DEBUG_CONSOLE.name,
    risk: "reversible",
    observationId: freshness.observationId,
    screenshotReference: freshness.screenshotReference,
    dispatch: Object.freeze({
      operation: DISMISS_DEBUG_CONSOLE.operation,
      key: DISMISS_DEBUG_CONSOLE.key,
      keyPressCount: 1,
      observationId: freshness.observationId,
      automaticRetry: false
    }),
    expectedVisibleResult: DISMISS_DEBUG_CONSOLE.expectedVisibleResult,
    verificationRequired: true,
    nextStep:
      "Capture a new screenshot and require consoleClosed=true before preparing any panel button."
  });
}

function prepareClickNavigation(name, observation, options = {}) {
  const selected = CLICK_PROCEDURES[name];
  if (!selected) {
    throw new TypeError(`Unknown safe click navigation procedure: ${name}`);
  }

  // Preserve the old MCP call shape as a disabled response, but never derive or
  // expose coordinates from a viewport. New callers must pass a fresh screenshot.
  if (
    observation &&
    Number.isInteger(observation.width) &&
    Number.isInteger(observation.height) &&
    !observation.screenshot
  ) {
    if (!isCompatibleLegacyViewport(observation)) {
      throw new RangeError(
        "Deprecated viewport preparation is rejected outside the reviewed viewport envelope."
      );
    }
    return Object.freeze({
      id: `eu5.${name}`,
      name,
      viewport: Object.freeze({
        width: observation.width,
        height: observation.height
      }),
      status: "candidate_requires_live_proof",
      operational: false,
      dispatch: null,
      risk: "read_only",
      expectedVisibleResult: selected.expectedVisibleResult,
      nonOperationalReason:
        "Viewport calibration is obsolete. Capture a fresh screenshot and locate the exact visible label.",
      storedCoordinates: false,
      targetVerificationRequired: false,
      verificationRequired: true
    });
  }

  const freshness = requireFreshScreenshot(observation, options);
  requireSafeControlContext(observation, CLICK_BUTTON_LABELS);
  if (observation.consoleVisible !== false || observation.consoleClosed !== true) {
    throw new RangeError(
      "The debug console must be positively observed as closed before click navigation is prepared."
    );
  }
  const target = findExactVisibleControl(
    observation,
    selected.role,
    selected.exactLabels
  );
  if (!target) {
    throw new RangeError(
      `None of the exact visible labels for ${name} was observed in the fresh screenshot.`
    );
  }
  return Object.freeze({
    schemaVersion: "eu5.semantic-click-navigation/v1",
    id: `eu5.${name}`,
    name,
    risk: "read_only",
    observationId: freshness.observationId,
    screenshotReference: freshness.screenshotReference,
    dispatch: semanticDispatch({
      operation: "click_visible_control",
      role: selected.role,
      exactLabels: selected.exactLabels,
      observationId: freshness.observationId
    }),
    expectedVisibleResult: selected.expectedVisibleResult,
    verificationRequired: true
  });
}

module.exports = {
  CLICK_PROCEDURES,
  PANEL_BUTTON_PROCEDURES,
  PANEL_PROCEDURE_ALIASES,
  DISMISS_DEBUG_CONSOLE,
  requireFreshScreenshot,
  prepareClickNavigation,
  preparePanelInteraction,
  prepareConsoleDismiss
};
