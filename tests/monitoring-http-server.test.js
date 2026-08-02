"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createDashboardServer } = require("../src/monitoring/dashboard-server");
const {
  CONTROL_LOG_SCHEMA,
  buildLiveFeed
} = require("../src/monitoring/live-feed");

function feed() {
  return {
    schemaVersion: "eu5.monitoring-feed/v1",
    feedId: "test-feed",
    generatedAtUtc: "2026-07-26T10:00:00.000Z",
    sourceMode: "local-live",
    records: [],
    integrity: {}
  };
}

async function withServer(t) {
  const server = createDashboardServer({ feedBuilder: feed });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function withFeedBuilderServer(t, feedBuilder) {
  const server = createDashboardServer({ feedBuilder });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test("loopback server exposes no-store live feed and dashboard", async (t) => {
  const base = await withServer(t);
  const api = await fetch(`${base}/api/monitoring`);
  assert.equal(api.status, 200);
  assert.equal(api.headers.get("cache-control"), "no-store");
  assert.equal(api.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await api.json(), feed());

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /EU5 Command Monitor/);
});

test("loopback server rejects mutation and traversal", async (t) => {
  const base = await withServer(t);
  const post = await fetch(`${base}/api/monitoring`, { method: "POST" });
  assert.equal(post.status, 405);
  const traversal = await fetch(`${base}/%2e%2e/package.json`);
  assert.equal(traversal.status, 404);
  const sessionBundle = await fetch(`${base}/current-session.monitoring-bundle.json`);
  assert.equal(sessionBundle.status, 404);
  const arbitraryDashboardFile = await fetch(`${base}/README.md`);
  assert.equal(arbitraryDashboardFile.status, 404);
});

test("loopback server rejects a non-loopback Host header", async (t) => {
  const base = await withServer(t);
  const target = new URL(base);
  const status = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: "/api/monitoring",
      headers: { Host: "attacker.example" }
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(status, 421);
});

test("monitoring endpoint stays available for real v0.5.0 partial headers and facts", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-http-v040-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logPath = path.join(root, "debug.log");
  const header = {
    schemaVersion: CONTROL_LOG_SCHEMA,
    recordType: "economy_snapshot",
    procedure: "emit_economy_snapshot",
    section: "economy",
    modVersion: "0.5.0",
    status: "acknowledged",
    completeness: "partial",
    observationJoinRequired: true
  };
  const availableFact = {
    schemaVersion: CONTROL_LOG_SCHEMA,
    recordType: "telemetry_fact",
    procedure: "emit_economy_snapshot",
    section: "economy",
    field: "monthlyBalanceClass",
    value: "non_negative",
    availability: "available",
    modVersion: "0.5.0",
    status: "observed"
  };
  const unavailableFact = {
    schemaVersion: CONTROL_LOG_SCHEMA,
    recordType: "telemetry_fact",
    procedure: "emit_economy_snapshot",
    section: "economy",
    field: "monthlyBalance",
    value: null,
    unit: "gold_per_month",
    availability: "unavailable",
    reason: "no_json_safe_scalar_serializer",
    modVersion: "0.5.0",
    status: "observed"
  };
  const observedAt = new Date("2026-07-26T17:00:16.000Z");
  const wrap = (record, line) =>
    `[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:${line}: EU5_CONTROL ${JSON.stringify(record)}`;
  fs.writeFileSync(logPath, [
    wrap(header, 300),
    wrap(availableFact, 301),
    wrap(unavailableFact, 302)
  ].join("\n"));
  fs.utimesSync(logPath, observedAt, observedAt);
  const now = () => observedAt.getTime();
  const base = await withFeedBuilderServer(t, () => buildLiveFeed({
    logPath,
    now,
    ledgerReader: () => [],
    saveDirectory: "Z:\\missing\\saves"
  }));
  const response = await fetch(`${base}/api/monitoring`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.currentObservations.status, "partial");
  assert.equal(
    body.currentObservations.domains.economy.fields.monthlyBalanceClass.value,
    "non_negative"
  );
  assert.equal(
    body.currentObservations.domains.economy.fields.monthlyBalance.value,
    null
  );
  assert.equal(
    body.currentObservations.domains.economy.fields.monthlyBalance.availability,
    "unavailable"
  );
  const bridgeHealth = body.records.find((record) =>
    record.recordType === "health" &&
    record.payload.component === "structured-debug-log"
  );
  assert.equal(bridgeHealth.payload.status, "partial-observation-only");
  assert.equal(bridgeHealth.payload.freshPartialTelemetryRecordCount, 3);
  assert.doesNotMatch(JSON.stringify(body), /undefined|debug\.log|eu5-http-v040/i);
});
