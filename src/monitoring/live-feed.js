"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { latestSaveCheckpoint } = require("../read/latest-save");
const { ControlLedger } = require("../control/control-ledger");

const LIVE_FEED_SCHEMA = "eu5.monitoring-feed/v1";
const CONTROL_LOG_SCHEMA = "eu5.control-log/v1";
const CONTROL_MARKER = "EU5_CONTROL ";
const MAX_LOG_TAIL_BYTES = 1024 * 1024;
const MAX_LOG_RECORD_BYTES = 16 * 1024;
const MAX_RECORDS = 2000;
const LOG_FRESH_MS = 2 * 60 * 1000;
const CHECKPOINT_FRESH_MS = 10 * 60 * 1000;
const CONTROL_RECORD_TYPES = new Set([
  "bridge_health",
  "player_scope",
  "state_snapshot"
]);
const PROCEDURES = Object.freeze({
  bridge_health: "emit_ping",
  player_scope: "emit_player_scope",
  state_snapshot: "emit_state_snapshot"
});
const SAFE_TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "recordType",
  "procedure",
  "modVersion",
  "eventId",
  "occurredAtUtc",
  "captureSessionId",
  "campaignId",
  "status",
  "observationJoinRequired",
  "payload"
]);
const CANONICAL_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FORBIDDEN_KEY =
  /token|secret|password|cookie|authorization|apikey|credential|privatekey|bearer/i;
const LOCAL_PATH = /(?:[a-z]:[\\/]|\\\\|file:)/i;
const CREDENTIAL_VALUE =
  /\b(?:authorization\s*:\s*(?:bearer|basic)\s+\S+|bearer\s+[a-z0-9._~+/=-]{8,}|(?:api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|password|secret)\s*[:=]\s*\S+)/i;

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalTimestamp(value) {
  return (
    typeof value === "string" &&
    CANONICAL_UTC.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateSafeTree(value, pathLabel = "record", depth = 0) {
  if (depth > 12) throw new Error(`${pathLabel} is too deeply nested`);
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string") {
      if (value.length > 4096) throw new Error(`${pathLabel} string is too long`);
      if (LOCAL_PATH.test(value)) throw new Error(`${pathLabel} contains a local path`);
      if (CREDENTIAL_VALUE.test(value)) {
        throw new Error(`${pathLabel} contains credential-like text`);
      }
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${pathLabel} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 250) throw new Error(`${pathLabel} array is too long`);
    value.forEach((item, index) =>
      validateSafeTree(item, `${pathLabel}[${index}]`, depth + 1)
    );
    return;
  }
  if (!isPlainObject(value)) throw new Error(`${pathLabel} is not safe JSON`);
  const entries = Object.entries(value);
  if (entries.length > 250) throw new Error(`${pathLabel} has too many fields`);
  for (const [key, item] of entries) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "");
    if (!key || FORBIDDEN_KEY.test(normalizedKey)) {
      throw new Error(`${pathLabel}.${key || "<empty>"} is not allowed`);
    }
    validateSafeTree(item, `${pathLabel}.${key}`, depth + 1);
  }
}

function sanitizeFreeText(value) {
  if (typeof value !== "string") return null;
  const bounded = value.slice(0, 1024);
  if (LOCAL_PATH.test(bounded) || CREDENTIAL_VALUE.test(bounded)) {
    return "[redacted unsafe text]";
  }
  return bounded;
}

function assertShortString(value, label, { optional = false } = {}) {
  if (optional && typeof value === "undefined") return;
  if (typeof value !== "string" || value.trim() === "" || value.length > 256) {
    throw new Error(`${label} must be a short non-empty string`);
  }
}

