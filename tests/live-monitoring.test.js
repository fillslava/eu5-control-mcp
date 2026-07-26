"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  CONTROL_LOG_SCHEMA,
  buildLiveFeed,
  latestPartialObservations,
  mapLedgerEvents,
  parseEu5ControlLine,
  structuredLogRecords,
  telemetryEvidencePayload
} = require("../src/monitoring/live-feed");
const {
  latestVerifiedState,
  validateTypedPayload
} = require("../src/monitoring/typed-telemetry");

function structured(overrides = {}) {
  return {
    schemaVersion: CONTROL_LOG_SCHEMA,
    recordType: "bridge_health",
    procedure: "emit_ping",
    modVersion: "0.2.3",
    status: "acknowledged",
    observationJoinRequired: true,
    ...overrides
  };
}

function typed(recordType, payload, overrides = {}) {
  const procedures = {
    player_summary: "emit_player_summary",
    economy_snapshot: "emit_economy_snapshot",
    markets_snapshot: "emit_markets_snapshot",
    diplomacy_snapshot: "emit_diplomacy_snapshot",
    military_snapshot: "emit_military_snapshot"
  };
  return structured({
    modVersion: "0.3.0",
    recordType,
    procedure: procedures[recordType],
    eventId: `${recordType}-1`,
    captureSessionId: "capture-1",
    campaignId: "holland-test",
    occurredAtUtc: payload.capturedAtUtc,
    payload,
    ...overrides
  });
}

function basePayload(overrides = {}) {
  return {
    country: { id: "country-42", tag: "HOL", name: "Holland" },
    gameDate: "1337-04-14",
    capturedAtUtc: "2026-07-26T17:00:00.000Z",
    paused: true,
    gameBuild: "1.0.0",
    metrics: {},
    ...overrides
  };
}

function wrapped(record, line = 15) {
  return `[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:${line}: EU5_CONTROL ${JSON.stringify(record)}`;
}

const EVIDENCE_SECRET = "test-only-eu5-evidence-secret-32-bytes";

function trustedContext(overrides = {}, secret = EVIDENCE_SECRET) {
  const context = {
    modVersion: "0.3.0",
    campaignId: "holland-test",
    captureSessionId: "capture-1",
    manifestSha256: "a".repeat(64),
    evidenceId: "reviewed-test-evidence",
    ...overrides
  };
  return {
    ...context,
    signature: crypto
      .createHmac("sha256", secret)
      .update(telemetryEvidencePayload(context))
      .digest("hex")
  };
}

test("strict parser accepts the current bridge contract and rejects malformed or unknown records", () => {
  const accepted = parseEu5ControlLine(
    `[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:15: EU5_CONTROL ${JSON.stringify(structured())}`
  );
  assert.equal(accepted.recordType, "bridge_health");
  assert.equal(accepted.status, "acknowledged");

  assert.equal(parseEu5ControlLine("EU5_CONTROL not-json"), null);
  assert.equal(
    parseEu5ControlLine(`[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:15: EU5_CONTROL ${JSON.stringify(structured({ recordType: "ping" }))}`),
    null
  );
  assert.equal(
    parseEu5ControlLine(`[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:15: EU5_CONTROL ${JSON.stringify(structured({ extra: true }))}`),
    null
  );
  assert.equal(
    parseEu5ControlLine(
      `[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:15: EU5_CONTROL ${JSON.stringify(structured({ payload: { localPath: "C:\\private\\save.eu5" } }))}`
    ),
    null
  );
  assert.equal(
    parseEu5ControlLine(
      `[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:15: EU5_CONTROL ${JSON.stringify(structured({ payload: { note: "see C:\\private\\save.eu5" } }))}`
    ),
    null
  );
  assert.equal(
    parseEu5ControlLine(
      `[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:15: EU5_CONTROL ${JSON.stringify(structured({ payload: { "api key": "not allowed" } }))}`
    ),
    null
  );
  for (const required of ["status", "observationJoinRequired", "procedure"]) {
    const candidate = structured();
    delete candidate[required];
    assert.equal(
      parseEu5ControlLine(`[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:15: EU5_CONTROL ${JSON.stringify(candidate)}`),
      null,
      `${required} is required`
    );
  }
});

