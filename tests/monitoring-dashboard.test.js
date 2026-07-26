"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildLiveFeed } = require("../src/monitoring/live-feed");
const {
  MONITORING_BUNDLE_SCHEMA,
  LIVE_FEED_SCHEMA,
  buildHumanMonitoringView,
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

function liveFeed(records, currentState, currentObservations = {
  status: "unavailable",
  country: null,
  gameDate: null,
  domains: {}
}) {
  return {
    schemaVersion: LIVE_FEED_SCHEMA,
    feedId: "local-feed",
    generatedAtUtc: "2026-07-26T10:00:02.000Z",
    sourceMode: "local-live",
    records,
    ...(currentState === undefined ? {} : { currentState }),
    currentObservations,
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

test("monitoring bundle rejects duplicate record ids and non-unique or unordered sequences", () => {
  const duplicateId = bundle([
    record("health", 0),
    { ...record("game_event", 1), recordId: "health-0" }
  ]);
  assert.throws(
    () => validateMonitoringBundle(duplicateId),
    /recordId must be globally unique/
  );

  const duplicateSequence = bundle([
    record("health", 0),
    record("game_event", 0)
  ]);
  assert.throws(
    () => validateMonitoringBundle(duplicateSequence),
    /sequence must be globally unique/
  );

  const unorderedSequence = bundle([
    record("health", 2),
    record("game_event", 1)
  ]);
  assert.throws(
    () => validateMonitoringBundle(unorderedSequence),
    /sequence must be strictly increasing/
  );

  const orderedWithGaps = bundle([
    record("health", 2),
    record("game_event", 10)
  ]);
  assert.equal(validateMonitoringBundle(orderedWithGaps), orderedWithGaps);
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

test("dashboard accepts the exact buildLiveFeed top-level contract", () => {
  const generated = buildLiveFeed({
    now: () => Date.parse("2026-07-26T10:00:02.000Z"),
    logPath: path.join(os.tmpdir(), "definitely-missing-eu5-debug.log"),
    saveDirectory: path.join(os.tmpdir(), "definitely-missing-eu5-saves"),
    ledgerReader: () => []
  });
  const model = buildLiveMonitoringModel(generated);
  assert.deepEqual(model.currentState, generated.currentState);
  assert.deepEqual(model.currentObservations, generated.currentObservations);
  assert.equal(model.isLive, true);
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

test("human view never promotes unverified nation values into campaign statistics", () => {
  const nation = record("nation_snapshot", 0, "unverified");
  nation.provenance.freshness = "fresh";
  nation.subject = { campaignId: "holland-test", countryId: "HOL" };
  nation.payload = {
    state: {
      country: { name: "Holland" },
      gameDate: "1337-04-14",
      paused: true,
      economy: { treasury: 120, monthlyBalance: 4.5 }
    }
  };
  const view = buildHumanMonitoringView(buildMonitoringModel(bundle([nation])));
  assert.equal(view.country, "Country unknown");
  assert.equal(view.gameDate, "Date unknown");
  assert.equal(view.nationVerification, "unknown");
  assert.ok(view.metrics.every((metric) => metric.status === "unknown"));
  assert.match(view.alerts[0].message, /no coherent, fresh, verified nation state/i);
});

test("human view renders Holland, date, and treasury only from corroborated verified currentState", () => {
  const current = record("nation_snapshot", 1, "verified");
  current.provenance.freshness = "fresh";
  current.provenance.adapter = { id: "eu5-control-bridge", version: "1" };
  current.provenance.verification.evidence =
    "Typed telemetry matched externally authenticated campaign, capture-session and reviewed-manifest evidence.";
  current.subject = {
    campaignId: "holland-test",
    countryId: "country-42",
    countryTag: "HOL",
    countryName: "Holland"
  };
  current.payload = {
    domain: "economy",
    gameDate: "1337-05-01",
    capturedAtUtc: "2026-07-26T10:00:00.000Z",
    paused: true,
    metrics: {
      treasury: { value: 108, unit: "ducats" },
      monthlyBalance: { value: 2, unit: "ducats_per_month" }
    }
  };
  const proposal = record("llm_action_proposed", 2);
  proposal.payload = {
    actionId: "open_markets",
    risk: "read-only",
    expectedVisibleResult: "Markets panel opens"
  };
  const health = record("health", 3, "verified");
  health.provenance.freshness = "fresh";
  health.provenance.adapter = { id: "eu5-local-monitoring-server", version: "1" };
  health.provenance.verification.evidence =
    "Local adapter status generated by the loopback-only monitoring server.";
  health.payload = {
    component: "structured-debug-log",
    status: "available",
    recognizedRecordCount: 3
  };

  const currentState = {
    status: "partial",
    campaignId: "holland-test",
    country: { id: "country-42", tag: "HOL", name: "Holland" },
    gameDate: "1337-05-01",
    paused: true,
    updatedAtUtc: "2026-07-26T10:00:00.000Z",
    domains: {
      economy: {
        recordId: current.recordId,
        capturedAtUtc: current.payload.capturedAtUtc,
        gameDate: current.payload.gameDate,
        paused: true,
        metrics: current.payload.metrics
      }
    },
    warnings: ["Missing markets telemetry."]
  };
  const view = buildHumanMonitoringView(buildLiveMonitoringModel(
    liveFeed([current, proposal, health], currentState)
  ));
  assert.equal(view.country, "Holland (HOL)");
  assert.equal(view.gameDate, "1337-05-01");
  assert.equal(view.pause, "Paused");
  assert.equal(view.nationVerification, "verified");
  assert.equal(view.metrics.find((metric) => metric.id === "treasury").value, "108");
  assert.equal(view.metrics.find((metric) => metric.id === "treasury").unit, "ducats");
  assert.equal(view.metrics.find((metric) => metric.id === "income").status, "unknown");
  assert.equal(view.timeline[0].title, "LLM proposed: open_markets");
  assert.deepEqual(view.health[0], {
    component: "structured-debug-log",
    status: "available",
    count: 3,
    verified: true
  });
});

test("human view rejects an unverified record even when currentState claims Holland treasury", () => {
  const claimed = record("nation_snapshot", 1, "unverified");
  claimed.provenance.freshness = "fresh";
  claimed.subject = {
    campaignId: "holland-test",
    countryTag: "HOL",
    countryName: "Holland"
  };
  claimed.payload = {
    domain: "economy",
    metrics: { treasury: { value: 999, unit: "ducats" } }
  };
  const claimedState = {
    status: "partial",
    campaignId: "holland-test",
    country: { tag: "HOL", name: "Holland" },
    gameDate: "1337-05-01",
    paused: true,
    updatedAtUtc: "2026-07-26T10:00:00.000Z",
    domains: {
      economy: {
        recordId: claimed.recordId,
        metrics: claimed.payload.metrics
      }
    },
    warnings: []
  };
  const view = buildHumanMonitoringView(
    buildLiveMonitoringModel(liveFeed([claimed], claimedState))
  );
  assert.equal(view.country, "Country unknown");
  assert.equal(view.metrics.find((metric) => metric.id === "treasury").status, "unknown");
});

test("human view rejects currentState header facts that do not match its verified domain record", () => {
  const source = record("nation_snapshot", 1, "verified");
  source.provenance.freshness = "fresh";
  source.subject = {
    campaignId: "holland-test",
    countryTag: "HOL",
    countryName: "Holland"
  };
  source.payload = {
    domain: "economy",
    gameDate: "1337-05-01",
    paused: true,
    metrics: { treasury: { value: 108, unit: "ducats" } }
  };
  const forgedHeader = {
    status: "partial",
    campaignId: "holland-test",
    country: { tag: "HOL", name: "Holland" },
    gameDate: "1337-06-01",
    paused: true,
    updatedAtUtc: "2026-07-26T10:00:00.000Z",
    domains: {
      economy: {
        recordId: source.recordId,
        gameDate: source.payload.gameDate,
        paused: true,
        metrics: source.payload.metrics
      }
    },
    warnings: []
  };
  const view = buildHumanMonitoringView(
    buildLiveMonitoringModel(liveFeed([source], forgedHeader))
  );
  assert.equal(view.country, "Country unknown");
  assert.equal(view.gameDate, "Date unknown");
});

test("partial observations remain visibly unverified and never populate statistic cards", () => {
  const observations = {
    status: "partial",
    country: null,
    gameDate: null,
    domains: {
      economy: {
        captureGroupId: "economy-1",
        updatedAtUtc: "2026-07-26T10:00:00.000Z",
        fields: {
          treasuryClass: { value: "non_negative", availability: "available" },
          treasury: {
            value: null,
            availability: "unavailable",
            unit: "gold",
            reason: "no_json_safe_scalar_serializer"
          }
        }
      }
    }
  };
  const view = buildHumanMonitoringView(
    buildLiveMonitoringModel(liveFeed([], {
      status: "unavailable",
      country: null,
      gameDate: null,
      paused: null,
      updatedAtUtc: null,
      domains: {},
      warnings: []
    }, observations))
  );
  assert.equal(view.observations.length, 2);
  assert.equal(view.observations[0].value, "non_negative");
  assert.equal(view.metrics.find((metric) => metric.id === "treasury").status, "unknown");
});

test("stream summary exposes objectives, latency, unknown outcomes, bridge health and checkpoint metadata", () => {
  const proposal = record("llm_action_proposed", 1);
  proposal.correlationId = "action-open-economy";
  proposal.recordedAtUtc = "2026-07-26T10:00:01.000Z";
  proposal.payload = {
    actionId: "open_economy",
    risk: "read-only",
    expectedVisibleResult: "Economy panel opens"
  };
  const verified = record("llm_action_outcome", 2);
  verified.correlationId = proposal.correlationId;
  verified.recordedAtUtc = "2026-07-26T10:00:06.000Z";
  verified.payload = { lifecycleState: "verified", verified: true };
  const unknownProposal = record("llm_action_proposed", 3);
  unknownProposal.correlationId = "action-build-market";
  unknownProposal.recordedAtUtc = "2026-07-26T10:00:07.000Z";
  unknownProposal.payload = {
    actionId: "build_market",
    risk: "state-changing",
    expectedVisibleResult: "Market construction appears"
  };
  const unknown = record("llm_action_outcome", 4);
  unknown.correlationId = unknownProposal.correlationId;
  unknown.recordedAtUtc = "2026-07-26T10:00:10.000Z";
  unknown.payload = {
    lifecycleState: "execution_unknown",
    actualVisibleResult: "Post-state was inconclusive"
  };
  const active = record("llm_action_proposed", 5);
  active.correlationId = "action-focus-capital";
  active.recordedAtUtc = "2026-07-26T10:00:11.000Z";
  active.payload = {
    actionId: "focus_capital",
    risk: "read-only",
    expectedVisibleResult: "Capital is centered"
  };
  const bridge = record("health", 6, "verified");
  bridge.provenance.freshness = "fresh";
  bridge.provenance.adapter = { id: "eu5-local-monitoring-server", version: "1" };
  bridge.provenance.verification.evidence =
    "Local adapter status generated by the loopback-only monitoring server.";
  bridge.payload = {
    component: "structured-debug-log",
    status: "available",
    recognizedRecordCount: 8
  };
  const checkpoint = record("game_event", 7, "verified");
  checkpoint.provenance.freshness = "fresh";
  checkpoint.provenance.adapter = { id: "eu5-checkpoint-metadata", version: "1" };
  checkpoint.provenance.verification.evidence =
    "Metadata-only observation of the newest save checkpoint.";
  checkpoint.occurredAtUtc = "2026-07-26T10:00:12.000Z";
  checkpoint.payload = {
    event: "latest-save-observed",
    saveFile: "autosave.eu5",
    saveCount: 13,
    lastWriteTimeUtc: "2026-07-26T10:00:12.000Z"
  };

  const view = buildHumanMonitoringView(buildMonitoringModel(bundle([
    proposal,
    verified,
    unknownProposal,
    unknown,
    active,
    bridge,
    checkpoint
  ])));
  assert.equal(view.objective.current, "focus_capital");
  assert.equal(view.objective.lastAction, "focus_capital");
  assert.equal(
    view.objective.lastOutcome,
    "EXECUTION UNKNOWN (unverified) — Post-state was inconclusive"
  );
  assert.equal(view.operations.actionLatency, "3.0 s");
  assert.equal(view.operations.navigationLatency, "5.0 s");
  assert.equal(view.operations.unknownOutcomes, 1);
  assert.equal(view.operations.bridgeHealth, "available · 8 record(s)");
  assert.deepEqual(view.checkpoint, {
    name: "autosave.eu5",
    detail: "13 save(s) · fresh · 2026-07-26T10:00:12.000Z",
    freshness: "fresh"
  });
  assert.equal(view.speed, "Speed unknown");
});

test("stream summary never presents unverified, failed, or unknown outcomes as successful", () => {
  const proposal = record("llm_action_proposed", 1);
  proposal.correlationId = "action-unsafe-label";
  proposal.payload = {
    actionId: "economy_decision",
    expectedVisibleResult: "Economy changes"
  };
  const claimedSuccess = record("llm_action_outcome", 2);
  claimedSuccess.correlationId = proposal.correlationId;
  claimedSuccess.payload = {
    lifecycleState: "verified",
    outcome: "success",
    actualVisibleResult: "Claimed result"
  };
  let view = buildHumanMonitoringView(
    buildMonitoringModel(bundle([proposal, claimedSuccess]))
  );
  assert.equal(
    view.objective.lastOutcome,
    "UNVERIFIED OUTCOME — claimed success — Claimed result"
  );
  assert.doesNotMatch(view.objective.lastOutcome, /^SUCCESS/);

  const failed = record("llm_action_outcome", 3);
  failed.correlationId = proposal.correlationId;
  failed.payload = {
    lifecycleState: "failed",
    outcome: "failed",
    actualVisibleResult: "Expected state did not appear"
  };
  view = buildHumanMonitoringView(
    buildMonitoringModel(bundle([proposal, failed]))
  );
  assert.equal(
    view.objective.lastOutcome,
    "FAILED (unverified) — Expected state did not appear"
  );

  const unknown = record("llm_action_outcome", 4);
  unknown.correlationId = proposal.correlationId;
  unknown.payload = {
    lifecycleState: "execution_unknown",
    outcome: "execution_unknown"
  };
  view = buildHumanMonitoringView(
    buildMonitoringModel(bundle([proposal, unknown]))
  );
  assert.equal(
    view.objective.lastOutcome,
    "EXECUTION UNKNOWN (unverified)"
  );

  const contradictory = record("llm_action_outcome", 5, "verified");
  contradictory.correlationId = proposal.correlationId;
  contradictory.payload = {
    lifecycleState: "failed",
    outcome: "success",
    actualVisibleResult: "Contradictory terminal claim"
  };
  view = buildHumanMonitoringView(
    buildMonitoringModel(bundle([proposal, contradictory]))
  );
  assert.equal(
    view.objective.lastOutcome,
    "FAILED (unverified) — Contradictory terminal claim"
  );
  assert.doesNotMatch(view.objective.lastOutcome, /^SUCCESS/);

  const forged = record("llm_action_outcome", 6, "verified");
  forged.correlationId = proposal.correlationId;
  forged.provenance.adapter = { id: "forged-import", version: "1" };
  forged.provenance.verification.evidence = "self-asserted";
  forged.payload = {
    lifecycleState: "verified",
    outcome: "success",
    actualVisibleResult: "Forged result"
  };
  view = buildHumanMonitoringView(
    buildMonitoringModel(bundle([proposal, forged]))
  );
  assert.equal(
    view.objective.lastOutcome,
    "UNVERIFIED OUTCOME — claimed success — Forged result"
  );
  assert.doesNotMatch(view.objective.lastOutcome, /^SUCCESS/);

  const trusted = record("llm_action_outcome", 7, "verified");
  trusted.correlationId = proposal.correlationId;
  trusted.provenance.adapter = { id: "eu5-control-ledger", version: "1" };
  trusted.provenance.verification.evidence =
    "Independent signed verification recorded in append-only control ledger.";
  trusted.payload = {
    lifecycleState: "verified",
    outcome: "success",
    actualVisibleResult: "Verified result"
  };
  view = buildHumanMonitoringView(
    buildMonitoringModel(bundle([proposal, trusted]))
  );
  assert.equal(
    view.objective.lastOutcome,
    "UNVERIFIED OUTCOME — claimed success — Verified result"
  );
  assert.doesNotMatch(view.objective.lastOutcome, /^SUCCESS/);

  view = buildHumanMonitoringView(
    buildLiveMonitoringModel(liveFeed([proposal, trusted]))
  );
  assert.equal(
    view.objective.lastOutcome,
    "SUCCESS (verified) — Verified result"
  );
});

test("stream summary keeps an older unresolved objective and classifies find actions as navigation", () => {
  const unresolved = record("llm_action_proposed", 1);
  unresolved.correlationId = "action-inspect-market";
  unresolved.recordedAtUtc = "2026-07-26T10:00:01.000Z";
  unresolved.payload = {
    actionId: "inspect_market",
    risk: "read-only",
    expectedVisibleResult: "Market facts are reviewed"
  };
  const find = record("llm_action_proposed", 2);
  find.correlationId = "action-find-province";
  find.recordedAtUtc = "2026-07-26T10:00:03.000Z";
  find.payload = {
    actionId: "eu5.find_province",
    risk: "read-only",
    expectedVisibleResult: "Province search is visible"
  };
  const verified = record("llm_action_outcome", 3);
  verified.correlationId = find.correlationId;
  verified.recordedAtUtc = "2026-07-26T10:00:05.000Z";
  verified.payload = { lifecycleState: "verified", verified: true };

  const view = buildHumanMonitoringView(buildMonitoringModel(bundle([
    unresolved,
    find,
    verified
  ])));
  assert.equal(view.objective.current, "inspect_market");
  assert.equal(view.objective.lastAction, "eu5.find_province");
  assert.equal(view.operations.actionLatency, "2.0 s");
  assert.equal(view.operations.navigationLatency, "2.0 s");
});

test("verified domain collections become bounded summaries only with trusted telemetry evidence", () => {
  const trustedEvidence =
    "Typed telemetry matched externally authenticated campaign, capture-session and reviewed-manifest evidence.";
  const makeDomain = (domain, sequence, extra) => {
    const source = record("nation_snapshot", sequence, "verified");
    source.provenance = {
      adapter: { id: "eu5-control-bridge", version: "1" },
      verification: { status: "verified", evidence: trustedEvidence },
      freshness: "fresh"
    };
    source.subject = {
      campaignId: "holland-test",
      countryTag: "HOL",
      countryName: "Holland"
    };
    source.payload = {
      domain,
      gameDate: "1337-05-01",
      capturedAtUtc: `2026-07-26T10:00:0${sequence}.000Z`,
      paused: true,
      metrics: {},
      ...extra
    };
    return source;
  };
  const markets = makeDomain("markets", 1, {
    goods: [
      { id: "grain", name: "Grain", balance: { value: -2, unit: "units_per_month" } },
      { id: "wood", name: "Wood", balance: { value: 3, unit: "units_per_month" } }
    ]
  });
  const diplomacy = makeDomain("diplomacy", 2, {
    relations: [
      { country: { tag: "FRA", name: "France" }, atWar: false },
      { country: { tag: "ENG", name: "England" }, atWar: true }
    ]
  });
  const military = makeDomain("military", 3, {
    armies: [{ id: "army-1", name: "Army of Holland" }]
  });
  const domains = Object.fromEntries([markets, diplomacy, military].map((source) => [
    source.payload.domain,
    {
      recordId: source.recordId,
      capturedAtUtc: source.payload.capturedAtUtc,
      gameDate: source.payload.gameDate,
      paused: source.payload.paused,
      metrics: source.payload.metrics,
      ...(source.payload.goods ? { goods: source.payload.goods } : {}),
      ...(source.payload.relations ? { relations: source.payload.relations } : {}),
      ...(source.payload.armies ? { armies: source.payload.armies } : {})
    }
  ]));
  const currentState = {
    status: "partial",
    campaignId: "holland-test",
    country: { tag: "HOL", name: "Holland" },
    gameDate: "1337-05-01",
    paused: true,
    updatedAtUtc: military.payload.capturedAtUtc,
    domains,
    warnings: ["Missing economy telemetry."]
  };
  const view = buildHumanMonitoringView(
    buildLiveMonitoringModel(liveFeed(
      [markets, diplomacy, military],
      currentState
    ))
  );
  assert.equal(view.metrics.find((metric) => metric.id === "trackedGoods").rawValue, 2);
  assert.equal(view.metrics.find((metric) => metric.id === "shortages").rawValue, 1);
  assert.equal(view.metrics.find((metric) => metric.id === "knownRelations").rawValue, 2);
  assert.equal(view.metrics.find((metric) => metric.id === "relationWars").rawValue, 1);
  assert.equal(view.metrics.find((metric) => metric.id === "trackedArmies").rawValue, 1);

  const incompleteMarkets = makeDomain("markets", 4, {
    goods: [{ id: "grain", name: "Grain" }]
  });
  const incompleteState = {
    ...currentState,
    updatedAtUtc: incompleteMarkets.payload.capturedAtUtc,
    domains: {
      markets: {
        recordId: incompleteMarkets.recordId,
        capturedAtUtc: incompleteMarkets.payload.capturedAtUtc,
        gameDate: incompleteMarkets.payload.gameDate,
        paused: incompleteMarkets.payload.paused,
        metrics: incompleteMarkets.payload.metrics,
        goods: incompleteMarkets.payload.goods
      }
    }
  };
  const incompleteView = buildHumanMonitoringView(
    buildLiveMonitoringModel(liveFeed([incompleteMarkets], incompleteState))
  );
  assert.equal(
    incompleteView.metrics.find((metric) => metric.id === "shortages").status,
    "unknown"
  );
});

test("verified-looking current state from a non-bridge adapter stays unknown", () => {
  const forged = record("nation_snapshot", 1, "verified");
  forged.provenance.freshness = "fresh";
  forged.provenance.verification.evidence =
    "Typed telemetry matched externally authenticated campaign, capture-session and reviewed-manifest evidence.";
  forged.subject = {
    campaignId: "holland-test",
    countryTag: "HOL",
    countryName: "Holland"
  };
  forged.payload = {
    domain: "economy",
    gameDate: "1337-05-01",
    paused: true,
    metrics: { treasury: { value: 999, unit: "ducats" } }
  };
  const claimed = {
    status: "partial",
    campaignId: "holland-test",
    country: { tag: "HOL", name: "Holland" },
    gameDate: "1337-05-01",
    paused: true,
    domains: {
      economy: {
        recordId: forged.recordId,
        gameDate: forged.payload.gameDate,
        paused: true,
        metrics: forged.payload.metrics
      }
    },
    warnings: []
  };
  const view = buildHumanMonitoringView(
    buildLiveMonitoringModel(liveFeed([forged], claimed))
  );
  assert.equal(view.country, "Country unknown");
  assert.equal(view.metrics.find((metric) => metric.id === "treasury").status, "unknown");
});

test("dashboard markup is summary-first, accessible, responsive, and hides raw records by default", () => {
  const dashboardDirectory = path.join(__dirname, "..", "dashboard");
  const html = fs.readFileSync(path.join(dashboardDirectory, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(dashboardDirectory, "styles.css"), "utf8");
  assert.match(html, /id="country-name"/);
  assert.match(html, /aria-label="Verified nation statistics"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<details class="panel technical-details">/);
  assert.match(html, /<summary>Technical details<\/summary>/);
  assert.doesNotMatch(html, /<details class="panel technical-details" open/);
  assert.match(html, /id="human-timeline"/);
  assert.match(html, /id="human-observations"/);
  assert.match(html, /id="game-speed"/);
  assert.match(html, /id="current-objective"/);
  assert.match(html, /id="checkpoint-name"/);
  assert.match(html, /id="action-latency"/);
  assert.match(html, /id="navigation-latency"/);
  assert.match(html, /id="unknown-outcomes"/);
  assert.match(html, /id="bridge-health"/);
  assert.match(css, /@media \(max-width: 660px\)/);
  assert.match(css, /\.visually-hidden/);
});