function parseEu5ControlLine(line) {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  const wrapped =
    /^\[[^\]\r\n]+\]\[jomini_effect_impl\.cpp:[1-9]\d*\]: common\/scripted_guis\/eu5_control_debug\.txt:[1-9]\d*: EU5_CONTROL (\{[^\r\n]*\})$/.exec(
      trimmed
    );
  let jsonText = wrapped ? wrapped[1] : null;
  if (jsonText === null || jsonText.includes(CONTROL_MARKER)) return null;
  jsonText = jsonText.trim();
  if (
    !jsonText.startsWith("{") ||
    !jsonText.endsWith("}") ||
    Buffer.byteLength(jsonText, "utf8") > MAX_LOG_RECORD_BYTES
  ) {
    return null;
  }

  let record;
  try {
    record = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!isPlainObject(record)) return null;
  for (const key of Object.keys(record)) {
    if (!SAFE_TOP_LEVEL_KEYS.has(key)) return null;
  }
  if (
    record.schemaVersion !== CONTROL_LOG_SCHEMA ||
    !CONTROL_RECORD_TYPES.has(record.recordType)
  ) {
    return null;
  }
  try {
    assertShortString(record.modVersion, "modVersion");
    assertShortString(record.procedure, "procedure");
    assertShortString(record.eventId, "eventId", { optional: true });
    assertShortString(record.captureSessionId, "captureSessionId", { optional: true });
    assertShortString(record.campaignId, "campaignId", { optional: true });
    assertShortString(record.status, "status");
  } catch {
    return null;
  }
  if (
    typeof record.occurredAtUtc !== "undefined" &&
    !canonicalTimestamp(record.occurredAtUtc)
  ) {
    return null;
  }
  if (
    record.status !== "acknowledged" ||
    record.observationJoinRequired !== true
  ) {
    return null;
  }
  if (record.payload !== undefined && !isPlainObject(record.payload)) return null;
  if (
    PROCEDURES[record.recordType] &&
    record.procedure !== PROCEDURES[record.recordType]
  ) {
    return null;
  }
  try {
    validateSafeTree(record);
  } catch {
    return null;
  }
  return Object.freeze(record);
}

function readLogTail(logPath, maximumBytes = MAX_LOG_TAIL_BYTES) {
  const stat = fs.lstatSync(logPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("configured debug log is not a regular file");
  }
  const start = Math.max(0, stat.size - maximumBytes);
  const length = stat.size - start;
  const handle = fs.openSync(logPath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, start);
    const text = buffer.toString("utf8");
    const lines = [];
    let relativeOffset = 0;
    for (const rawLine of text.split("\n")) {
      const bytes = Buffer.byteLength(rawLine, "utf8") + 1;
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!(start > 0 && relativeOffset === 0)) {
        lines.push({ line, byteOffset: start + relativeOffset });
      }
      relativeOffset += bytes;
    }
    return {
      modifiedAtUtc: stat.mtime.toISOString(),
      lines
    };
  } finally {
    fs.closeSync(handle);
  }
}

function hashId(...parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part)).join("\u001f"))
    .digest("hex")
    .slice(0, 24);
}

function freshness(timestamp, nowMs, thresholdMs) {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return "unknown";
  return Math.abs(nowMs - value) <= thresholdMs ? "fresh" : "stale";
}

function structuredLogRecords({ logPath, now = () => Date.now() }) {
  if (!logPath || !fs.existsSync(logPath)) return [];
  const tail = readLogTail(logPath);
  const recordedAtUtc = tail.modifiedAtUtc;
  const nowMs = now();
  const records = [];
  for (const item of tail.lines) {
    const parsed = parseEu5ControlLine(item.line);
    if (!parsed) continue;
    const occurredAtUtc = parsed.occurredAtUtc || recordedAtUtc;
    const recordType =
      parsed.recordType === "bridge_health" ? "health" : "game_event";
    const subject = {};
    if (parsed.campaignId !== undefined) subject.campaignId = parsed.campaignId;
    const payload = {
      sourceRecordType: parsed.recordType,
      procedure: parsed.procedure || null,
      modVersion: parsed.modVersion,
      status: parsed.status,
      observationJoinRequired: parsed.observationJoinRequired,
      data: parsed.payload || {}
    };
    records.push({
      recordId:
        parsed.eventId ||
        `eu5-log-${hashId(item.byteOffset, JSON.stringify(parsed))}`,
      recordType,
      occurredAtUtc,
      recordedAtUtc,
      sequence: 0,
      ...(parsed.captureSessionId
        ? { captureSessionId: parsed.captureSessionId }
        : {}),
      subject,
      provenance: {
        adapter: { id: "eu5-control-debug-log", version: "1" },
        verification: {
          status: "unverified",
          evidence:
            "Recognized structured EU5_CONTROL record; values are not independently authenticated."
        },
        freshness: freshness(recordedAtUtc, nowMs, LOG_FRESH_MS)
      },
      payload
    });
  }
  return records;
}

