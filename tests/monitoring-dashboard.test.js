"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MONITORING_BUNDLE_SCHEMA,
  LIVE_FEED_SCHEMA,
  buildMonitoringModel,
  buildLiveMonitoringModel,
  createLivePoller,
  validateLiveMonitoringFeed,
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

  const spacedSecret = bundle();
  spacedSecret.records[0].payload["api key"] = "not allowed";
  assert.throws(() => validateMonitoringBundle(spacedSecret), /must not contain secrets/);

  const embeddedPath = bundle();
  embeddedPath.records[0].payload.note = "captured at C:\\private\\save.eu5";
  assert.throws(() => validateMonitoringBundle(embeddedPath), /must not contain local paths/);

  const embeddedCredential = bundle();
  embeddedCredential.records[0].payload.note =
    "Authorization: Bearer local-secret-value";
  assert.throws(
    () => validateMonitoringBundle(embeddedCredential),
    /credential-like text/
  );

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

test("live feed has a distinct local-live contract and preserves offline isolation", () => {
  const live = {
    schemaVersion: LIVE_FEED_SCHEMA,
    feedId: "local-feed",
    generatedAtUtc: "2026-07-26T10:00:02.000Z",
    sourceMode: "local-live",
    records: [record("health", 0, "verified")],
    integrity: {}
  };
  assert.equal(buildLiveMonitoringModel(live).isLive, true);
  assert.throws(() => validateMonitoringBundle(live), /schemaVersion/);
  assert.throws(
    () => validateLiveMonitoringFeed(bundle()),
    /unsupported top-level field|schemaVersion/
  );
});

test("live poller retains last good data when a later refresh fails", async () => {
  const timers = [];
  const updates = [];
  const statuses = [];
  let calls = 0;
  const live = {
    schemaVersion: LIVE_FEED_SCHEMA,
    feedId: "local-feed",
    generatedAtUtc: "2026-07-26T10:00:02.000Z",
    sourceMode: "local-live",
    records: [record("health", 0, "verified")],
    integrity: {}
  };
  const poller = createLivePoller({
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) return { ok: true, json: async () => live };
      throw new Error("temporary disconnect");
    },
    onUpdate: (model) => updates.push(model),
    onStatus: (status) => statuses.push(status),
    setTimeoutFn: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeoutFn: () => {},
    intervalMs: 1
  });
  poller.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.length, 1);
  assert.equal(statuses.at(-1).connected, true);
  const scheduledPoll = timers.at(-1);
  scheduledPoll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.length, 1);
  assert.equal(statuses.at(-1).connected, false);
  poller.stop();
});

test("stopped live poll cannot publish an in-flight response", async () => {
  let resolveFetch;
  const updates = [];
  const statuses = [];
  const responsePromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const poller = createLivePoller({
    fetchFn: () => responsePromise,
    onUpdate: (model) => updates.push(model),
    onStatus: (status) => statuses.push(status),
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {}
  });
  poller.start();
  poller.stop();
  resolveFetch({
    ok: true,
    json: async () => ({
      schemaVersion: LIVE_FEED_SCHEMA,
      feedId: "late-feed",
      generatedAtUtc: "2026-07-26T10:00:02.000Z",
      sourceMode: "local-live",
      records: [record("health", 0, "verified")],
      integrity: {}
    })
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.length, 0);
  assert.equal(statuses.length, 0);
});

test("stop then start launches a current-generation poll while the old request is pending", async () => {
  let resolveFirst;
  let calls = 0;
  const updates = [];
  const first = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const live = {
    schemaVersion: LIVE_FEED_SCHEMA,
    feedId: "current-feed",
    generatedAtUtc: "2026-07-26T10:00:02.000Z",
    sourceMode: "local-live",
    records: [record("health", 0, "verified")],
    integrity: {}
  };
  const poller = createLivePoller({
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) return first;
      return { ok: true, json: async () => live };
    },
    onUpdate: (model) => updates.push(model.bundle.feedId),
    intervalMs: 60_000,
    requestTimeoutMs: 60_000
  });
  poller.start();
  poller.stop();
  poller.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.deepEqual(updates, ["current-feed"]);

  resolveFirst({
    ok: true,
    json: async () => ({ ...live, feedId: "stale-feed" })
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, ["current-feed"]);
  poller.stop();
});
