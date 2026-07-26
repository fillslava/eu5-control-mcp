"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const http = require("node:http");
const { createDashboardServer } = require("../src/monitoring/dashboard-server");

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

test("loopback server exposes no-store live feed and dashboard", async (t) => {
  const base = await withServer(t);
  const api = await fetch(`${base}/api/monitoring`);
  assert.equal(api.status, 200);
  assert.equal(api.headers.get("cache-control"), "no-store");
  assert.equal(api.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await api.json(), feed());

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /EU5 before \/ after/);
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
