"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CLICK_PROCEDURES,
  prepareClickNavigation
} = require("../src/control/click-navigation-procedures");

const VERIFIED_VIEWPORT = { width: 1536, height: 900 };

test("click navigation catalog contains only the three verified procedures", () => {
  assert.deepEqual(Object.keys(CLICK_PROCEDURES), [
    "open_economy_click",
    "open_diplomacy_click",
    "open_military_click"
  ]);
});

test("click navigation returns declared coordinates and a verification contract", () => {
  const expectedCoordinates = {
    open_economy_click: [84, 121],
    open_diplomacy_click: [256, 121],
    open_military_click: [313, 121]
  };

  for (const [name, coordinate] of Object.entries(expectedCoordinates)) {
    const result = prepareClickNavigation(name, VERIFIED_VIEWPORT);
    assert.deepEqual(result.directComputerUseProcedure, {
      action: "click",
      coordinate
    });
    assert.deepEqual(result.viewport, VERIFIED_VIEWPORT);
    assert.equal(result.risk, "read_only");
    assert.match(result.expectedVisibleResult, /panel is open\.$/);
    assert.equal(result.verificationRequired, true);
    assert.match(result.verification, /fresh visible UI observation/);
    assert.equal("executor" in result, false);
    assert.equal("dispatched" in result, false);
  }
});

test("click navigation rejects unknown actions", () => {
  assert.throws(
    () => prepareClickNavigation("save_game_click", VERIFIED_VIEWPORT),
    /Unknown safe click navigation procedure/
  );
});

test("click navigation rejects missing or non-matching viewports", () => {
  assert.throws(
    () => prepareClickNavigation("open_economy_click"),
    /exact 1536x900/
  );
  assert.throws(
    () => prepareClickNavigation("open_economy_click", { width: 1535, height: 900 }),
    /exact 1536x900/
  );
  assert.throws(
    () => prepareClickNavigation("open_economy_click", { width: 1536, height: 899 }),
    /exact 1536x900/
  );
});
