"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CLICK_PROCEDURES,
  PANEL_BUTTON_PROCEDURES,
  PANEL_PROCEDURE_ALIASES,
  DISMISS_DEBUG_CONSOLE,
  prepareClickNavigation,
  preparePanelInteraction,
  prepareConsoleDismiss
} = require("../src/control/click-navigation-procedures");

const NOW = Date.parse("2026-07-26T20:30:00.000Z");

function observation(overrides = {}) {
  return {
    id: "screenshot-observation-1",
    capturedAtUtc: new Date(NOW - 500).toISOString(),
    screenshot: {
      reference: "computer-use:screenshot-1"
    },
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
    },
    screenId: "control_panel",
    consoleVisible: false,
    consoleClosed: true,
    visibleControls: [{
      role: "button",
      label: "Emit state snapshot",
      visible: true,
      enabled: true
    }],
    ...overrides
  };
}

function navigationObservation(overrides = {}) {
  return observation({
    screenId: "map",
    visibleControls: [{
      role: "button",
      label: "Economy",
      visible: true,
      enabled: true
    }],
    ...overrides
  });
}

test("navigation catalogue stores exact labels, never fixed coordinates", () => {
  assert.deepEqual(Object.keys(CLICK_PROCEDURES), [
    "open_government_click",
    "open_economy_click",
    "open_production_click",
    "open_society_click",
    "open_diplomacy_click",
    "open_military_click",
    "open_geopolitics_click",
    "open_advances_click"
  ]);
  for (const procedure of Object.values(CLICK_PROCEDURES)) {
    assert.equal(procedure.role, "button");
    assert.ok(procedure.exactLabels.length >= 2);
    assert.equal("x" in procedure, false);
    assert.equal("y" in procedure, false);
    assert.equal("bounds" in procedure, false);
  }
});

test("legacy viewport preparation stays disabled and exposes no coordinate", () => {
  const result = prepareClickNavigation(
    "open_economy_click",
    { width: 1536, height: 900 }
  );
  assert.equal(result.status, "candidate_requires_live_proof");
  assert.equal(result.operational, false);
  assert.equal(result.dispatch, null);
  assert.equal(result.storedCoordinates, false);
  assert.match(result.nonOperationalReason, /fresh screenshot/);
  assert.equal(JSON.stringify(result).includes("\"x\":"), false);
  assert.equal(JSON.stringify(result).includes("\"y\":"), false);
});

test("top-level navigation resolves an exact visible label from the fresh screenshot", () => {
  const result = prepareClickNavigation(
    "open_economy_click",
    navigationObservation(),
    { now: NOW }
  );

  assert.equal(result.dispatch.operation, "click_visible_control");
  assert.equal(result.dispatch.locator.strategy, "exact_visible_label");
  assert.deepEqual(result.dispatch.locator.exactLabels, ["Economy", "Экономика"]);
  assert.equal(result.dispatch.coordinateSource, "fresh_screenshot_only");
  assert.equal(result.dispatch.storedCoordinates, false);
  assert.equal("bounds" in result.dispatch, false);
});

test("top-level navigation requires the full safe control context", () => {
  for (const field of ["window", "game", "session"]) {
    assert.throws(
      () => prepareClickNavigation(
        "open_economy_click",
        navigationObservation({ [field]: undefined }),
        { now: NOW }
      ),
      new RegExp(`observation\\.${field} is required`)
    );
  }
});

test("top-level navigation rejects an open debug console", () => {
  assert.throws(
    () => prepareClickNavigation(
      "open_economy_click",
      navigationObservation({
        consoleVisible: true,
        consoleClosed: false
      }),
      { now: NOW }
    ),
    /positively observed as closed before click navigation/
  );
});

test("all visible control-panel procedures are finite and read-only", () => {
  assert.deepEqual(Object.keys(PANEL_BUTTON_PROCEDURES), [
    "emit_ping",
    "emit_player_scope",
    "emit_state_snapshot",
    "export_nation_summary",
    "export_economy",
    "export_markets",
    "export_diplomacy",
    "export_military"
  ]);
  for (const procedure of Object.values(PANEL_BUTTON_PROCEDURES)) {
    assert.equal(procedure.role, "button");
    assert.match(procedure.exactLabel, /^(Emit|Export) /);
    assert.equal("x" in procedure, false);
    assert.equal("y" in procedure, false);
  }
});

test("panel evidence mappings match the v0.5.0 scripted GUI producers", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(PANEL_BUTTON_PROCEDURES).map(([name, item]) => [
        name,
        [item.expectedRecordType, item.expectedProcedure]
      ])
    ),
    {
      emit_ping: ["bridge_health", "emit_ping"],
      emit_player_scope: ["player_scope", "emit_player_scope"],
      emit_state_snapshot: ["state_snapshot", "emit_state_snapshot"],
      export_nation_summary: ["player_summary", "emit_player_summary"],
      export_economy: ["economy_snapshot", "emit_economy_snapshot"],
      export_markets: ["markets_snapshot", "emit_markets_snapshot"],
      export_diplomacy: ["diplomacy_snapshot", "emit_diplomacy_snapshot"],
      export_military: ["military_snapshot", "emit_military_snapshot"]
    }
  );
});

