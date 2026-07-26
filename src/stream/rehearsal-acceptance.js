"use strict";

const crypto = require("node:crypto");
const { validateMonitoringBundle } = require("../../dashboard/app.js");

const EXPECTATIONS_SCHEMA = "eu5.stream-readiness-expectations/v1";
const REPORT_SCHEMA = "eu5.stream-readiness-report/v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TERMINAL_LEDGER_STATES = new Set([
  "verified",
  "failed",
  "expired",
  "ambiguous",
  "execution_unknown"
]);
const REQUIRED_LEDGER_STATES = Object.freeze([
  "declared",
  "gated",
  "confirmed",
  "authorized",
  "dispatched",
  "acknowledged",
  "verified"
]);
const DEFAULT_THRESHOLDS = Object.freeze({
  minimumDurationMs: 30 * 60 * 1000,
  minimumBoundedAdvancements: 3,
  maximumAdvanceOvershootDays: 1,
  maximumTelemetryAgeMs: 30_000,
  maximumIngestLatencyMs: 5_000,
  minimumNavigationAttempts: 100,
  minimumNavigationSuccessRate: 0.99,
  maximumNavigationP95LatencyMs: 2_000,
  maximumUnknownOutcomes: 0,
  minimumProcedureSuccesses: 3
});
const DEFAULT_REQUIRED_DOMAINS = Object.freeze([
  "nation",
  "economy",
  "markets",
  "diplomacy",
  "military"
]);
const DEFAULT_REQUIRED_NAVIGATION = Object.freeze([
  "open_control_panel",
  "open_capital",
  "economy",
  "markets",
  "diplomacy",
  "military",
  "alerts"
]);
const DEFAULT_REQUIRED_HEALTH = Object.freeze([
  "test-session",
  "mod-bridge",
  "monitoring-feed",
  "control-ledger"
]);
const DEFAULT_REQUIRED_GAMEPLAY = Object.freeze([
  "economy_decision",
  "diplomacy_decision",
  "recruitment_inspection"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256`);
  }
  return value;
}

function parseUtc(value, label) {
  requireString(value, label);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !value.endsWith("Z")) {
    throw new TypeError(`${label} must be a UTC ISO-8601 timestamp`);
  }
  return parsed;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function computeLedgerRecordHash(record) {
  if (!isPlainObject(record)) throw new TypeError("ledger record must be an object");
  const copy = { ...record };
  delete copy.recordHash;
  return crypto.createHash("sha256").update(stableStringify(copy)).digest("hex");
}

function computeMonitoringManifestHash(bundle) {
  if (!isPlainObject(bundle)) throw new TypeError("monitoring bundle must be an object");
  const manifest = {
    schemaVersion: bundle.schemaVersion,
    bundleId: bundle.bundleId,
    generatedAtUtc: bundle.generatedAtUtc,
    sourceMode: bundle.sourceMode,
    records: bundle.records
  };
  return crypto.createHash("sha256").update(stableStringify(manifest)).digest("hex");
}

function computeEvidenceRecordHash(record) {
  if (!isPlainObject(record)) throw new TypeError("evidence record must be an object");
  const copy = { ...record };
  delete copy.sequence;
  return crypto.createHash("sha256").update(stableStringify(copy)).digest("hex");
}

function validGameDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1];
}

function freezeStrings(value, label, fallback) {
  const selected = value === undefined ? fallback : value;
  if (!Array.isArray(selected) || selected.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  const values = selected.map((item, index) => requireString(item, `${label}[${index}]`));
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${label} must not contain duplicates`);
  }
  return Object.freeze(values);
}

function requiredPolicySuperset(value, label, required) {
  const accepted = freezeStrings(value, label, required);
  const missing = required.filter((item) => !accepted.includes(item));
  if (missing.length) {
    throw new TypeError(
      `${label} cannot omit default requirements: ${missing.join(", ")}`
    );
  }
  return accepted;
}

