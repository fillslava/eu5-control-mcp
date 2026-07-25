"use strict";

const VERIFIED_VIEWPORT = Object.freeze({
  width: 1536,
  height: 900
});

const CLICK_PROCEDURES = Object.freeze({
  open_economy_click: Object.freeze({
    x: 84,
    y: 121,
    expectedVisibleResult: "The Economy panel is open."
  }),
  open_diplomacy_click: Object.freeze({
    x: 256,
    y: 121,
    expectedVisibleResult: "The Diplomacy panel is open."
  }),
  open_military_click: Object.freeze({
    x: 313,
    y: 121,
    expectedVisibleResult: "The Military panel is open."
  })
});

function prepareClickNavigation(name, viewport) {
  const procedure = CLICK_PROCEDURES[name];
  if (!procedure) {
    throw new TypeError(`Unknown safe click navigation procedure: ${name}`);
  }

  if (
    !viewport ||
    viewport.width !== VERIFIED_VIEWPORT.width ||
    viewport.height !== VERIFIED_VIEWPORT.height
  ) {
    throw new RangeError(
      `Click navigation requires an exact ${VERIFIED_VIEWPORT.width}x${VERIFIED_VIEWPORT.height} EU5 viewport.`
    );
  }

  return {
    id: `eu5.${name}`,
    name,
    viewport: { ...VERIFIED_VIEWPORT },
    risk: "read_only",
    expectedVisibleResult: procedure.expectedVisibleResult,
    directComputerUseProcedure: {
      action: "click",
      coordinate: [procedure.x, procedure.y]
    },
    verificationRequired: true,
    verification:
      "After an external Computer Use controller clicks the declared coordinate, capture a fresh visible UI observation and compare it with expectedVisibleResult."
  };
}

module.exports = {
  VERIFIED_VIEWPORT,
  CLICK_PROCEDURES,
  prepareClickNavigation
};
