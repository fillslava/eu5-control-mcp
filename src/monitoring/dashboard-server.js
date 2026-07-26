"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { buildLiveFeed } = require("./live-feed");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;
const DASHBOARD_ROOT = path.resolve(__dirname, "..", "..", "dashboard");
const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
});
const STATIC_FILES = new Set(["index.html", "app.js", "styles.css"]);
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

function parsePort(value) {
  if (value === undefined || value === "") return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new TypeError("EU5_DASHBOARD_PORT must be an integer from 0 to 65535");
  }
  return port;
}

function sendJson(response, status, value, { head = false } = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": CONTENT_TYPES[".json"],
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(head ? undefined : body);
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (!STATIC_FILES.has(relative)) return null;
  if (
    relative.includes("\0") ||
    relative.split(/[\\/]/).some((segment) => segment === "..")
  ) {
    return null;
  }
  const target = path.resolve(DASHBOARD_ROOT, relative);
  if (target !== DASHBOARD_ROOT && !target.startsWith(`${DASHBOARD_ROOT}${path.sep}`)) {
    return null;
  }
  return target;
}

function isLoopbackHost(hostHeader) {
  return typeof hostHeader === "string" && LOOPBACK_HOST.test(hostHeader.trim());
}

function createDashboardServer({ feedBuilder = buildLiveFeed } = {}) {
  return http.createServer((request, response) => {
    if (!isLoopbackHost(request.headers.host)) {
      response.writeHead(421, {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end();
      return;
    }
    const method = request.method || "GET";
    const head = method === "HEAD";
    if (method !== "GET" && !head) {
      response.writeHead(405, {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end();
      return;
    }

    let url;
    try {
      url = new URL(request.url || "/", "http://127.0.0.1");
    } catch {
      response.writeHead(400, { "Cache-Control": "no-store" });
      response.end();
      return;
    }

    if (url.pathname === "/api/monitoring") {
      try {
        sendJson(response, 200, feedBuilder(), { head });
      } catch {
        sendJson(
          response,
          503,
          {
            schemaVersion: "eu5.monitoring-error/v1",
            status: "unavailable",
            message: "Local monitoring feed is temporarily unavailable."
          },
          { head }
        );
      }
      return;
    }

    let target;
    try {
      target = safeStaticPath(url.pathname);
    } catch {
      target = null;
    }
    if (!target) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    const extension = path.extname(target).toLowerCase();
    const body = fs.readFileSync(target);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'"
    });
    response.end(head ? undefined : body);
  });
}

async function main() {
  const host = DEFAULT_HOST;
  const port = parsePort(process.env.EU5_DASHBOARD_PORT);
  const server = createDashboardServer();
  server.listen(port, host, () => {
    const address = server.address();
    process.stdout.write(
      `EU5 monitoring dashboard: http://${host}:${address.port}/\n`
    );
  });
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write("EU5 monitoring dashboard failed to start.\n");
    process.exitCode = 1;
  });
}

module.exports = {
  DASHBOARD_ROOT,
  DEFAULT_HOST,
  DEFAULT_PORT,
  createDashboardServer,
  isLoopbackHost,
  parsePort,
  safeStaticPath
};
