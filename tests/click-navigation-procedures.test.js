"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CLICK_PROCEDURES,
  prepareClickNavigation
} = require("../src/control/click-navigation-procedures");

const BASELINE_VIEWPORT = { width: 1536, height: 900 };

test("click navigation catalog contains only the eight fixed procedures", () => {
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
});

test("click navigation returns baseline coordinates as non-operational candidates", () => {
  const expectedCoordinates = {
    open_government_click: [27, 121],
    open_economy_click: [84, 121],
    open_production_click: [142, 121],
    open_society_click: [198, 121],
    open_diplomacy_click: [256, 121],
    open_military_click: [313, 121],
    open_geopolitics_click: [370, 121],
    open_advances_click: [426, 121]
  };

  for (const [name, coordinate] of Object.entries(expectedCoordinates)) {
    const result = prepareClickNavigation(name, BASELINE_VIEWPORT);
    assert.deepEqual(result.candidateComputerUseProcedure, {
      action: "click",
      coordinate
    });
    assert.deepEqual(result.viewport, BASELINE_VIEWPORT);
    assert.equal(result.status, "provisional_non_operational");
    assert.equal(result.operational, false);
    assert.equal(result.risk, "read_only");
    assert.match(result.expectedVisibleResult, /panel is open\.$/);
    assert.equal(result.targetVerificationRequired, true);
    assert.match(result.targetVerification, /Do not execute.*fresh screenshot/);
    assert.equal(result.verificationRequired, true);
    assert.match(result.verification, /fresh visible UI observation/);
    assert.equal("executor" in result, false);
    assert.equal("directComputerUseProcedure" in result, false);
    assert.equal("dispatched" in result, false);
  }
});

test("click navigation scales coordinates for a closely matching viewport", () => {
  const viewport = { width: 1538, height: 895 };
  const result = prepareClickNavigation("open_economy_click", viewport);

  assert.deepEqual(result.viewport, viewport);
  assert.deepEqual(result.candidateComputerUseProcedure, {
    action: "click",
    coordinate: [84, 120]
  });
  assert.equal(result.operational, false);
  assert.equal(result.targetVerificationRequired, true);
});

test("click navigation rejects unknown actions", () => {
  assert.throws(
    () => prepareClickNavigation("save_game_click", BASELINE_VIEWPORT),
    /Unknown safe click navigation procedure/
  );
});

test("click navigation rejects missing or materially different viewports", () => {
  assert.throws(
    () => prepareClickNavigation("open_economy_click"),
    /within 2%/
  );
  assert.throws(
    () => prepareClickNavigation("open_economy_click", { width: 1280, height: 720 }),
    /within 2%/
  );
  assert.throws(
    () => prepareClickNavigation("open_economy_click", { width: 1566, height: 883 }),
    /including aspect ratio/
  );
});
