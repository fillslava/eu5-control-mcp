"use strict";

const BASELINE_VIEWPORT = Object.freeze({
  width: 1536,
  height: 900
});

const MAX_VIEWPORT_DEVIATION = 0.02;

const CLICK_PROCEDURES = Object.freeze({
  open_government_click: Object.freeze({
    x: 27,
    y: 121,
    expectedVisibleResult: "The Government panel is open."
  }),
  open_economy_click: Object.freeze({
    x: 84,
    y: 121,
    expectedVisibleResult: "The Economy panel is open."
  }),
  open_production_click: Object.freeze({
    x: 142,
    y: 121,
    expectedVisibleResult: "The Production panel is open."
  }),
  open_society_click: Object.freeze({
    x: 198,
    y: 121,
    expectedVisibleResult: "The Society panel is open."
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
  }),
  open_geopolitics_click: Object.freeze({
    x: 370,
    y: 121,
    expectedVisibleResult: "The Geopolitics panel is open."
  }),
  open_advances_click: Object.freeze({
    x: 426,
    y: 121,
    expectedVisibleResult: "The Advances panel is open."
  })
});

function relativeDeviation(actual, expected) {
  return Math.abs(actual - expected) / expected;
}

function isCompatibleViewport(viewport) {
  if (
    !viewport ||
    !Number.isInteger(viewport.width) ||
    !Number.isInteger(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return false;
  }

  const baselineAspectRatio = BASELINE_VIEWPORT.width / BASELINE_VIEWPORT.height;
  const viewportAspectRatio = viewport.width / viewport.height;

  return (
    relativeDeviation(viewport.width, BASELINE_VIEWPORT.width) <= MAX_VIEWPORT_DEVIATION &&
    relativeDeviation(viewport.height, BASELINE_VIEWPORT.height) <= MAX_VIEWPORT_DEVIATION &&
    relativeDeviation(viewportAspectRatio, baselineAspectRatio) <= MAX_VIEWPORT_DEVIATION
  );
}

function prepareClickNavigation(name, viewport) {
  const procedure = CLICK_PROCEDURES[name];
  if (!procedure) {
    throw new TypeError(`Unknown safe click navigation procedure: ${name}`);
  }

  if (!isCompatibleViewport(viewport)) {
    throw new RangeError(
      `Click navigation requires an EU5 viewport within 2% of the ${BASELINE_VIEWPORT.width}x${BASELINE_VIEWPORT.height} catalog baseline, including aspect ratio.`
    );
  }

  return {
    id: `eu5.${name}`,
    name,
    viewport: { width: viewport.width, height: viewport.height },
    status: "candidate_requires_live_proof",
    operational: false,
    dispatch: null,
    risk: "read_only",
    expectedVisibleResult: procedure.expectedVisibleResult,
    nonOperationalReason:
      "Legacy viewport-relative calibration is not a live-proven, coordinate-free Computer Use route. Coordinates are intentionally withheld.",
    targetVerificationRequired: false,
    verificationRequired: true,
    verification:
      "No click is prepared. A future semantic route requires three clean live repetitions and independent review before admission."
  };
}

module.exports = {
  BASELINE_VIEWPORT,
  MAX_VIEWPORT_DEVIATION,
  CLICK_PROCEDURES,
  isCompatibleViewport,
  prepareClickNavigation
};