test("strict parser accepts only the exact jomini producer wrapper around one JSON object", () => {
  const json = JSON.stringify(structured());
  const wrapped =
    `[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:15: EU5_CONTROL ${json}`;
  assert.equal(parseEu5ControlLine(wrapped).recordType, "bridge_health");
  assert.equal(parseEu5ControlLine(`${wrapped} attacker-controlled-tail`), null);
  assert.equal(
    parseEu5ControlLine(
      `[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:15: EU5_CONTROL ${json} trailing`
    ),
    null
  );
  assert.equal(parseEu5ControlLine(`EU5_CONTROL ${json} trailing`), null);
  assert.equal(
    parseEu5ControlLine(
      `[17:00:16][jomini_effect_impl.cpp:479]: other/mod/path.txt:15: EU5_CONTROL ${json}`
    ),
    null
  );
  assert.equal(
    parseEu5ControlLine(
      `[17:00:16][jomini_effect_impl.cpp:0]: common/scripted_guis/eu5_control_debug.txt:15: EU5_CONTROL ${json}`
    ),
    null
  );
  assert.equal(
    parseEu5ControlLine(
      `[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:0: EU5_CONTROL ${json}`
    ),
    null
  );
});

test("structured log reader returns only normalized recognized records, never raw lines", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-live-log-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logPath = path.join(root, "debug.log");
  fs.writeFileSync(
    logPath,
    [
      "unrelated private diagnostic text",
      `[17:00:16][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:15: EU5_CONTROL ${JSON.stringify(structured())}`,
      "EU5_CONTROL {broken"
    ].join("\n")
  );
  const records = structuredLogRecords({
    logPath,
    now: () => fs.statSync(logPath).mtimeMs
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].recordType, "health");
  assert.deepEqual(records[0].subject, {});
  assert.doesNotMatch(JSON.stringify(records), /unrelated private diagnostic/);
  assert.doesNotMatch(JSON.stringify(records), /broken/);
});

test("typed telemetry requires exact identifiers, timestamp, country, game date, units and freshness", () => {
  const now = () => Date.parse("2026-07-26T17:01:00.000Z");
  const payload = basePayload({
    metrics: {
      treasury: { value: 122.5, unit: "ducats" },
      monthlyIncome: { value: null, unit: "ducats_per_month" },
      bankrupt: { value: false, unit: "boolean" }
    }
  });
  const accepted = parseEu5ControlLine(
    wrapped(typed("economy_snapshot", payload)),
    { now }
  );
  assert.equal(accepted.recordType, "economy_snapshot");
  assert.equal(accepted.payload.metrics.monthlyIncome.value, null);
  assert.equal(accepted.payload.metrics.bankrupt.value, false);

  for (const missing of ["eventId", "captureSessionId", "campaignId", "occurredAtUtc"]) {
    const candidate = typed("economy_snapshot", payload);
    delete candidate[missing];
    assert.equal(parseEu5ControlLine(wrapped(candidate), { now }), null, missing);
  }
  assert.equal(
    parseEu5ControlLine(
      wrapped(typed("economy_snapshot", {
        ...payload,
        metrics: { treasury: { value: 10, unit: "percent" } }
      })),
      { now }
    ),
    null
  );
  assert.equal(
    parseEu5ControlLine(
      wrapped(typed("economy_snapshot", { ...payload, gameDate: "1337-02-29" })),
      { now }
    ),
    null
  );
  assert.equal(
    parseEu5ControlLine(
      wrapped(typed("economy_snapshot", {
        ...payload,
        capturedAtUtc: "2026-07-26T16:00:00.000Z"
      }, { occurredAtUtc: "2026-07-26T16:00:00.000Z" })),
      { now }
    ),
    null
  );
  assert.equal(
    parseEu5ControlLine(
      wrapped(typed("economy_snapshot", payload, {
        occurredAtUtc: "2026-07-26T17:00:01.000Z"
      })),
      { now }
    ),
    null
  );
});