function positiveNumber(value, label, fallback, { minimum = 0, maximum = Infinity } = {}) {
  const selected = value === undefined ? fallback : value;
  if (!Number.isFinite(selected) || selected < minimum || selected > maximum) {
    throw new TypeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return selected;
}

function validateExpectations(expectations) {
  if (!isPlainObject(expectations)) throw new TypeError("expectations must be an object");
  if (expectations.schemaVersion !== EXPECTATIONS_SCHEMA) {
    throw new TypeError(`expectations.schemaVersion must be ${EXPECTATIONS_SCHEMA}`);
  }
  const fingerprint = expectations.fingerprint;
  if (!isPlainObject(fingerprint)) throw new TypeError("expectations.fingerprint must be an object");
  const validatedFingerprint = Object.freeze({
    campaignId: requireString(fingerprint.campaignId, "fingerprint.campaignId"),
    countryId: requireString(fingerprint.countryId, "fingerprint.countryId"),
    gameBuild: requireString(fingerprint.gameBuild, "fingerprint.gameBuild"),
    modVersion: requireString(fingerprint.modVersion, "fingerprint.modVersion"),
    modManifestSha256: requireSha256(
      fingerprint.modManifestSha256,
      "fingerprint.modManifestSha256"
    ),
    seedSaveSha256: requireSha256(fingerprint.seedSaveSha256, "fingerprint.seedSaveSha256")
  });
  const supplied = isPlainObject(expectations.thresholds) ? expectations.thresholds : {};
  const thresholds = Object.freeze({
    minimumDurationMs: positiveNumber(
      supplied.minimumDurationMs,
      "thresholds.minimumDurationMs",
      DEFAULT_THRESHOLDS.minimumDurationMs,
      { minimum: 1 }
    ),
    minimumBoundedAdvancements: positiveNumber(
      supplied.minimumBoundedAdvancements,
      "thresholds.minimumBoundedAdvancements",
      DEFAULT_THRESHOLDS.minimumBoundedAdvancements,
      { minimum: 1 }
    ),
    maximumAdvanceOvershootDays: positiveNumber(
      supplied.maximumAdvanceOvershootDays,
      "thresholds.maximumAdvanceOvershootDays",
      DEFAULT_THRESHOLDS.maximumAdvanceOvershootDays
    ),
    maximumTelemetryAgeMs: positiveNumber(
      supplied.maximumTelemetryAgeMs,
      "thresholds.maximumTelemetryAgeMs",
      DEFAULT_THRESHOLDS.maximumTelemetryAgeMs,
      { minimum: 1 }
    ),
    maximumIngestLatencyMs: positiveNumber(
      supplied.maximumIngestLatencyMs,
      "thresholds.maximumIngestLatencyMs",
      DEFAULT_THRESHOLDS.maximumIngestLatencyMs,
      { minimum: 1 }
    ),
    minimumNavigationAttempts: positiveNumber(
      supplied.minimumNavigationAttempts,
      "thresholds.minimumNavigationAttempts",
      DEFAULT_THRESHOLDS.minimumNavigationAttempts,
      { minimum: 1 }
    ),
    minimumNavigationSuccessRate: positiveNumber(
      supplied.minimumNavigationSuccessRate,
      "thresholds.minimumNavigationSuccessRate",
      DEFAULT_THRESHOLDS.minimumNavigationSuccessRate,
      { minimum: 0, maximum: 1 }
    ),
    maximumNavigationP95LatencyMs: positiveNumber(
      supplied.maximumNavigationP95LatencyMs,
      "thresholds.maximumNavigationP95LatencyMs",
      DEFAULT_THRESHOLDS.maximumNavigationP95LatencyMs,
      { minimum: 1 }
    ),
    maximumUnknownOutcomes: positiveNumber(
      supplied.maximumUnknownOutcomes,
      "thresholds.maximumUnknownOutcomes",
      DEFAULT_THRESHOLDS.maximumUnknownOutcomes
    ),
    minimumProcedureSuccesses: positiveNumber(
      supplied.minimumProcedureSuccesses,
      "thresholds.minimumProcedureSuccesses",
      DEFAULT_THRESHOLDS.minimumProcedureSuccesses,
      { minimum: 1 }
    )
  });
  for (const field of [
    "minimumBoundedAdvancements",
    "minimumNavigationAttempts",
    "maximumUnknownOutcomes",
    "minimumProcedureSuccesses"
  ]) {
    if (!Number.isSafeInteger(thresholds[field])) {
      throw new TypeError(`thresholds.${field} must be an integer`);
    }
  }
  for (const field of [
    "minimumDurationMs",
    "minimumBoundedAdvancements",
    "minimumNavigationAttempts",
    "minimumNavigationSuccessRate",
    "minimumProcedureSuccesses"
  ]) {
    if (thresholds[field] < DEFAULT_THRESHOLDS[field]) {
      throw new TypeError(`thresholds.${field} cannot weaken the default policy`);
    }
  }
  for (const field of [
    "maximumAdvanceOvershootDays",
    "maximumTelemetryAgeMs",
    "maximumIngestLatencyMs",
    "maximumNavigationP95LatencyMs",
    "maximumUnknownOutcomes"
  ]) {
    if (thresholds[field] > DEFAULT_THRESHOLDS[field]) {
      throw new TypeError(`thresholds.${field} cannot weaken the default policy`);
    }
  }
  return Object.freeze({
    schemaVersion: EXPECTATIONS_SCHEMA,
    fingerprint: validatedFingerprint,
    thresholds,
    requiredDomains: requiredPolicySuperset(
      expectations.requiredDomains,
      "requiredDomains",
      DEFAULT_REQUIRED_DOMAINS
    ),
    requiredNavigationProcedures: requiredPolicySuperset(
      expectations.requiredNavigationProcedures,
      "requiredNavigationProcedures",
      DEFAULT_REQUIRED_NAVIGATION
    ),
    requiredHealthComponents: requiredPolicySuperset(
      expectations.requiredHealthComponents,
      "requiredHealthComponents",
      DEFAULT_REQUIRED_HEALTH
    ),
    requiredGameplayCapabilities: requiredPolicySuperset(
      expectations.requiredGameplayCapabilities,
      "requiredGameplayCapabilities",
      DEFAULT_REQUIRED_GAMEPLAY
    )
  });
}

function criterion(id, passed, summary, evidence = {}) {
  return Object.freeze({
    id,
    status: passed ? "pass" : "fail",
    summary,
    evidence: Object.freeze(evidence)
  });
}

function verifiedFresh(record) {
  return record.provenance.verification.status === "verified" &&
    record.provenance.freshness === "fresh";
}

function verifyLedgerHashChain(ledger) {
  if (!Array.isArray(ledger)) throw new TypeError("ledger must be an array");
  let previousHash = null;
  const errors = [];
  ledger.forEach((record, index) => {
    if (!isPlainObject(record)) {
      errors.push(`ledger[${index}] is not an object`);
      return;
    }
    if (record.sequence !== index) errors.push(`ledger[${index}].sequence is not ${index}`);
    if (record.previousHash !== previousHash) {
      errors.push(`ledger[${index}].previousHash does not match`);
    }
    if (!SHA256_PATTERN.test(record.recordHash || "")) {
      errors.push(`ledger[${index}].recordHash is missing`);
    } else if (computeLedgerRecordHash(record) !== record.recordHash) {
      errors.push(`ledger[${index}].recordHash is invalid`);
    }
    previousHash = record.recordHash || null;
  });
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function lifecycleState(record) {
  return record.lifecycleState || record.type || record.state;
}

function ledgerDeclarationId(record) {
  return record.declarationId ||
    (record.type === "declared" ? record.declarationId : null) ||
    record.correlationId;
}

function assessLedgerCompleteness(ledger) {
  const groups = new Map();
  for (const record of ledger) {
    const declarationId = ledgerDeclarationId(record);
    if (!declarationId) continue;
    if (!groups.has(declarationId)) groups.set(declarationId, []);
    groups.get(declarationId).push(record);
  }
  const incomplete = [];
  const outOfOrder = [];
  const duplicateStates = [];
  const invalidTerminals = [];
  const nonVerified = [];
  let unknownOutcomes = 0;
  for (const [declarationId, records] of groups) {
    const states = records.map(lifecycleState);
    const missing = REQUIRED_LEDGER_STATES.filter((state) => !states.includes(state));
    if (missing.length) incomplete.push({ declarationId, missing });
    const duplicated = REQUIRED_LEDGER_STATES.filter((state) =>
      states.filter((candidate) => candidate === state).length !== 1
    );
    if (duplicated.length) duplicateStates.push({ declarationId, states: duplicated });
    const positions = REQUIRED_LEDGER_STATES.map((state) => states.indexOf(state));
    const ordered = positions.every((position, index) =>
      position >= 0 && (index === 0 || position > positions[index - 1])
    );
    if (!ordered && missing.length === 0) outOfOrder.push(declarationId);
    const terminalRecords = records.filter((record) =>
      TERMINAL_LEDGER_STATES.has(lifecycleState(record))
    );
    const terminal = terminalRecords[0];
    const terminalIndex = terminal ? records.indexOf(terminal) : -1;
    if (
      terminalRecords.length !== 1 ||
      !terminal ||
      lifecycleState(terminal) !== "verified" ||
      terminal.verified !== true ||
      terminalIndex !== records.length - 1
    ) {
      invalidTerminals.push(declarationId);
      nonVerified.push(declarationId);
    }
    unknownOutcomes += states.filter((state) => state === "execution_unknown" || state === "ambiguous").length;
  }
  return Object.freeze({
    declarations: groups.size,
    incomplete: Object.freeze(incomplete),
    outOfOrder: Object.freeze(outOfOrder),
    duplicateStates: Object.freeze(duplicateStates),
    invalidTerminals: Object.freeze(invalidTerminals),
    nonVerified: Object.freeze(nonVerified),
    unknownOutcomes
  });
}

function fingerprintMatches(actual, expected) {
  return isPlainObject(actual) && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function percentile95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function latestBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const existing = map.get(key);
    if (!existing || Date.parse(item.occurredAtUtc) > Date.parse(existing.occurredAtUtc)) {
      map.set(key, item);
    }
  }
  return map;
}

function evaluateStreamReadiness({ bundle, ledger, expectations, generatedAtUtc } = {}) {
  validateMonitoringBundle(bundle);
  const accepted = validateExpectations(expectations);
  const reportGeneratedAtMs = generatedAtUtc === undefined
    ? Date.now()
    : parseUtc(generatedAtUtc, "generatedAtUtc");
  const rehearsalCompletedAtMs = parseUtc(bundle.generatedAtUtc, "bundle.generatedAtUtc");
  const criteria = [];
  const records = bundle.records;
  const recordIds = records.map((record) => record.recordId);
  if (new Set(recordIds).size !== recordIds.length) {
    throw new TypeError("monitoring bundle recordId values must be unique");
  }
  const monitoringIntegrityValid =
    bundle.integrity.manifestSha256 === computeMonitoringManifestHash(bundle);
  criteria.push(criterion(
    "monitoring-integrity",
    monitoringIntegrityValid,
    monitoringIntegrityValid
      ? "The monitoring manifest hash covers the complete bundle."
      : "The monitoring manifest hash is missing or does not cover the supplied records.",
    { declaredManifestSha256: bundle.integrity.manifestSha256 || null }
  ));
  const recordSequences = records.map((record) => record.sequence);
  const chronologyErrors = [];
  records.forEach((record) => {
    const occurredAt = Date.parse(record.occurredAtUtc);
    const recordedAt = Date.parse(record.recordedAtUtc);
    if (recordedAt < occurredAt) chronologyErrors.push(`${record.recordId}:recorded-before-occurred`);
    if (recordedAt > rehearsalCompletedAtMs) chronologyErrors.push(`${record.recordId}:after-bundle-generation`);
  });
  if (
    new Set(recordSequences).size !== recordSequences.length ||
    !recordSequences.every((sequence, index) => sequence === index)
  ) {
    chronologyErrors.push("record-sequences-not-contiguous");
  }
  criteria.push(criterion(
    "artifact-chronology",
    chronologyErrors.length === 0,
    chronologyErrors.length === 0
      ? "Monitoring records are ordered, contiguous, and bounded by bundle generation."
      : "Monitoring record sequence or timestamps are inconsistent.",
    { errors: chronologyErrors }
  ));
  const startRecords = records.filter((record) =>
    record.recordType === "game_event" &&
    record.payload.eventType === "rehearsal_started" &&
    record.payload.rehearsalId === bundle.bundleId &&
    record.provenance.verification.status === "verified"
  );
  const completionRecords = records.filter((record) =>
    record.recordType === "game_event" &&
    record.payload.eventType === "rehearsal_completed" &&
    record.payload.rehearsalId === bundle.bundleId &&
    record.provenance.verification.status === "verified"
  );
  const startAtMs = startRecords.length === 1
    ? Date.parse(startRecords[0].occurredAtUtc)
    : null;
  const completedAtMs = completionRecords.length === 1
    ? Date.parse(completionRecords[0].occurredAtUtc)
    : null;
  const durationMs = startAtMs !== null && completedAtMs !== null && completedAtMs >= startAtMs
    ? completedAtMs - startAtMs
    : 0;
  const boundariesValid = startRecords.length === 1 &&
    completionRecords.length === 1 &&
    completedAtMs >= startAtMs;
  criteria.push(criterion(
    "rehearsal-duration",
    boundariesValid && durationMs >= accepted.thresholds.minimumDurationMs,
    boundariesValid && durationMs >= accepted.thresholds.minimumDurationMs
      ? `Observed rehearsal duration is ${Math.round(durationMs / 60000)} minutes.`
      : `Explicit rehearsal boundaries are missing or shorter than ${Math.round(accepted.thresholds.minimumDurationMs / 60000)} minutes.`,
    {
      durationMs,
      minimumDurationMs: accepted.thresholds.minimumDurationMs,
      startRecords: startRecords.length,
      completionRecords: completionRecords.length
    }
  ));
  const inRehearsalWindow = (record) => {
    if (!boundariesValid || record.captureSessionId !== bundle.bundleId) return false;
    const occurredAtMs = Date.parse(record.occurredAtUtc);
    const recordedAtMs = Date.parse(record.recordedAtUtc);
    const isBoundary = record.recordType === "game_event" &&
      ["rehearsal_started", "rehearsal_completed"].includes(record.payload.eventType);
    return occurredAtMs >= startAtMs &&
      occurredAtMs <= completedAtMs &&
      (isBoundary || (recordedAtMs >= startAtMs && recordedAtMs <= completedAtMs));
  };
  const operationalRecords = records.filter((record) =>
    ["health", "llm_action_proposed", "llm_action_outcome", "nation_snapshot", "game_event"]
      .includes(record.recordType)
  );
  const outsideSessionRecords = operationalRecords
    .filter((record) => !inRehearsalWindow(record))
    .map((record) => record.recordId);
  criteria.push(criterion(
    "rehearsal-session-binding",
    boundariesValid && outsideSessionRecords.length === 0,
    boundariesValid && outsideSessionRecords.length === 0
      ? "All counted evidence is bound to the explicit rehearsal session and time window."
      : "Monitoring evidence is outside the rehearsal session or explicit time window.",
    { recordIds: outsideSessionRecords }
  ));
  const rehearsalRecords = records.filter(inRehearsalWindow);

  const sessionRecords = rehearsalRecords.filter((record) =>
    record.recordType === "health" &&
    record.payload.component === "test-session" &&
    record.subject.campaignId === accepted.fingerprint.campaignId &&
    record.subject.countryId === accepted.fingerprint.countryId &&
    verifiedFresh(record)
  );
  const fingerprintRecord = [...sessionRecords].sort((left, right) =>
    Date.parse(left.occurredAtUtc) - Date.parse(right.occurredAtUtc)
  ).at(-1);
  const fingerprintAgeMs = fingerprintRecord
    ? reportGeneratedAtMs - Date.parse(fingerprintRecord.occurredAtUtc)
    : null;
  const fingerprintValid = Boolean(
    fingerprintRecord &&
    fingerprintMatches(fingerprintRecord.payload.fingerprint, accepted.fingerprint) &&
    fingerprintAgeMs >= 0 &&
    fingerprintAgeMs <= accepted.thresholds.maximumTelemetryAgeMs
  );
  criteria.push(criterion(
    "campaign-fingerprint",
    fingerprintValid,
    fingerprintValid
      ? "Campaign, country, build, mod manifest, and seed save match."
      : "No fresh verified test-session record matches the expected fingerprint.",
    {
      recordId: fingerprintRecord ? fingerprintRecord.recordId : null,
      ageMs: fingerprintAgeMs
    }
  ));

  const health = latestBy(rehearsalRecords.filter((record) =>
    record.recordType === "health" && verifiedFresh(record)
  ), (record) => record.payload.component);
  const missingHealth = accepted.requiredHealthComponents.filter((component) => {
    const record = health.get(component);
    if (!record || record.payload.status !== "available") return true;
    const ageMs = reportGeneratedAtMs - Date.parse(record.occurredAtUtc);
    return ageMs < 0 || ageMs > accepted.thresholds.maximumTelemetryAgeMs;
  });
  criteria.push(criterion(
    "component-health",
    missingHealth.length === 0,
    missingHealth.length === 0
      ? "All required stream components report fresh verified health."
      : `Missing healthy components: ${missingHealth.join(", ")}.`,
    { missingComponents: missingHealth }
  ));

  const mixedSubjectRecords = rehearsalRecords.filter((record) =>
    ["llm_action_proposed", "llm_action_outcome", "nation_snapshot", "game_event"].includes(
      record.recordType
    ) && (
      record.subject.campaignId !== accepted.fingerprint.campaignId ||
      record.subject.countryId !== accepted.fingerprint.countryId
    )
  );
  criteria.push(criterion(
    "campaign-isolation",
    mixedSubjectRecords.length === 0,
    mixedSubjectRecords.length === 0
      ? "All operational evidence belongs to the expected campaign and country."
      : "The rehearsal bundle mixes operational evidence from another campaign or country.",
    { recordIds: mixedSubjectRecords.map((record) => record.recordId) }
  ));

  const domainRecords = rehearsalRecords.filter((record) =>
    record.recordType === "nation_snapshot" &&
    verifiedFresh(record) &&
    record.subject.campaignId === accepted.fingerprint.campaignId &&
    record.subject.countryId === accepted.fingerprint.countryId &&
    typeof record.payload.domain === "string"
  );
  const latestDomains = latestBy(domainRecords, (record) => record.payload.domain);
  const missingDomains = accepted.requiredDomains.filter((domain) => !latestDomains.has(domain));
  criteria.push(criterion(
    "required-domain-observations",
    missingDomains.length === 0,
    missingDomains.length === 0
      ? "All required nation domains have fresh verified observations."
      : `Missing verified domains: ${missingDomains.join(", ")}.`,
    { missingDomains }
  ));

  const telemetryRecords = accepted.requiredDomains
    .map((domain) => latestDomains.get(domain))
    .filter(Boolean);
  const staleTelemetry = telemetryRecords.filter((record) =>
    reportGeneratedAtMs - Date.parse(record.occurredAtUtc) < 0 ||
    reportGeneratedAtMs - Date.parse(record.occurredAtUtc) >
      accepted.thresholds.maximumTelemetryAgeMs
  );
  const slowIngest = telemetryRecords.filter((record) =>
    Date.parse(record.recordedAtUtc) - Date.parse(record.occurredAtUtc) < 0 ||
    Date.parse(record.recordedAtUtc) - Date.parse(record.occurredAtUtc) >
      accepted.thresholds.maximumIngestLatencyMs
  );
  criteria.push(criterion(
    "telemetry-freshness",
    missingDomains.length === 0 && staleTelemetry.length === 0 && slowIngest.length === 0,
    missingDomains.length === 0 && staleTelemetry.length === 0 && slowIngest.length === 0
      ? "Required telemetry is current and ingested within the stream latency budget."
      : "Required telemetry is missing, stale, or ingested too slowly.",
    {
      staleRecordIds: staleTelemetry.map((record) => record.recordId),
      slowRecordIds: slowIngest.map((record) => record.recordId),
      maximumTelemetryAgeMs: accepted.thresholds.maximumTelemetryAgeMs,
      maximumIngestLatencyMs: accepted.thresholds.maximumIngestLatencyMs
    }
  ));

  const advancements = rehearsalRecords.filter((record) =>
    record.recordType === "game_event" &&
    record.payload.eventType === "bounded_time_advance" &&
    record.subject.campaignId === accepted.fingerprint.campaignId &&
    record.subject.countryId === accepted.fingerprint.countryId
  );
  const nationEvidenceByHash = new Map(
    rehearsalRecords
      .filter((record) =>
        record.recordType === "nation_snapshot" &&
        record.payload.domain === "nation" &&
        verifiedFresh(record)
      )
      .map((record) => [computeEvidenceRecordHash(record), record])
  );
  const evidencePairCounts = new Map();
  const advancementIntervals = new Map();
  for (const record of advancements) {
    const pair = `${record.payload.beforeEvidenceSha256}:${record.payload.afterEvidenceSha256}`;
    evidencePairCounts.set(pair, (evidencePairCounts.get(pair) || 0) + 1);
    const beforeEvidence = nationEvidenceByHash.get(
      record.payload.beforeEvidenceSha256
    );
    const afterEvidence = nationEvidenceByHash.get(
      record.payload.afterEvidenceSha256
    );
    if (beforeEvidence && afterEvidence) {
      advancementIntervals.set(record.recordId, {
        startMs: Date.parse(beforeEvidence.occurredAtUtc),
        endMs: Date.parse(afterEvidence.occurredAtUtc)
      });
    }
  }
  const overlappingAdvancementIds = new Set();
  const intervalEntries = [...advancementIntervals.entries()];
  for (let leftIndex = 0; leftIndex < intervalEntries.length; leftIndex += 1) {
    const [leftId, left] = intervalEntries[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < intervalEntries.length;
      rightIndex += 1
    ) {
      const [rightId, right] = intervalEntries[rightIndex];
      if (left.startMs < right.endMs && right.startMs < left.endMs) {
        overlappingAdvancementIds.add(leftId);
        overlappingAdvancementIds.add(rightId);
      }
    }
  }
  const unsafeAdvancements = advancements.filter((record) =>
    {
      const beforeHash = record.payload.beforeEvidenceSha256;
      const afterHash = record.payload.afterEvidenceSha256;
      const beforeEvidence = nationEvidenceByHash.get(beforeHash);
      const afterEvidence = nationEvidenceByHash.get(afterHash);
      const evidencePair = `${beforeHash}:${afterHash}`;
      return (
        !verifiedFresh(record) ||
        record.payload.bounded !== true ||
        record.payload.beforePaused !== true ||
        record.payload.afterPaused !== true ||
        !validGameDate(record.payload.beforeGameDate) ||
        !validGameDate(record.payload.afterGameDate) ||
        record.payload.afterGameDate <= record.payload.beforeGameDate ||
        !Number.isSafeInteger(record.payload.overshootDays) ||
        record.payload.overshootDays < 0 ||
        record.payload.overshootDays >
          accepted.thresholds.maximumAdvanceOvershootDays ||
        !SHA256_PATTERN.test(beforeHash || "") ||
        !SHA256_PATTERN.test(afterHash || "") ||
        beforeHash === afterHash ||
        evidencePairCounts.get(evidencePair) !== 1 ||
        overlappingAdvancementIds.has(record.recordId) ||
        !beforeEvidence ||
        !afterEvidence ||
        beforeEvidence.recordId === afterEvidence.recordId ||
        beforeEvidence.payload.paused !== true ||
        afterEvidence.payload.paused !== true ||
        beforeEvidence.payload.gameDate !== record.payload.beforeGameDate ||
        afterEvidence.payload.gameDate !== record.payload.afterGameDate ||
        Date.parse(beforeEvidence.occurredAtUtc) >=
          Date.parse(afterEvidence.occurredAtUtc) ||
        Date.parse(beforeEvidence.recordedAtUtc) >=
          Date.parse(afterEvidence.recordedAtUtc) ||
        Date.parse(record.occurredAtUtc) <
          Date.parse(afterEvidence.occurredAtUtc) ||
        Date.parse(record.recordedAtUtc) <
          Date.parse(afterEvidence.recordedAtUtc)
      );
    }
  );
  criteria.push(criterion(
    "pause-and-bounded-time",
    advancements.length >= accepted.thresholds.minimumBoundedAdvancements &&
      unsafeAdvancements.length === 0,
    advancements.length >= accepted.thresholds.minimumBoundedAdvancements &&
      unsafeAdvancements.length === 0
      ? "Time advancement remained bounded and returned to a verified pause."
      : "Bounded time-advance evidence is missing or unsafe.",
    {
      observed: advancements.length,
      required: accepted.thresholds.minimumBoundedAdvancements,
      unsafeRecordIds: unsafeAdvancements.map((record) => record.recordId)
    }
  ));

  const navigation = rehearsalRecords.filter((record) =>
    record.recordType === "llm_action_outcome" &&
    accepted.requiredNavigationProcedures.includes(record.payload.procedure) &&
    record.subject.campaignId === accepted.fingerprint.campaignId &&
    record.subject.countryId === accepted.fingerprint.countryId
  );
  const successfulNavigation = navigation.filter((record) =>
    record.payload.outcome === "success" &&
    verifiedFresh(record) &&
    Number.isFinite(record.payload.latencyMs) &&
    record.payload.latencyMs >= 0
  );
  const successRate = navigation.length === 0 ? 0 : successfulNavigation.length / navigation.length;
  const latencies = successfulNavigation
    .map((record) => record.payload.latencyMs)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const p95LatencyMs = percentile95(latencies);
  const successesByProcedure = new Map();
  for (const record of successfulNavigation) {
    const procedure = record.payload.procedure;
    successesByProcedure.set(procedure, (successesByProcedure.get(procedure) || 0) + 1);
  }
  const underprovenProcedures = accepted.requiredNavigationProcedures.filter((procedure) =>
    (successesByProcedure.get(procedure) || 0) < accepted.thresholds.minimumProcedureSuccesses
  );
  const navigationUnknown = navigation.filter((record) =>
    ["execution_unknown", "ambiguous"].includes(record.payload.outcome)
  ).length;
  const navigationPassed =
    navigation.length >= accepted.thresholds.minimumNavigationAttempts &&
    successRate >= accepted.thresholds.minimumNavigationSuccessRate &&
    p95LatencyMs !== null &&
    p95LatencyMs <= accepted.thresholds.maximumNavigationP95LatencyMs &&
    navigationUnknown <= accepted.thresholds.maximumUnknownOutcomes &&
    underprovenProcedures.length === 0;
  criteria.push(criterion(
    "navigation-reliability",
    navigationPassed,
    navigationPassed
      ? "Navigation volume, success rate, latency, coverage, and outcome certainty pass."
      : "Navigation evidence does not meet the stream reliability threshold.",
    {
      attempts: navigation.length,
      successes: successfulNavigation.length,
      successRate,
      p95LatencyMs,
      unknownOutcomes: navigationUnknown,
      underprovenProcedures
    }
  ));

  const hashChain = verifyLedgerHashChain(ledger);
  criteria.push(criterion(
    "ledger-integrity",
    hashChain.valid,
    hashChain.valid
      ? "The append-only ledger hash chain is valid."
      : "The ledger hash chain is missing or invalid.",
    { errors: hashChain.errors }
  ));
  const ledgerSessionErrors = ledger.filter((record) => {
    const recordedAtMs = Date.parse(record.recordedAtUtc);
    return !boundariesValid ||
      record.rehearsalId !== bundle.bundleId ||
      record.campaignId !== accepted.fingerprint.campaignId ||
      record.countryId !== accepted.fingerprint.countryId ||
      !Number.isFinite(recordedAtMs) ||
      recordedAtMs < startAtMs ||
      recordedAtMs > completedAtMs;
  }).map((record) => `${record.sequence}:${record.declarationId || "unknown"}`);
  const lifecycle = assessLedgerCompleteness(ledger);
  const proposals = rehearsalRecords.filter((record) =>
    record.recordType === "llm_action_proposed"
  );
  const terminalOutcomes = rehearsalRecords.filter((record) =>
    record.recordType === "llm_action_outcome" && typeof record.payload.outcome === "string"
  );
  const proposalsByCorrelation = new Map(
    proposals.filter((record) => record.correlationId)
      .map((record) => [record.correlationId, record])
  );
  const outcomesByCorrelation = new Map(
    terminalOutcomes.filter((record) => record.correlationId)
      .map((record) => [record.correlationId, record])
  );
  const duplicateProposalCorrelations = [...proposalsByCorrelation.keys()].filter(
    (correlationId) => proposals.filter((record) => record.correlationId === correlationId).length !== 1
  );
  const duplicateOutcomeCorrelations = [...outcomesByCorrelation.keys()].filter(
    (correlationId) =>
      terminalOutcomes.filter((record) => record.correlationId === correlationId).length !== 1
  );
  const missingActionOutcomes = [...proposalsByCorrelation.keys()]
    .filter((correlationId) => !outcomesByCorrelation.has(correlationId));
  const orphanActionOutcomes = [...outcomesByCorrelation.keys()]
    .filter((correlationId) => !proposalsByCorrelation.has(correlationId));
  const ledgerDeclarationIds = new Set(
    ledger.filter((record) => lifecycleState(record) === "declared")
      .map(ledgerDeclarationId)
  );
  const ledgerDeclarationsById = new Map(
    ledger.filter((record) => lifecycleState(record) === "declared")
      .map((record) => [ledgerDeclarationId(record), record])
  );
  const missingLedgerDeclarations = [...proposalsByCorrelation.keys()]
    .filter((correlationId) => !ledgerDeclarationIds.has(correlationId));
  const orphanLedgerDeclarations = [...ledgerDeclarationIds]
    .filter((declarationId) => !proposalsByCorrelation.has(declarationId));
  const uncorrelatedActionRecords = proposals.concat(terminalOutcomes)
    .filter((record) => !record.correlationId)
    .map((record) => record.recordId);
  const actionUnknownOutcomes = terminalOutcomes.filter((record) =>
    ["execution_unknown", "ambiguous"].includes(record.payload.outcome)
  ).length;
  const blockingActionOutcomes = terminalOutcomes.filter((record) =>
    record.payload.outcome !== "success"
  ).map((record) => record.recordId);
  const unverifiedTerminalOutcomes = terminalOutcomes.filter((record) =>
    record.provenance.verification.status !== "verified"
  ).map((record) => record.recordId);
  const invalidActionChronology = [...proposalsByCorrelation.entries()]
    .filter(([correlationId, proposal]) => {
      const outcome = outcomesByCorrelation.get(correlationId);
      return outcome && Date.parse(outcome.occurredAtUtc) < Date.parse(proposal.occurredAtUtc);
    })
    .map(([correlationId]) => correlationId);
  const semanticActionMismatches = [...proposalsByCorrelation.entries()]
    .filter(([correlationId, proposal]) => {
      const outcome = outcomesByCorrelation.get(correlationId);
      const declaration = ledgerDeclarationsById.get(correlationId);
      if (!outcome || !declaration) return false;
      const declaredActionId = declaration.actionId ||
        (declaration.action && declaration.action.id);
      return typeof proposal.payload.actionId !== "string" ||
        proposal.payload.actionId !== outcome.payload.actionId ||
        proposal.payload.actionId !== declaredActionId ||
        proposal.payload.actionFamily !== outcome.payload.actionFamily ||
        proposal.payload.actionFamily !== declaration.actionFamily ||
        (proposal.payload.procedure || null) !== (outcome.payload.procedure || null) ||
        (proposal.payload.procedure || null) !== (declaration.procedure || null) ||
        (proposal.payload.capability || null) !== (outcome.payload.capability || null) ||
        (proposal.payload.capability || null) !== (declaration.capability || null);
    })
    .map(([correlationId]) => correlationId);
  const successfulCapabilities = new Set(terminalOutcomes.filter((record) =>
    record.payload.outcome === "success" &&
    verifiedFresh(record) &&
    typeof record.payload.capability === "string" &&
    !semanticActionMismatches.includes(record.correlationId)
  ).map((record) => record.payload.capability));
  const missingGameplayCapabilities = accepted.requiredGameplayCapabilities.filter(
    (capability) => !successfulCapabilities.has(capability)
  );
  criteria.push(criterion(
    "gameplay-coverage",
    missingGameplayCapabilities.length === 0,
    missingGameplayCapabilities.length === 0
      ? "Economy, diplomacy, and recruitment rehearsal deliverables are verified."
      : `Missing gameplay deliverables: ${missingGameplayCapabilities.join(", ")}.`,
    { missingCapabilities: missingGameplayCapabilities }
  ));
  const lifecyclePassed = lifecycle.declarations > 0 &&
    lifecycle.incomplete.length === 0 &&
    lifecycle.outOfOrder.length === 0 &&
    lifecycle.duplicateStates.length === 0 &&
    lifecycle.invalidTerminals.length === 0 &&
    lifecycle.nonVerified.length === 0 &&
    lifecycle.unknownOutcomes + actionUnknownOutcomes <= accepted.thresholds.maximumUnknownOutcomes &&
    blockingActionOutcomes.length === 0 &&
    proposals.length > 0 &&
    missingActionOutcomes.length === 0 &&
    orphanActionOutcomes.length === 0 &&
    missingLedgerDeclarations.length === 0 &&
    orphanLedgerDeclarations.length === 0 &&
    uncorrelatedActionRecords.length === 0 &&
    duplicateProposalCorrelations.length === 0 &&
    duplicateOutcomeCorrelations.length === 0 &&
    proposals.length === terminalOutcomes.length &&
    proposals.length === lifecycle.declarations &&
    unverifiedTerminalOutcomes.length === 0 &&
    invalidActionChronology.length === 0 &&
    semanticActionMismatches.length === 0 &&
    ledgerSessionErrors.length === 0;
  const lifecycleEvidence = {
    ...lifecycle,
    proposals: proposals.length,
    terminalOutcomes: terminalOutcomes.length,
    missingActionOutcomes,
    orphanActionOutcomes,
    missingLedgerDeclarations,
    orphanLedgerDeclarations,
    uncorrelatedActionRecords,
    duplicateProposalCorrelations,
    duplicateOutcomeCorrelations,
    actionUnknownOutcomes,
    blockingActionOutcomes,
    unverifiedTerminalOutcomes,
    invalidActionChronology,
    semanticActionMismatches,
    ledgerSessionErrors
  };
  criteria.push(criterion(
    "action-ledger-completeness",
    lifecyclePassed,
    lifecyclePassed
      ? "Every declared action has the complete verified lifecycle."
      : "One or more action lifecycles are absent, incomplete, unverified, or ambiguous.",
    lifecycleEvidence
  ));

  const blockers = criteria.filter((item) => item.status === "fail").map((item) => item.id);
  return Object.freeze({
    schemaVersion: REPORT_SCHEMA,
    rehearsalId: bundle.bundleId,
    generatedAtUtc: new Date(reportGeneratedAtMs).toISOString(),
    artifactGeneratedAtUtc: new Date(rehearsalCompletedAtMs).toISOString(),
    rehearsalCompletedAtUtc: completedAtMs === null
      ? null
      : new Date(completedAtMs).toISOString(),
    verdict: blockers.length === 0 ? "stream_ready" : "not_stream_ready",
    fingerprint: accepted.fingerprint,
    metrics: Object.freeze({
      durationMs,
      domainCount: latestDomains.size,
      boundedAdvancements: advancements.length,
      navigationAttempts: navigation.length,
      navigationSuccessRate: successRate,
      navigationP95LatencyMs: p95LatencyMs,
      unknownOutcomes: navigationUnknown + lifecycle.unknownOutcomes + actionUnknownOutcomes,
      ledgerDeclarations: lifecycle.declarations
    }),
    criteria: Object.freeze(criteria),
    blockers: Object.freeze(blockers),
    safety: Object.freeze({
      inputSent: false,
      saveEdited: false,
      consoleInvoked: false,
      automaticRetryPerformed: false
    })
  });
}

function formatStreamReadinessMarkdown(report) {
  if (!isPlainObject(report) || report.schemaVersion !== REPORT_SCHEMA) {
    throw new TypeError("report must be a stream-readiness report");
  }
  const status = report.verdict === "stream_ready" ? "STREAM READY" : "NOT STREAM READY";
  const lines = [
    "# EU5 Stream Readiness Rehearsal",
    "",
    `**Verdict:** ${status}`,
    `**Rehearsal:** ${report.rehearsalId}`,
    `**Generated:** ${report.generatedAtUtc}`,
    `**Observed duration:** ${(report.metrics.durationMs / 60000).toFixed(1)} minutes`,
    "",
    "## Acceptance gates",
    ""
  ];
  for (const item of report.criteria) {
    lines.push(`- ${item.status === "pass" ? "PASS" : "FAIL"} — ${item.id}: ${item.summary}`);
  }
  lines.push(
    "",
    "## Stream metrics",
    "",
    `- Navigation attempts: ${report.metrics.navigationAttempts}`,
    `- Navigation success: ${(report.metrics.navigationSuccessRate * 100).toFixed(2)}%`,
    `- Navigation p95 latency: ${report.metrics.navigationP95LatencyMs === null ? "unknown" : `${report.metrics.navigationP95LatencyMs} ms`}`,
    `- Bounded time advances: ${report.metrics.boundedAdvancements}`,
    `- Verified domains: ${report.metrics.domainCount}`,
    `- Unknown outcomes: ${report.metrics.unknownOutcomes}`,
    "",
    "## Safety statement",
    "",
    "This report was produced from monitoring and ledger artifacts only. The verifier sent no input, edited no save, invoked no console, and performed no retry."
  );
  if (report.blockers.length) {
    lines.push("", "## Blocking gates", "", ...report.blockers.map((blocker) => `- ${blocker}`));
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  DEFAULT_REQUIRED_DOMAINS,
  DEFAULT_REQUIRED_HEALTH,
  DEFAULT_REQUIRED_GAMEPLAY,
  DEFAULT_REQUIRED_NAVIGATION,
  DEFAULT_THRESHOLDS,
  EXPECTATIONS_SCHEMA,
  REPORT_SCHEMA,
  REQUIRED_LEDGER_STATES,
  assessLedgerCompleteness,
  computeLedgerRecordHash,
  computeMonitoringManifestHash,
  evaluateStreamReadiness,
  formatStreamReadinessMarkdown,
  stableStringify,
  validateExpectations,
  verifyLedgerHashChain
};
