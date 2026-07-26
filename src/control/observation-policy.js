"use strict";

const DEFAULT_OBSERVATION_MAX_AGE_MS = 45_000;
const MIN_OBSERVATION_MAX_AGE_MS = 1_000;
const MAX_OBSERVATION_MAX_AGE_MS = 300_000;
const OBSERVATION_MAX_AGE_ENV = "EU5_OBSERVATION_MAX_AGE_MS";

function parseObservationMaxAgeMs(value, source) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_OBSERVATION_MAX_AGE_MS ||
    parsed > MAX_OBSERVATION_MAX_AGE_MS
  ) {
    throw new TypeError(
      `${source} must be an integer between ${MIN_OBSERVATION_MAX_AGE_MS} and ${MAX_OBSERVATION_MAX_AGE_MS}`
    );
  }
  return parsed;
}

function resolveObservationMaxAgeMs({
  maxAgeMs,
  env = process.env
} = {}) {
  if (maxAgeMs !== undefined) {
    return parseObservationMaxAgeMs(maxAgeMs, "maxAgeMs");
  }
  const configured = env && env[OBSERVATION_MAX_AGE_ENV];
  if (configured !== undefined && configured !== "") {
    return parseObservationMaxAgeMs(configured, OBSERVATION_MAX_AGE_ENV);
  }
  return DEFAULT_OBSERVATION_MAX_AGE_MS;
}

module.exports = {
  DEFAULT_OBSERVATION_MAX_AGE_MS,
  MIN_OBSERVATION_MAX_AGE_MS,
  MAX_OBSERVATION_MAX_AGE_MS,
  OBSERVATION_MAX_AGE_ENV,
  resolveObservationMaxAgeMs
};