test("typed domain collections are bounded, allowlisted and preserve explicit unknown values", () => {
  const nowMs = Date.parse("2026-07-26T17:01:00.000Z");
  const markets = validateTypedPayload("markets_snapshot", basePayload({
    metrics: {
      foodBalance: { value: null, unit: "units_per_month" }
    },
    market: { id: "market-holland", name: "Holland Market" },
    goods: [{
      id: "grain",
      name: "Grain",
      price: { value: 2.5, unit: "ducats_per_unit" },
      balance: { value: null, unit: "units_per_month" }
    }]
  }), { nowMs });
  assert.equal(markets.metrics.foodBalance.value, null);
  assert.equal(markets.goods[0].balance.value, null);

  assert.throws(() => validateTypedPayload("markets_snapshot", basePayload({
    metrics: {},
    goods: Array.from({ length: 101 }, (_, index) => ({
      id: `good-${index}`,
      name: `Good ${index}`
    }))
  }), { nowMs }), /at most 100/);
  assert.throws(() => validateTypedPayload("diplomacy_snapshot", basePayload({
    metrics: {},
    relations: [{
      country: { tag: "FRA", name: "France" },
      atWar: false,
      leakedPath: "C:\\private\\save.eu5"
    }]
  }), { nowMs }), /not allowed/);
  assert.throws(() => validateTypedPayload("military_snapshot", basePayload({
    metrics: { navySize: { value: "many", unit: "ships" } }
  }), { nowMs }), /finite or null/);
});

test("typed log records remain unverified without matching external evidence", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-typed-log-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logPath = path.join(root, "debug.log");
  const capturedAtUtc = "2026-07-26T17:00:00.000Z";
  fs.writeFileSync(
    logPath,
    wrapped(typed("player_summary", basePayload({
      capturedAtUtc,
      metrics: {
        population: { value: 120000, unit: "persons" },
        literacy: { value: null, unit: "percent" }
      }
    })))
  );
  const records = structuredLogRecords({
    logPath,
    now: () => Date.parse("2026-07-26T17:01:00.000Z")
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].recordType, "nation_snapshot");
  assert.equal(records[0].subject.countryTag, "HOL");
  assert.equal(records[0].payload.domain, "player");
  assert.equal(records[0].provenance.verification.status, "unverified");
  assert.equal(records[0].provenance.freshness, "fresh");
  assert.doesNotMatch(JSON.stringify(records), /debug\.log|eu5-typed-log|jomini/i);
});

test("typed telemetry is verified only by exact reviewed manifest and session evidence", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-trusted-log-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logPath = path.join(root, "debug.log");
  const capturedAtUtc = "2026-07-26T17:00:00.000Z";
  fs.writeFileSync(
    logPath,
    wrapped(typed("player_summary", basePayload({ capturedAtUtc })))
  );
  const options = {
    logPath,
    now: () => Date.parse("2026-07-26T17:01:00.000Z")
  };
  const previousSecret = process.env.EU5_TELEMETRY_EVIDENCE_SECRET;
  process.env.EU5_TELEMETRY_EVIDENCE_SECRET = EVIDENCE_SECRET;
  t.after(() => {
    if (previousSecret === undefined) {
      delete process.env.EU5_TELEMETRY_EVIDENCE_SECRET;
    } else {
      process.env.EU5_TELEMETRY_EVIDENCE_SECRET = previousSecret;
    }
  });
  const verified = structuredLogRecords({
    ...options,
    trustedTelemetryContext: trustedContext()
  });
  assert.equal(verified[0].provenance.verification.status, "verified");
  for (const mismatch of [
    { captureSessionId: "capture-other" },
    { campaignId: "other-campaign" },
    { modVersion: "0.3.1" },
    { manifestSha256: "A".repeat(64) }
  ]) {
    const downgraded = structuredLogRecords({
      ...options,
      trustedTelemetryContext: trustedContext(mismatch)
    });
    assert.equal(
      downgraded[0].provenance.verification.status,
      "unverified"
    );
  }
  const forged = structuredLogRecords({
    ...options,
    trustedTelemetryContext: {
      ...trustedContext(),
      signature: "b".repeat(64)
    }
  });
  assert.equal(forged[0].provenance.verification.status, "unverified");
  const unreviewed = typed("player_summary", basePayload({ capturedAtUtc }), {
    modVersion: "0.3.1"
  });
  assert.equal(
    parseEu5ControlLine(wrapped(unreviewed), { now: options.now }),
    null
  );
});

