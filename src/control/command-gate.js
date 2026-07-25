"use strict";

const MAX_OBSERVATION_AGE_MS = 2000;

function validateFreshNavigationObservation(observation, now = Date.now()) {
  if (!observation || typeof observation !== "object") throw new TypeError("observation is required");
  if (typeof observation.id !== "string" || observation.id.length === 0) {
    throw new TypeError("observation.id is required");
  }
  const capturedAtMs = Date.parse(observation.capturedAtUtc);
  if (!Number.isFinite(capturedAtMs)) throw new TypeError("observation.capturedAtUtc must be ISO-8601");
  if (now - capturedAtMs > MAX_OBSERVATION_AGE_MS) {
    throw new TypeError("observation is stale; capture a fresh UI state");
  }
  if (observation.paused !== true) throw new TypeError("navigation command requires a paused game");
  if (observation.modalPresent === true) throw new TypeError("navigation command blocked by a modal dialog");
  if (observation.textEntryFocused === true) throw new TypeError("navigation command blocked by a text-entry field");
  return { ...observation, capturedAtMs };
}

module.exports = { MAX_OBSERVATION_AGE_MS, validateFreshNavigationObservation };