test("moved panel remains valid because only the exact current label is retained", () => {
  const first = preparePanelInteraction(
    "refresh_state",
    observation(),
    { now: NOW }
  );
  const moved = preparePanelInteraction(
    "refresh_state",
    observation({
      id: "screenshot-observation-2",
      screenshot: {
        reference: "computer-use:screenshot-2"
      },
      visibleControls: [{
        role: "button",
        label: "Emit state snapshot",
        visible: true,
        enabled: true
      }]
    }),
    { now: NOW }
  );

  assert.deepEqual(first.dispatch.locator.exactLabels, ["Emit state snapshot"]);
  assert.deepEqual(moved.dispatch.locator.exactLabels, ["Emit state snapshot"]);
  assert.notEqual(first.screenshotReference, moved.screenshotReference);
  assert.equal(JSON.stringify(first).includes("\"bounds\""), false);
  assert.equal(JSON.stringify(moved).includes("\"bounds\""), false);
  assert.equal(JSON.stringify(moved).includes("\"x\""), false);
  assert.equal(JSON.stringify(moved).includes("\"y\""), false);
  assert.equal(first.name, "refresh_state");
  assert.equal(first.expectedEvidence.procedure, "emit_state_snapshot");
  assert.equal(PANEL_PROCEDURE_ALIASES.refresh_state, "emit_state_snapshot");
});

test("stale screenshot is rejected before any panel interaction is prepared", () => {
  assert.throws(
    () => preparePanelInteraction(
      "emit_state_snapshot",
      observation({
        capturedAtUtc: new Date(NOW - 45_001).toISOString()
      }),
      { now: NOW }
    ),
    /stale or from the future/
  );
});

test("panel interaction rejects an open or unknown console state", () => {
  for (const state of [
    { consoleVisible: true, consoleClosed: false },
    { consoleVisible: undefined, consoleClosed: undefined },
    { consoleVisible: false, consoleClosed: false }
  ]) {
    assert.throws(
      () => preparePanelInteraction(
        "emit_state_snapshot",
        observation(state),
        { now: NOW }
      ),
      /positively observed as closed/
    );
  }
});

test("semantic panel and console preparations enforce the full control context", () => {
  const unsafeContexts = [
    {
      override: { window: { ...observation().window, focused: false } },
      error: /confirmed foreground window/
    },
    {
      override: { window: { ...observation().window, visibleEu5WindowCount: 2 } },
      error: /Exactly one matching visible EU5 window/
    },
    {
      override: { game: { ...observation().game, modalPresent: true } },
      error: /modal dialog blocks/
    },
    {
      override: { game: { ...observation().game, textEntryFocused: true } },
      error: /text-entry field blocks/
    },
    {
      override: { session: { ...observation().session, modManifestMatched: false } },
      error: /test marker, game build, and mod manifest/
    }
  ];

  for (const { override, error } of unsafeContexts) {
    assert.throws(
      () => preparePanelInteraction(
        "emit_state_snapshot",
        observation(override),
        { now: NOW }
      ),
      error
    );
    assert.throws(
      () => prepareConsoleDismiss(
        observation({
          ...override,
          screenId: "debug_console",
          consoleVisible: true,
          consoleClosed: false,
          visibleControls: []
        }),
        { now: NOW }
      ),
      error
    );
  }
});

test("panel interaction rejects missing or inexact visible labels", () => {
  assert.throws(
    () => preparePanelInteraction(
      "emit_state_snapshot",
      observation({
        visibleControls: [{
          role: "button",
          label: "Export capital market",
          visible: true,
          enabled: true
        }]
      }),
      { now: NOW }
    ),
    /exact visible panel button/
  );
});

test("console dismissal is one named Backquote step only after positive observation", () => {
  const result = prepareConsoleDismiss(
    observation({
      screenId: "debug_console",
      consoleVisible: true,
      consoleClosed: false,
      visibleControls: []
    }),
    { now: NOW }
  );

  assert.equal(result.name, "dismiss_debug_console");
  assert.equal(result.dispatch.operation, "press_reviewed_key");
  assert.equal(result.dispatch.key, "Backquote");
  assert.equal(result.dispatch.keyPressCount, 1);
  assert.equal(result.dispatch.automaticRetry, false);
  assert.equal(DISMISS_DEBUG_CONSOLE.key, "Backquote");
  assert.match(result.nextStep, /new screenshot/);
  assert.equal("text" in result.dispatch, false);
  assert.equal("command" in result.dispatch, false);
  assert.equal("keys" in result.dispatch, false);
});

test("console dismissal fails closed when console is not positively visible", () => {
  for (const state of [
    { consoleVisible: false, consoleClosed: true },
    { consoleVisible: undefined, consoleClosed: undefined }
  ]) {
    assert.throws(
      () => prepareConsoleDismiss(
        observation({
          ...state,
          screenId: "debug_console",
          visibleControls: []
        }),
        { now: NOW }
      ),
      /only when the debug console is positively observed as visible/
    );
  }
});

test("unknown procedures and absent screenshots are rejected", () => {
  assert.throws(
    () => preparePanelInteraction("execute_console", observation(), { now: NOW }),
    /Unknown read-only panel procedure/
  );
  assert.throws(
    () => prepareClickNavigation("save_game_click", observation(), { now: NOW }),
    /Unknown safe click navigation procedure/
  );
  assert.throws(
    () => preparePanelInteraction(
      "emit_state_snapshot",
      observation({ screenshot: undefined }),
      { now: NOW }
    ),
    /fresh screenshot reference/
  );
  assert.throws(
    () => preparePanelInteraction(
      "emit_state_snapshot",
      { ...observation(), x: 42, y: 287 },
      { now: NOW }
    ),
    /observation.x is not allowed/
  );
});