test("current state selects newest coherent fresh verified snapshots only", () => {
  const record = (domain, capturedAtUtc, campaignId = "holland-test", countryTag = "HOL") => ({
    recordId: `${domain}-${capturedAtUtc}`,
    recordType: "nation_snapshot",
    occurredAtUtc: capturedAtUtc,
    recordedAtUtc: capturedAtUtc,
    sequence: 0,
    subject: {
      campaignId,
      countryId: "country-42",
      countryTag,
      countryName: countryTag === "HOL" ? "Holland" : "France"
    },
    provenance: {
      adapter: { id: "eu5-control-bridge", version: "1" },
      verification: { status: "verified" },
      freshness: "fresh"
    },
    payload: {
      domain,
      capturedAtUtc,
      gameDate: "1337-04-14",
      paused: true,
      metrics: { treasury: { value: 1, unit: "ducats" } }
    }
  });
  const state = latestVerifiedState([
    record("economy", "2026-07-26T17:00:00.000Z"),
    record("player", "2026-07-26T17:00:01.000Z"),
    record("military", "2026-07-26T17:00:02.000Z", "other-campaign", "FRA"),
    {
      ...record("diplomacy", "2026-07-26T17:00:03.000Z"),
      provenance: { verification: { status: "unverified" }, freshness: "fresh" }
    }
  ]);
  assert.equal(state.country.tag, "FRA");
  assert.deepEqual(Object.keys(state.domains), ["military"]);
  assert.equal(state.status, "partial");
  assert.match(state.warnings.join(" "), /Missing economy telemetry/);
});

test("live feed publishes a human-friendly currentState without raw log content", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-feed-typed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logPath = path.join(root, "debug.log");
  const capturedAtUtc = "2026-07-26T17:00:00.000Z";
  fs.writeFileSync(logPath, [
    "private unrelated message C:\\Users\\someone\\save.eu5",
    wrapped(typed("economy_snapshot", basePayload({
      capturedAtUtc,
      metrics: {
        monthlyBalance: { value: 4.5, unit: "ducats_per_month" }
      }
    })))
  ].join("\n"));
  const previousSecret = process.env.EU5_TELEMETRY_EVIDENCE_SECRET;
  process.env.EU5_TELEMETRY_EVIDENCE_SECRET = EVIDENCE_SECRET;
  t.after(() => {
    if (previousSecret === undefined) {
      delete process.env.EU5_TELEMETRY_EVIDENCE_SECRET;
    } else {
      process.env.EU5_TELEMETRY_EVIDENCE_SECRET = previousSecret;
    }
  });
  const feed = buildLiveFeed({
    now: () => Date.parse("2026-07-26T17:01:00.000Z"),
    logPath,
    saveDirectory: "Z:\\missing\\saves",
    ledgerReader: () => [],
    trustedTelemetryContext: trustedContext()
  });
  assert.equal(feed.currentState.status, "partial");
  assert.equal(feed.currentState.country.tag, "HOL");
  assert.equal(
    feed.currentState.domains.economy.metrics.monthlyBalance.value,
    4.5
  );
  assert.doesNotMatch(JSON.stringify(feed), /someone|debug\.log|Z:\\\\/i);
});