function ledgerRecordId(event) {
  const identifier =
    event.declarationId ||
    event.authorizationId ||
    event.dispatchId ||
    event.outcomeId ||
    event.approvalId ||
    hashId(JSON.stringify(event));
  return `ledger-${event.type}-${identifier}`;
}

function mapLedgerEvents(events, { now = () => Date.now() } = {}) {
  if (!Array.isArray(events)) throw new TypeError("ledger events must be an array");
  const declarations = new Map();
  for (const event of events) {
    if (isPlainObject(event) && event.type === "declared" && event.declarationId) {
      declarations.set(event.declarationId, event);
    }
  }
  const nowMs = now();
  const records = [];
  for (const event of events) {
    if (!isPlainObject(event) || !canonicalTimestamp(event.recordedAtUtc)) continue;
    const declaration =
      event.type === "declared"
        ? event
        : declarations.get(event.declarationId);
    const subject = {};
    if (declaration && typeof declaration.campaign === "string") {
      subject.campaignId = declaration.campaign;
    }
    const base = {
      recordId: ledgerRecordId(event),
      occurredAtUtc: event.observedAtUtc && canonicalTimestamp(event.observedAtUtc)
        ? event.observedAtUtc
        : event.recordedAtUtc,
      recordedAtUtc: event.recordedAtUtc,
      sequence: 0,
      ...(event.declarationId ? { correlationId: event.declarationId } : {}),
      subject,
      provenance: {
        adapter: { id: "eu5-control-ledger", version: "1" },
        verification: {
          status: "unverified",
          evidence:
            "Local append-only protocol record; external execution and game state are not independently verified."
        },
        freshness: freshness(event.recordedAtUtc, nowMs, LOG_FRESH_MS)
      }
    };
    if (event.type === "declared") {
      records.push({
        ...base,
        recordType: "llm_action_proposed",
        payload: {
          lifecycleState: "declared",
          actionId: event.action && event.action.id || null,
          risk: event.action && event.action.risk || null,
          expectedVisibleResult:
            sanitizeFreeText(event.action && event.action.expectedVisibleResult)
        }
      });
    } else if (event.type === "authorized") {
      records.push({
        ...base,
        recordType: "llm_action_outcome",
        payload: { lifecycleState: "authorized", uiInputExecuted: false }
      });
    } else if (event.type === "dispatched") {
      records.push({
        ...base,
        recordType: "llm_action_outcome",
        payload: {
          lifecycleState: "dispatch_prepared",
          uiInputExecuted: event.uiInputExecuted === true
        }
      });
    } else if (event.type === "outcome") {
      records.push({
        ...base,
        recordType: "llm_action_outcome",
        payload: {
          lifecycleState: "outcome_recorded",
          actualVisibleResult:
            sanitizeFreeText(event.actualVisibleResult)
        }
      });
    } else if (event.type === "verified") {
      records.push({
        ...base,
        recordType: "llm_action_outcome",
        payload: {
          lifecycleState:
            typeof event.state === "string" ? event.state : "unknown",
          verified: event.verified === true
        }
      });
    }
  }
  return records;
}

function checkpointRecord({ saveDirectory, now = () => Date.now() }) {
  const checkpoint = latestSaveCheckpoint(saveDirectory);
  if (!checkpoint.latest) return null;
  const nowMs = now();
  return {
    recordId: `checkpoint-${hashId(
      checkpoint.latest.relativePath,
      checkpoint.latest.lastWriteTimeUtc,
      checkpoint.latest.bytes
    )}`,
    recordType: "game_event",
    occurredAtUtc: checkpoint.latest.lastWriteTimeUtc,
    recordedAtUtc: checkpoint.observedAtUtc,
    sequence: 0,
    subject: {},
    provenance: {
      adapter: { id: "eu5-checkpoint-metadata", version: "1" },
      verification: {
        status: "verified",
        evidence: "Metadata-only observation of the newest save checkpoint."
      },
      freshness: freshness(
        checkpoint.latest.lastWriteTimeUtc,
        nowMs,
        CHECKPOINT_FRESH_MS
      )
    },
    payload: {
      event: "latest-save-observed",
      saveFile: path.basename(checkpoint.latest.relativePath),
      bytes: checkpoint.latest.bytes,
      lastWriteTimeUtc: checkpoint.latest.lastWriteTimeUtc,
      saveCount: checkpoint.fileCount
    }
  };
}

