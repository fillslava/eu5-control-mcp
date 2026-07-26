"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { latestSaveCheckpoint } = require("../read/latest-save");
const {
  ControlLedger,
  validateLedgerRecords
} = require("../control/control-ledger");
const {
  TYPED_RECORD_DEFINITIONS,
  TYPED_RECORD_TYPES,
  REVIEWED_TELEMETRY_MOD_VERSION,
  latestVerifiedState,
  validatePartialTelemetryRecord,
  validateTypedPayload
} = require("./typed-telemetry");

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
  "state_snapshot",
  ...TYPED_RECORD_TYPES,
  "telemetry_export",
  "telemetry_fact"
]);
const PROCEDURES = Object.freeze({
  bridge_health: "emit_ping",
  player_scope: "emit_player_scope",
  state_snapshot: "emit_state_snapshot",
  ...Object.fromEntries(
    Object.entries(TYPED_RECORD_DEFINITIONS)
      .map(([recordType, definition]) => [recordType, definition.procedure])
  )
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
  "payload",
  "section",
  "completeness",
  "field",
  "value",
  "availability",
  "reason",
  "unit"
]);
const CANONICAL_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FORBIDDEN_KEY =
  /token|secret|password|cookie|authorization|apikey|credential|privatekey|bearer/i;
const LOCAL_PATH = /(?:[a-z]:[\\/]|\\\\|file:)/i;
const CREDENTIAL_VALUE =
  /\b(?:authorization\s*:\s*(?:bearer|basic)\s+\S+|bearer\s+[a-z0-9._~+/=-]{8,}|(?:api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|password|secret)\s*[:=]\s*\S+)/i;
const SHA256 = /^[a-f0-9]{64}$/;

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