test("every mod producer literal and branch satisfies the strict consumer contract", () => {
  const sourcePath = path.join(
    __dirname,
    "..",
    "mod",
    "eu5-control-debug",
    "in_game",
    "common",
    "scripted_guis",
    "eu5_control_debug.txt"
  );
  const source = fs.readFileSync(sourcePath, "utf8");
  const literals = [...source.matchAll(/debug_log\s*=\s*"((?:\\.|[^"])*)"/g)]
    .map((match) => JSON.parse(`"${match[1]}"`))
    .filter((value) => value.startsWith("EU5_CONTROL "));
  const parsed = literals.map((literal, index) =>
    parseEu5ControlLine(
      `[17:00:${16 + index}][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:${15 + index}: ${literal}`
    )
  );
  assert.ok(literals.length >= 3, "mod must expose structured control records");
  assert.equal(
    parsed.filter(Boolean).length,
    literals.length,
    "every EU5_CONTROL producer literal must satisfy the consumer"
  );
  const procedures = new Set(parsed.map((record) => record.procedure));
  assert.deepEqual([...procedures].sort(), [
    "emit_diplomacy_snapshot",
    "emit_economy_snapshot",
    "emit_markets_snapshot",
    "emit_military_snapshot",
    "emit_ping",
    "emit_player_scope",
    "emit_player_summary",
    "emit_state_snapshot"
  ]);
  assert.equal(
    parsed.filter((record) => record.recordType === "telemetry_fact").length,
    32
  );
});

test("strict partial telemetry keeps supported facts and explicit unavailable fields separate", () => {
  const partialRecords = [
    {
      schemaVersion: CONTROL_LOG_SCHEMA,
      recordType: "economy_snapshot",
      procedure: "emit_economy_snapshot",
      section: "economy",
      modVersion: "0.3.0",
      status: "acknowledged",
      completeness: "partial",
      observationJoinRequired: true
    },
    {
      schemaVersion: CONTROL_LOG_SCHEMA,
      recordType: "telemetry_fact",
      procedure: "emit_economy_snapshot",
      section: "economy",
      field: "monthlyBalanceClass",
      value: "negative",
      availability: "available",
      modVersion: "0.3.0",
      status: "observed"
    },
    {
      schemaVersion: CONTROL_LOG_SCHEMA,
      recordType: "telemetry_fact",
      procedure: "emit_economy_snapshot",
      section: "economy",
      field: "monthlyBalance",
      value: null,
      unit: "gold_per_month",
      availability: "unavailable",
      reason: "no_json_safe_scalar_serializer",
      modVersion: "0.3.0",
      status: "observed"
    }
  ];
  const parsed = partialRecords.map((record, index) =>
    parseEu5ControlLine(wrapped(record, 100 + index))
  );
  assert.equal(parsed.filter(Boolean).length, 3);

  const malformed = {
    ...partialRecords[1],
    value: "positive"
  };
  assert.equal(parseEu5ControlLine(wrapped(malformed, 110)), null);
  assert.equal(
    parseEu5ControlLine(wrapped({ ...partialRecords[2], reason: "C:\\private" }, 111)),
    null
  );
  assert.equal(
    parseEu5ControlLine(wrapped({ ...partialRecords[0], arbitrary: true }, 112)),
    null
  );
});

test("partial observation summary uses only facts after the latest fresh domain header", () => {
  const partialRecord = (
    sequence,
    event,
    field,
    value,
    freshness = "fresh",
    correlationId = "capture-1"
  ) => ({
    recordId: `partial-${sequence}`,
    recordType: "game_event",
    recordedAtUtc: `2026-07-26T17:00:0${sequence}.000Z`,
    sequence,
    correlationId,
    provenance: { freshness },
    payload: {
      event,
      domain: "economy",
      ...(field === undefined
        ? { completeness: "partial" }
        : { field, value, availability: "available" })
    }
  });
  const current = latestPartialObservations([
    partialRecord(0, "partial_export"),
    partialRecord(1, "partial_fact", "treasuryClass", "negative"),
    partialRecord(2, "partial_export", undefined, undefined, "fresh", "capture-2"),
    partialRecord(3, "partial_fact", "monthlyBalanceClass", "non_negative", "fresh", "capture-2"),
    partialRecord(4, "partial_fact", "ignoredStale", true, "stale", "capture-2")
  ]);
  assert.equal(current.status, "partial");
  assert.deepEqual(Object.keys(current.domains.economy.fields), [
    "monthlyBalanceClass"
  ]);
  assert.equal(
    current.domains.economy.fields.monthlyBalanceClass.value,
    "non_negative"
  );
});

