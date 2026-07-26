"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  CONTROL_LOG_SCHEMA,
  buildLiveFeed,
  mapLedgerEvents,
  parseEu5ControlLine,
  structuredLogRecords
} = require("../src/monitoring/live-feed");

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

test("all three mod producer literals satisfy the strict consumer contract", () => {
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
  assert.equal(literals.length, 3);

  const parsed = literals.map((literal, index) =>
    parseEu5ControlLine(
      `[17:00:${16 + index}][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:${15 + index}: ${literal}`
    )
  );
  assert.deepEqual(
    parsed.map((record) => [record.recordType, record.procedure, record.modVersion]),
    [
      ["bridge_health", "emit_ping", "0.2.3"],
      ["player_scope", "emit_player_scope", "0.2.3"],
      ["state_snapshot", "emit_state_snapshot", "0.2.3"]
    ]
  );
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