function parseEu5ControlLine(line, { now = () => Date.now() } = {}) {
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
  const partialTelemetry = validatePartialTelemetryRecord(record);
  const typedPayload = TYPED_RECORD_TYPES.has(record.recordType) &&
    record.payload !== undefined;
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
  if (!partialTelemetry && (
    record.status !== "acknowledged" ||
    record.observationJoinRequired !== true
  )) return null;
  if (record.payload !== undefined && !isPlainObject(record.payload)) return null;
  if (!partialTelemetry && (
    PROCEDURES[record.recordType] &&
    record.procedure !== PROCEDURES[record.recordType]
  )) return null;
  if (
    (record.recordType === "telemetry_export" ||
      record.recordType === "telemetry_fact") &&
    !partialTelemetry
  ) return null;
  if (typedPayload) {
    if (
      record.eventId === undefined ||
      record.captureSessionId === undefined ||
      record.campaignId === undefined ||
      record.occurredAtUtc === undefined ||
      record.payload === undefined
    ) {
      return null;
    }
    if (record.modVersion !== REVIEWED_TELEMETRY_MOD_VERSION) return null;
    try {
      record.payload = validateTypedPayload(record.recordType, record.payload, {
        nowMs: now()
      });
    } catch {
      return null;
    }
    if (record.occurredAtUtc !== record.payload.capturedAtUtc) return null;
  } else if (
    TYPED_RECORD_TYPES.has(record.recordType) &&
    !partialTelemetry
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

function sameFileIdentity(left, right) {
  return (
    left &&
    right &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtimeNs === right.birthtimeNs
  );
}

function validFileIdentity(stat) {
  return Boolean(
    stat &&
    typeof stat.dev === "bigint" &&
    typeof stat.ino === "bigint" &&
    (stat.dev !== 0n || stat.ino !== 0n) &&
    typeof stat.birthtimeNs === "bigint" &&
    stat.birthtimeNs > 0n
  );
}

function logClockSeconds(line) {
  const match = /^\[(\d{2}):(\d{2}):(\d{2})\]/.exec(line);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function timestampLogLines(lines, modifiedAtMs) {
  const anchor = new Date(modifiedAtMs);
  if (!Number.isFinite(anchor.getTime())) return lines;
  let lastClockSeconds = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    lastClockSeconds = logClockSeconds(lines[index].line);
    if (lastClockSeconds !== null) break;
  }
  if (lastClockSeconds === null) return lines;
  const clockParts = (seconds) => ({
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60
  });
  const makeTimestamp = (mode, dayOffset, seconds) => {
    const clock = clockParts(seconds);
    if (mode === "utc") {
      return new Date(Date.UTC(
        anchor.getUTCFullYear(),
        anchor.getUTCMonth(),
        anchor.getUTCDate() + dayOffset,
        clock.hours,
        clock.minutes,
        clock.seconds,
        0
      ));
    }
    return new Date(
      anchor.getFullYear(),
      anchor.getMonth(),
      anchor.getDate() + dayOffset,
      clock.hours,
      clock.minutes,
      clock.seconds,
      0
    );
  };
  const candidates = [];
  for (const mode of ["local", "utc"]) {
    for (const dayOffset of [-1, 0, 1]) {
      const value = makeTimestamp(mode, dayOffset, lastClockSeconds);
      candidates.push({
        mode,
        dayOffset,
        distance: Math.abs(value.getTime() - modifiedAtMs)
      });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance);
  const selected = candidates[0];
  let dayOffset = selected.dayOffset;
  let nextSeconds = null;
  const stamped = [...lines];
  for (let index = stamped.length - 1; index >= 0; index -= 1) {
    const seconds = logClockSeconds(stamped[index].line);
    if (seconds === null) continue;
    if (nextSeconds !== null && seconds > nextSeconds) dayOffset -= 1;
    stamped[index] = {
      ...stamped[index],
      recordedAtUtc: makeTimestamp(
        selected.mode,
        dayOffset,
        seconds
      ).toISOString()
    };
    nextSeconds = seconds;
  }
  return stamped;
}

function readLogTail(
  logPath,
  maximumBytes = MAX_LOG_TAIL_BYTES,
  { fileSystem = fs } = {}
) {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes <= 0 ||
    maximumBytes > MAX_LOG_TAIL_BYTES
  ) {
    throw new TypeError(`maximumBytes must be between 1 and ${MAX_LOG_TAIL_BYTES}`);
  }
  const resolved = path.resolve(logPath);
  const pathWithoutRoot = resolved.slice(path.parse(resolved).root.length);
  if (pathWithoutRoot.includes(":")) {
    throw new Error("configured debug log must not use a Windows alternate data stream");
  }
  let handle;
  try {
    const pathStat = fileSystem.lstatSync(resolved, { bigint: true });
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
      throw new Error("configured debug log is not a regular non-symlink file");
    }
    handle = fileSystem.openSync(
      resolved,
      fileSystem.constants.O_RDONLY | (fileSystem.constants.O_NOFOLLOW || 0)
    );
    const openedStat = fileSystem.fstatSync(handle, { bigint: true });
    if (!openedStat.isFile()) {
      throw new Error("configured debug log is not a regular file");
    }
    if (
      !validFileIdentity(pathStat) ||
      !validFileIdentity(openedStat) ||
      !sameFileIdentity(pathStat, openedStat) ||
      pathStat.size !== openedStat.size
    ) {
      throw new Error("configured debug log changed while it was being opened");
    }
    if (openedStat.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("configured debug log is too large to read safely");
    }
    const maximumBytesBigInt = BigInt(maximumBytes);
    const startBigInt =
      openedStat.size > maximumBytesBigInt
        ? openedStat.size - maximumBytesBigInt
        : 0n;
    const start = Number(startBigInt);
    const length = Number(openedStat.size - startBigInt);
    const buffer = Buffer.alloc(length);
    let totalBytes = 0;
    while (totalBytes < length) {
      const bytesRead = fileSystem.readSync(
        handle,
        buffer,
        totalBytes,
        length - totalBytes,
        start + totalBytes
      );
      if (bytesRead === 0) {
        throw new Error("configured debug log shrank while it was being read");
      }
      totalBytes += bytesRead;
    }
    const finalHandleStat = fileSystem.fstatSync(handle, { bigint: true });
    if (
      !sameFileIdentity(openedStat, finalHandleStat) ||
      finalHandleStat.size !== openedStat.size
    ) {
      throw new Error("configured debug log changed while it was being read");
    }
    const finalPathStat = fileSystem.lstatSync(resolved, { bigint: true });
    if (
      finalPathStat.isSymbolicLink() ||
      !finalPathStat.isFile() ||
      !sameFileIdentity(finalHandleStat, finalPathStat) ||
      finalPathStat.size !== finalHandleStat.size
    ) {
      throw new Error("configured debug log path changed while it was being read");
    }
    const lines = [];
    let lineStart = 0;
    for (let index = 0; index <= buffer.length; index += 1) {
      if (index !== buffer.length && buffer[index] !== 0x0a) continue;
      let lineEnd = index;
      if (lineEnd > lineStart && buffer[lineEnd - 1] === 0x0d) lineEnd -= 1;
      if (!(start > 0 && lineStart === 0)) {
        lines.push({
          line: buffer.subarray(lineStart, lineEnd).toString("utf8"),
          byteOffset: start + lineStart
        });
      }
      lineStart = index + 1;
    }
    const sourceIdentity = crypto
      .createHash("sha256")
      .update([
        openedStat.dev.toString(),
        openedStat.ino.toString(),
        openedStat.birthtimeNs.toString()
      ].join("\u001f"))
      .digest("hex")
      .slice(0, 24);
    const modifiedAtMs = Number(openedStat.mtimeNs / 1_000_000n);
    return {
      modifiedAtUtc: new Date(modifiedAtMs).toISOString(),
      sourceIdentity,
      lines: timestampLogLines(lines, modifiedAtMs)
    };
  } finally {
    if (handle !== undefined) fileSystem.closeSync(handle);
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

function telemetryEvidencePayload(context) {
  return JSON.stringify({
    evidenceId: context.evidenceId,
    modVersion: context.modVersion,
    manifestSha256: context.manifestSha256,
    campaignId: context.campaignId,
    captureSessionId: context.captureSessionId
  });
}

function trustedTypedTelemetry(
  record,
  trustedContext,
  secret = process.env.EU5_TELEMETRY_EVIDENCE_SECRET
) {
  if (
    !isPlainObject(trustedContext) ||
    Object.keys(trustedContext).some((key) => ![
      "evidenceId",
      "modVersion",
      "manifestSha256",
      "campaignId",
      "captureSessionId",
      "signature"
    ].includes(key)) ||
    Object.keys(trustedContext).length !== 6 ||
    typeof secret !== "string" ||
    secret.length < 32 ||
    trustedContext.modVersion !== REVIEWED_TELEMETRY_MOD_VERSION ||
    record.modVersion !== REVIEWED_TELEMETRY_MOD_VERSION ||
    trustedContext.campaignId !== record.campaignId ||
    trustedContext.captureSessionId !== record.captureSessionId ||
    typeof trustedContext.manifestSha256 !== "string" ||
    !SHA256.test(trustedContext.manifestSha256) ||
    typeof trustedContext.evidenceId !== "string" ||
    trustedContext.evidenceId.length === 0 ||
    trustedContext.evidenceId.length > 256 ||
    typeof trustedContext.signature !== "string" ||
    !SHA256.test(trustedContext.signature)
  ) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(telemetryEvidencePayload(trustedContext))
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(trustedContext.signature, "hex")
  );
}

function structuredLogRecords({
  logPath,
  now = () => Date.now(),
  trustedTelemetryContext
}) {
  if (!logPath) return [];
  let tail;
  try {
    tail = readLogTail(logPath);
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  const nowMs = now();
  const records = [];
  const activePartialGroups = new Map();
  for (const item of tail.lines) {
    const parsed = parseEu5ControlLine(item.line, { now });
    if (!parsed || !item.recordedAtUtc) continue;
    const recordedAtUtc = item.recordedAtUtc;
    const occurredAtUtc = parsed.occurredAtUtc || recordedAtUtc;
    const partialTelemetry = validatePartialTelemetryRecord(parsed);
    const typed = TYPED_RECORD_TYPES.has(parsed.recordType) &&
      parsed.payload !== undefined;
    const recordType = typed
      ? "nation_snapshot"
      : parsed.recordType === "bridge_health"
        ? "health"
        : "game_event";
    const subject = {};
    if (parsed.campaignId !== undefined) subject.campaignId = parsed.campaignId;
    if (typed) {
      if (parsed.payload.country.id !== undefined) {
        subject.countryId = parsed.payload.country.id;
      }
      subject.countryTag = parsed.payload.country.tag;
      subject.countryName = parsed.payload.country.name;
    }
    let correlationId;
    if (partialTelemetry && partialTelemetry.kind === "partial_export") {
      correlationId = `eu5-export-${hashId(
        tail.sourceIdentity,
        item.byteOffset,
        parsed.procedure,
        parsed.section,
        parsed.modVersion
      )}`;
      activePartialGroups.set(partialTelemetry.domain, {
        correlationId,
        procedure: parsed.procedure
      });
    } else if (partialTelemetry && partialTelemetry.kind === "partial_fact") {
      const active = activePartialGroups.get(partialTelemetry.domain);
      if (active && active.procedure === parsed.procedure) {
        correlationId = active.correlationId;
      }
    }
    const payload = {
      sourceRecordType: parsed.recordType,
      procedure: parsed.procedure || null,
      modVersion: parsed.modVersion,
      status: parsed.status,
      ...(parsed.observationJoinRequired === undefined
        ? {}
        : { observationJoinRequired: parsed.observationJoinRequired }),
      ...(typed
        ? {
          domain: TYPED_RECORD_DEFINITIONS[parsed.recordType].domain,
          gameDate: parsed.payload.gameDate,
          capturedAtUtc: parsed.payload.capturedAtUtc,
          paused: parsed.payload.paused,
          ...(parsed.payload.gameBuild === undefined
            ? {}
            : { gameBuild: parsed.payload.gameBuild }),
          metrics: parsed.payload.metrics,
          ...(parsed.payload.market === undefined
            ? {}
            : { market: parsed.payload.market }),
          ...(parsed.payload.goods === undefined
            ? {}
            : { goods: parsed.payload.goods }),
          ...(parsed.payload.relations === undefined
            ? {}
            : { relations: parsed.payload.relations }),
          ...(parsed.payload.armies === undefined
            ? {}
            : { armies: parsed.payload.armies })
        }
        : partialTelemetry
          ? {
            event: partialTelemetry.kind,
            domain: partialTelemetry.domain,
            completeness:
              partialTelemetry.kind === "partial_export"
                ? partialTelemetry.completeness
                : "partial",
            ...(partialTelemetry.kind === "partial_fact"
              ? {
                field: partialTelemetry.field,
                value: partialTelemetry.value,
                availability: partialTelemetry.availability,
                ...(partialTelemetry.unit === undefined
                  ? {}
                  : { unit: partialTelemetry.unit }),
                ...(partialTelemetry.reason === undefined
                  ? {}
                  : { reason: partialTelemetry.reason })
              }
              : {})
          }
        : { data: parsed.payload || {} })
    };
    const typedTrusted = typed &&
      trustedTypedTelemetry(parsed, trustedTelemetryContext);
    const normalized = {
      recordId:
        parsed.eventId
          ? `eu5-event-${hashId(tail.sourceIdentity, parsed.eventId)}`
          : `eu5-log-${hashId(
          tail.sourceIdentity,
          item.byteOffset,
          JSON.stringify(parsed)
        )}`,
      recordType,
      occurredAtUtc,
      recordedAtUtc,
      sequence: 0,
      ...(parsed.captureSessionId
        ? { captureSessionId: parsed.captureSessionId }
        : {}),
      ...(correlationId ? { correlationId } : {}),
      subject,
      provenance: {
        adapter: { id: "eu5-control-bridge", version: "1" },
        verification: {
          status: typedTrusted ? "verified" : "unverified",
          evidence: typedTrusted
            ? "Typed telemetry matched externally authenticated campaign, capture-session and reviewed-manifest evidence."
            : typed
              ? "Schema-valid typed telemetry without matching external campaign and manifest authentication."
            : partialTelemetry
              ? "Strictly allowlisted partial observation; country, game date and scalar values remain unavailable unless explicitly present."
            : "Recognized structured EU5_CONTROL record; values are not independently authenticated."
        },
        freshness: freshness(
          typed ? parsed.payload.capturedAtUtc : recordedAtUtc,
          nowMs,
          LOG_FRESH_MS
        )
      },
      payload
    };
    Object.defineProperty(normalized, "_sourceOrder", {
      value: item.byteOffset,
      enumerable: false
    });
    records.push(normalized);
  }
  return records;
}

function latestPartialObservations(records) {
  const domains = {};
  for (const record of records) {
    if (
      record.recordType === "game_event" &&
      record.payload &&
      record.payload.event === "partial_export" &&
      record.provenance &&
      record.provenance.freshness === "fresh"
    ) {
      domains[record.payload.domain] = {
        captureGroupId: record.correlationId,
        fields: {},
        updatedAtUtc: record.recordedAtUtc
      };
      continue;
    }
    if (
      record.recordType !== "game_event" ||
      !record.payload ||
      record.payload.event !== "partial_fact" ||
      !record.provenance ||
      record.provenance.freshness !== "fresh"
    ) {
      continue;
    }
    const domain = record.payload.domain;
    if (
      !domains[domain] ||
      !record.correlationId ||
      domains[domain].captureGroupId !== record.correlationId
    ) continue;
    domains[domain].fields[record.payload.field] = {
      value: record.payload.value,
      availability: record.payload.availability,
      ...(record.payload.unit === undefined
        ? {}
        : { unit: record.payload.unit }),
      ...(record.payload.reason === undefined
        ? {}
        : { reason: record.payload.reason })
    };
    domains[domain].updatedAtUtc = record.recordedAtUtc;
  }
  return {
    status: Object.keys(domains).length ? "partial" : "unavailable",
    country: null,
    gameDate: null,
    domains
  };
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
  validateLedgerRecords(events);
  const declarations = new Map();
  const dispatches = new Map();
  const outcomes = new Map();
  for (const event of events) {
    if (!isPlainObject(event)) continue;
    if (event.type === "declared" && event.declarationId) {
      declarations.set(event.declarationId, event);
    } else if (event.type === "dispatched" && event.dispatchId) {
      dispatches.set(event.dispatchId, event);
    } else if (event.type === "outcome" && event.outcomeId) {
      outcomes.set(event.outcomeId, event);
    }
  }
  const declarationIdFor = (event) => {
    if (typeof event.declarationId === "string") return event.declarationId;
    const outcome =
      typeof event.outcomeId === "string" ? outcomes.get(event.outcomeId) : null;
    const dispatchId =
      typeof event.dispatchId === "string"
        ? event.dispatchId
        : outcome && outcome.dispatchId;
    const dispatch =
      typeof dispatchId === "string" ? dispatches.get(dispatchId) : null;
    return dispatch && typeof dispatch.declarationId === "string"
      ? dispatch.declarationId
      : null;
  };
  const nowMs = now();
  const records = [];
  const lifecycleEvents = new Map();
  for (const event of events) {
    if (!isPlainObject(event) || !canonicalTimestamp(event.recordedAtUtc)) continue;
    const declarationId = declarationIdFor(event);
    if (!declarationId) continue;
    const grouped = lifecycleEvents.get(declarationId) || [];
    grouped.push(event);
    lifecycleEvents.set(declarationId, grouped);
  }

  const semanticPayload = (declaration) => ({
    actionId:
      typeof declaration.actionId === "string"
        ? declaration.actionId
        : declaration.action && declaration.action.id || null,
    actionFamily:
      typeof declaration.actionFamily === "string"
        ? declaration.actionFamily
        : declaration.action && declaration.action.actionFamily || null,
    procedure:
      typeof declaration.procedure === "string"
        ? declaration.procedure
        : declaration.action && declaration.action.procedure || null,
    capability:
      typeof declaration.capability === "string"
        ? declaration.capability
        : declaration.action && declaration.action.capability || null
  });

  const terminalOutcome = (grouped) => {
    const verified = [...grouped].reverse().find((event) => event.type === "verified");
    if (verified) return verified;
    return [...grouped].reverse().find((event) =>
      event.type === "outcome" && event.state === "execution_unknown"
    ) || null;
  };

  const terminalState = (event) => {
    if (
      event.state === "execution_unknown" ||
      event.lifecycleState === "execution_unknown"
    ) return "execution_unknown";
    if (event.state === "expired" || event.lifecycleState === "expired") {
      return "expired";
    }
    if (
      event.state === "attested_untrusted" ||
      event.state === "ambiguous" ||
      event.lifecycleState === "ambiguous"
    ) return "ambiguous";
    return "failed";
  };

  for (const declaration of declarations.values()) {
    if (!canonicalTimestamp(declaration.recordedAtUtc)) continue;
    const declarationId = declaration.declarationId;
    const grouped = lifecycleEvents.get(declarationId) || [declaration];
    const subject = {};
    const campaignId =
      typeof declaration.campaignId === "string"
        ? declaration.campaignId
        : declaration.campaign;
    if (typeof campaignId === "string") subject.campaignId = campaignId;
    if (typeof declaration.countryId === "string") {
      subject.countryId = declaration.countryId;
    }
    const session = typeof declaration.rehearsalId === "string"
      ? { captureSessionId: declaration.rehearsalId }
      : {};
    const provenance = (event, verified = false) => ({
      adapter: { id: "eu5-control-ledger", version: "1" },
      verification: {
        status: verified ? "verified" : "unverified",
        evidence: verified
          ? "Independent signed verification recorded in append-only control ledger."
          : "Local append-only protocol record; external execution and game state are not independently verified."
      },
      freshness: freshness(event.recordedAtUtc, nowMs, LOG_FRESH_MS),
      ...(verified && SHA256.test(event.evidenceSha256)
        ? { rawArtifactSha256: event.evidenceSha256 }
        : {})
    });
    const proposalBase = {
      recordId: ledgerRecordId(declaration),
      occurredAtUtc: declaration.recordedAtUtc,
      recordedAtUtc: declaration.recordedAtUtc,
      sequence: 0,
      correlationId: declarationId,
      ...session,
      subject,
      provenance: provenance(declaration)
    };
    const semantics = semanticPayload(declaration);
    records.push({
      ...proposalBase,
      recordType: "llm_action_proposed",
      payload: {
        lifecycleState: "declared",
        ...semantics,
        risk: declaration.action && declaration.action.risk || null,
        expectedVisibleResult:
          sanitizeFreeText(declaration.action && declaration.action.expectedVisibleResult)
      }
    });

    const terminal = terminalOutcome(grouped);
    if (!terminal) continue;
    const terminalSemantics = semanticPayload(terminal);
    const terminalHasSemantics =
      typeof terminal.actionId === "string" &&
      typeof terminal.actionFamily === "string" &&
      typeof terminal.procedure === "string" &&
      (typeof terminal.capability === "string" || terminal.capability === null);
    const terminalSemanticsMatch =
      terminalHasSemantics &&
      terminalSemantics.actionId === semantics.actionId &&
      terminalSemantics.actionFamily === semantics.actionFamily &&
      terminalSemantics.procedure === semantics.procedure &&
      terminalSemantics.capability === semantics.capability;
    const terminalSessionMatches =
      (typeof declaration.rehearsalId !== "string" ||
        terminal.rehearsalId === declaration.rehearsalId) &&
      (typeof campaignId !== "string" ||
        (terminal.campaignId || terminal.campaign) === campaignId) &&
      (typeof declaration.countryId !== "string" ||
        terminal.countryId === declaration.countryId);
    const signedVerified =
      terminal.type === "verified" &&
      terminal.state === "verified" &&
      terminal.verified === true &&
      terminalSemanticsMatch &&
      terminalSessionMatches &&
      typeof terminal.verificationId === "string" &&
      terminal.verificationId.trim() !== "" &&
      SHA256.test(terminal.evidenceSha256 || "");
    const outcome = signedVerified ? "success" : terminalState(terminal);
    const outcomeSemantics = terminalHasSemantics
      ? terminalSemantics
      : semantics;
    const occurredAtUtc =
      terminal.observedAtUtc && canonicalTimestamp(terminal.observedAtUtc)
        ? terminal.observedAtUtc
        : terminal.recordedAtUtc;
    const latencyMs =
      Date.parse(terminal.recordedAtUtc) - Date.parse(declaration.recordedAtUtc);
    records.push({
      recordId: ledgerRecordId(terminal),
      recordType: "llm_action_outcome",
      occurredAtUtc,
      recordedAtUtc: terminal.recordedAtUtc,
      sequence: 0,
      correlationId: declarationId,
      ...session,
      subject,
      provenance: provenance(terminal, signedVerified),
      payload: {
        lifecycleState:
          typeof terminal.lifecycleState === "string"
            ? terminal.lifecycleState
            : outcome,
        ...outcomeSemantics,
        outcome,
        latencyMs: Number.isFinite(latencyMs) && latencyMs >= 0
          ? latencyMs
          : null,
        ...(terminal.actualVisibleResult !== undefined
          ? {
              actualVisibleResult:
                sanitizeFreeText(terminal.actualVisibleResult)
            }
          : {})
      }
    });
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
  saveDirectory = process.env.EU5_SAVE_DIRECTORY,
  trustedTelemetryContext
} = {}) {
  const generatedAtUtc = new Date(now()).toISOString();
  const records = [];
  const sourceHealth = [];

  try {
    const logRecords = structuredLogRecords({
      logPath,
      now,
      trustedTelemetryContext
    });
    records.push(...logRecords);
    const verifiedTypedRecordCount = logRecords.filter((record) =>
      record.recordType === "nation_snapshot" &&
      record.provenance.verification.status === "verified"
    ).length;
    const partialTelemetryRecordCount = logRecords.filter((record) =>
      record.recordType === "game_event" &&
      record.payload &&
      (record.payload.event === "partial_export" ||
        record.payload.event === "partial_fact")
    ).length;
    const freshRecordCount = logRecords.filter((record) =>
      record.provenance.freshness === "fresh"
    ).length;
    const freshPartialTelemetryRecordCount = logRecords.filter((record) =>
      record.provenance.freshness === "fresh" &&
      record.recordType === "game_event" &&
      record.payload &&
      (record.payload.event === "partial_export" ||
        record.payload.event === "partial_fact")
    ).length;
    const status = verifiedTypedRecordCount > 0
      ? "available"
      : freshPartialTelemetryRecordCount > 0
        ? "partial-observation-only"
        : logRecords.length > 0
          ? "stale-or-unverified-only"
          : "awaiting-recognized-record";
    sourceHealth.push({
      component: "structured-debug-log",
      status,
      recognizedRecordCount: logRecords.length,
      freshRecordCount,
      verifiedTypedRecordCount,
      partialTelemetryRecordCount,
      freshPartialTelemetryRecordCount
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
      if (time) return time;
      const leftHasSourceOrder = Number.isSafeInteger(left._sourceOrder);
      const rightHasSourceOrder = Number.isSafeInteger(right._sourceOrder);
      if (leftHasSourceOrder && rightHasSourceOrder) {
        return left._sourceOrder - right._sourceOrder;
      }
      if (leftHasSourceOrder !== rightHasSourceOrder) {
        return leftHasSourceOrder ? -1 : 1;
      }
      return left.recordId.localeCompare(right.recordId);
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
    currentState: latestVerifiedState(bounded),
    currentObservations: latestPartialObservations(bounded),
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
  latestPartialObservations,
  parseEu5ControlLine,
  readLogTail,
  sanitizeFreeText,
  structuredLogRecords,
  telemetryEvidencePayload,
  trustedTypedTelemetry,
  validateSafeTree
};