test("repeated partial exports preserve line order and keep facts in their capture group", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-grouped-log-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logPath = path.join(root, "debug.log");
  const header = {
    schemaVersion: CONTROL_LOG_SCHEMA,
    recordType: "economy_snapshot",
    procedure: "emit_economy_snapshot",
    section: "economy",
    modVersion: "0.3.0",
    status: "acknowledged",
    completeness: "partial",
    observationJoinRequired: true
  };
  const fact = (value) => ({
    schemaVersion: CONTROL_LOG_SCHEMA,
    recordType: "telemetry_fact",
    procedure: "emit_economy_snapshot",
    section: "economy",
    field: "monthlyBalanceClass",
    value,
    availability: "available",
    modVersion: "0.3.0",
    status: "observed"
  });
  fs.writeFileSync(logPath, [
    wrapped(header, 200),
    wrapped(fact("negative"), 201),
    wrapped(header, 202),
    wrapped(fact("non_negative"), 203)
  ].join("\n"));
  const now = () => fs.statSync(logPath).mtimeMs;
  const records = structuredLogRecords({ logPath, now });
  assert.deepEqual(
    records.map((record) =>
      record.payload.event === "partial_export"
        ? "header"
        : record.payload.value
    ),
    ["header", "negative", "header", "non_negative"]
  );
  assert.equal(records[0].correlationId, records[1].correlationId);
  assert.equal(records[2].correlationId, records[3].correlationId);
  assert.notEqual(records[0].correlationId, records[2].correlationId);

  const feed = buildLiveFeed({
    logPath,
    now,
    ledgerReader: () => [],
    saveDirectory: "Z:\\missing\\saves"
  });
  assert.equal(
    feed.currentObservations.domains.economy.fields.monthlyBalanceClass.value,
    "non_negative"
  );
  const bridgeRecords = feed.records.filter((record) =>
    record.provenance.adapter.id === "eu5-control-bridge"
  );
  assert.deepEqual(
    bridgeRecords.map((record) =>
      record.payload.event === "partial_export"
        ? "header"
        : record.payload.value
    ),
    ["header", "negative", "header", "non_negative"]
  );
  assert.doesNotMatch(JSON.stringify(feed), /undefined/);
});

test("ledger mapper is allowlist-only and drops evidence paths and secrets", () => {
  const records = mapLedgerEvents([{
    type: "declared",
    declarationId: "decl-1",
    idempotencyKey: "private-key",
    campaign: "test-campaign",
    version: "1",
    action: {
      id: "open-economy",
      risk: "read_only",
      expectedVisibleResult: "Economy opens",
      hiddenPassword: "must-not-leak"
    },
    evidence: { reference: "C:\\private\\capture.png" },
    recordedAtUtc: "2026-07-26T10:00:00.000Z"
  }, {
    type: "outcome",
    outcomeId: "outcome-1",
    dispatchId: "dispatch-1",
    actualVisibleResult:
      "Panel opened; Authorization: Bearer local-secret-value",
    observedAtUtc: "2026-07-26T10:00:01.000Z",
    recordedAtUtc: "2026-07-26T10:00:01.000Z"
  }], { now: () => Date.parse("2026-07-26T10:00:30.000Z") });
  assert.equal(records.length, 2);
  assert.equal(records[0].recordType, "llm_action_proposed");
  assert.equal(records[0].provenance.verification.status, "unverified");
  const serialized = JSON.stringify(records);
  assert.doesNotMatch(
    serialized,
    /private-key|hiddenPassword|capture\.png|local-secret-value|Authorization/i
  );
  assert.match(serialized, /\[redacted unsafe text\]/);
});

test("live feed fails closed per source and exposes only sanitized health", () => {
  const feed = buildLiveFeed({
    now: () => Date.parse("2026-07-26T10:00:00.000Z"),
    logPath: "Z:\\missing\\debug.log",
    saveDirectory: "Z:\\missing\\saves",
    ledgerReader: () => {
      throw new Error("C:\\private\\control-ledger.jsonl malformed");
    }
  });
  assert.equal(feed.schemaVersion, "eu5.monitoring-feed/v1");
  assert.equal(feed.sourceMode, "local-live");
  assert.equal(feed.records.filter((record) => record.recordType === "health").length, 3);
  assert.doesNotMatch(JSON.stringify(feed), /private|control-ledger|Z:\\\\/i);
});