function defaultDebugLogPath() {
  const userDirectory =
    process.env.EU5_USER_DIRECTORY ||
    path.join(
      os.homedir(),
      "Documents",
      "Paradox Interactive",
      "Europa Universalis V"
    );
  return process.env.EU5_DEBUG_LOG_PATH || path.join(userDirectory, "logs", "debug.log");
}

function buildLiveFeed({
  now = () => Date.now(),
  logPath = defaultDebugLogPath(),
  ledgerReader,
  saveDirectory = process.env.EU5_SAVE_DIRECTORY
} = {}) {
  const generatedAtUtc = new Date(now()).toISOString();
  const records = [];
  const sourceHealth = [];

  try {
    const logRecords = structuredLogRecords({ logPath, now });
    records.push(...logRecords);
    sourceHealth.push({
      component: "structured-debug-log",
      status: logRecords.length ? "available" : "awaiting-recognized-record",
      recognizedRecordCount: logRecords.length
    });
  } catch {
    sourceHealth.push({
      component: "structured-debug-log",
      status: "unavailable",
      recognizedRecordCount: 0
    });
  }

  try {
    const events = ledgerReader
      ? ledgerReader()
      : new ControlLedger().readAll();
    const ledgerRecords = mapLedgerEvents(events, { now });
    records.push(...ledgerRecords);
    sourceHealth.push({
      component: "action-ledger",
      status: "available",
      recognizedRecordCount: ledgerRecords.length
    });
  } catch {
    sourceHealth.push({
      component: "action-ledger",
      status: "malformed-or-unavailable",
      recognizedRecordCount: 0
    });
  }

  try {
    const record = checkpointRecord({ saveDirectory, now });
    if (record) records.push(record);
    sourceHealth.push({
      component: "save-checkpoint",
      status: record ? "available" : "no-save-found",
      recognizedRecordCount: record ? 1 : 0
    });
  } catch {
    sourceHealth.push({
      component: "save-checkpoint",
      status: "unavailable",
      recognizedRecordCount: 0
    });
  }

  for (const health of sourceHealth) {
    records.push({
      recordId: `health-${health.component}`,
      recordType: "health",
      occurredAtUtc: generatedAtUtc,
      recordedAtUtc: generatedAtUtc,
      sequence: 0,
      subject: {},
      provenance: {
        adapter: { id: "eu5-local-monitoring-server", version: "1" },
        verification: {
          status: "verified",
          evidence: "Local adapter status generated by the loopback-only monitoring server."
        },
        freshness: "fresh"
      },
      payload: health
    });
  }

  const bounded = records
    .sort((left, right) => {
      const time = Date.parse(left.recordedAtUtc) - Date.parse(right.recordedAtUtc);
      return time || left.recordId.localeCompare(right.recordId);
    })
    .slice(-MAX_RECORDS)
    .map((record, sequence) => ({ ...record, sequence }));
  for (const record of bounded) validateSafeTree(record);
  const manifestSha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify(bounded))
    .digest("hex");

  return {
    schemaVersion: LIVE_FEED_SCHEMA,
    feedId: `local-${generatedAtUtc.slice(0, 10)}`,
    generatedAtUtc,
    sourceMode: "local-live",
    records: bounded,
    integrity: { manifestSha256 }
  };
}

module.exports = {
  CHECKPOINT_FRESH_MS,
  CONTROL_LOG_SCHEMA,
  CONTROL_MARKER,
  LIVE_FEED_SCHEMA,
  LOG_FRESH_MS,
  MAX_LOG_RECORD_BYTES,
  MAX_LOG_TAIL_BYTES,
  MAX_RECORDS,
  buildLiveFeed,
  checkpointRecord,
  defaultDebugLogPath,
  freshness,
  mapLedgerEvents,
  parseEu5ControlLine,
  readLogTail,
  sanitizeFreeText,
  structuredLogRecords,
  validateSafeTree
};
