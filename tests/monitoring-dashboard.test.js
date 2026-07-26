"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MONITORING_BUNDLE_SCHEMA,
  buildMonitoringModel,
  validateMonitoringBundle
} = require("../dashboard/app.js");

function record(recordType, sequence, status = "unverified") {
  return {
    recordId: `${recordType}-${sequence}`,
    recordType,
    occurredAtUtc: "2026-07-26T10:00:00.000Z",
    recordedAtUtc: "2026-07-26T10:00:01.000Z",
    sequence,
    subject: { campaignId: "local-test" },
    provenance: {
      adapter: { id: "test-adapter", version: "1" },
      verification: { status, evidence: "Local test record only." },
      freshness: "unknown"
    },
    payload: { label: "Test only" }
  };
}

function bundle(records = [record("health", 0)]) {
  return {
    schemaVersion: MONITORING_BUNDLE_SCHEMA,
    bundleId: "test-bundle",
    generatedAtUtc: "2026-07-26T10:00:02.000Z",
    sourceMode: "offline-import",
    records,
    integrity: {}
  };
}

test("monitoring bundle separates operational record types and retains warning state", () => {
  const model = buildMonitoringModel(bundle([
    record("llm_action_proposed", 0),
    record("llm_action_outcome", 1),
    record("nation_snapshot", 2, "fixture"),
    record("game_event", 3),
    record("health", 4, "verified")
  ]));
  assert.equal(model.ledger.length, 2);
  assert.equal(model.health.length, 1);
  assert.equal(model.timeline.length, 3);
  assert.equal(model.nations.length, 1);
  assert.match(model.warnings.join(" "), /not real-state evidence/i);
  assert.match(model.warnings.join(" "), /manifest SHA-256/i);
});

test("monitoring bundle rejects non-offline and malformed record provenance", () => {
  const online = bundle();
  online.sourceMode = "network";
  assert.throws(() => validateMonitoringBundle(online), /offline-import/);

  const invalid = bundle();
  invalid.records[0].provenance.verification.status = "ready";
  assert.throws(() => validateMonitoringBundle(invalid), /status is invalid/);

  const missing = bundle();
  delete missing.records[0].payload;
  assert.throws(() => validateMonitoringBundle(missing), /requires payload/);

  const unsafe = bundle();
  unsafe.records[0].payload.localPath = "C:\\Users\\example\\save.eu5";
  assert.throws(() => validateMonitoringBundle(unsafe), /must not contain local paths/);

  const secret = bundle();
  secret.records[0].payload.api_key = "not allowed";
  assert.throws(() => validateMonitoringBundle(secret), /must not contain secrets/);

  for (const key of [
    "sessionToken",
    "accessToken",
    "refreshToken",
    "apiKey",
    "authorization",
    "nested.privateKey",
    "credentials"
  ]) {
    const nestedSecret = bundle();
    const keys = key.split(".");
    let target = nestedSecret.records[0].payload;
    while (keys.length > 1) {
      target[keys.shift()] = {};
      target = target[Object.keys(target).at(-1)];
    }
    target[keys[0]] = "not allowed";
    assert.throws(
      () => validateMonitoringBundle(nestedSecret),
      /must not contain secrets/,
      `${key} must be denied`
    );
  }
});
