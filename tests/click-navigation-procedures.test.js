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

test("click navigation withholds coordinates and returns disabled candidates", () => {
  for (const name of Object.keys(CLICK_PROCEDURES)) {
    const result = prepareClickNavigation(name, BASELINE_VIEWPORT);
    assert.deepEqual(result.viewport, BASELINE_VIEWPORT);
    assert.equal(result.status, "candidate_requires_live_proof");
    assert.equal(result.operational, false);
    assert.equal(result.dispatch, null);
    assert.equal(result.risk, "read_only");
    assert.match(result.expectedVisibleResult, /panel is open\.$/);
    assert.equal(result.targetVerificationRequired, false);
    assert.equal(result.verificationRequired, true);
    assert.match(result.verification, /No click is prepared/);
    assert.match(result.nonOperationalReason, /Coordinates are intentionally withheld/);
    assert.equal("candidateComputerUseProcedure" in result, false);
    assert.equal("executor" in result, false);
    assert.equal("directComputerUseProcedure" in result, false);
    assert.equal("dispatched" in result, false);
  }
});

test("closely matching viewport still does not produce coordinates", () => {
  const viewport = { width: 1538, height: 895 };
  const result = prepareClickNavigation("open_economy_click", viewport);

  assert.deepEqual(result.viewport, viewport);
  assert.equal(result.operational, false);
  assert.equal(result.dispatch, null);
  assert.equal("candidateComputerUseProcedure" in result, false);
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
