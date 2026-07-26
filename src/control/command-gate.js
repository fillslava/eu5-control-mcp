"use strict";

const {
  DEFAULT_OBSERVATION_MAX_AGE_MS,
  resolveObservationMaxAgeMs
} = require("./observation-policy");

const MAX_OBSERVATION_AGE_MS = DEFAULT_OBSERVATION_MAX_AGE_MS;

function validateFreshNavigationObservation(
  observation,
  now = Date.now(),
  { maxAgeMs } = {}
) {
  if (!observation || typeof observation !== "object") throw new TypeError("observation is required");
  if (typeof observation.id !== "string" || observation.id.length === 0) {
    throw new TypeError("observation.id is required");
  }
  const capturedAtMs = Date.parse(observation.capturedAtUtc);
  if (!Number.isFinite(capturedAtMs)) throw new TypeError("observation.capturedAtUtc must be ISO-8601");
  const observationAgeMs = now - capturedAtMs;
  const allowedAgeMs = resolveObservationMaxAgeMs({ maxAgeMs });
  if (observationAgeMs < 0 || observationAgeMs > allowedAgeMs) {
    throw new TypeError("observation is stale; capture a fresh UI state");
  }
  if (observation.paused !== true) throw new TypeError("navigation command requires a paused game");
  if (observation.modalPresent === true) throw new TypeError("navigation command blocked by a modal dialog");
  if (observation.textEntryFocused === true) throw new TypeError("navigation command blocked by a text-entry field");
  return { ...observation, capturedAtMs, observationAgeMs, maxObservationAgeMs: allowedAgeMs };
}

module.exports = { MAX_OBSERVATION_AGE_MS, validateFreshNavigationObservation };
