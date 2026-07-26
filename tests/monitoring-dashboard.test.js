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
  assert.match(css, /@media \(max-width: 660px\)/);
  assert.match(css, /\.visually-hidden/);
});
