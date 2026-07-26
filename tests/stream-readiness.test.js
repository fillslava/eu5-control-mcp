"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ControlLedger } = require("../src/control/control-ledger");
const {
  ACTION_BINDING_SCHEMA,
  ControlProtocol,
  PRE_OBSERVATION_SCHEMA,
  SESSION_SCHEMA,
  approvalPayload,
  verificationPayload
} = require("../src/control/control-protocol");
const { catalogueAction } = require("../src/control/action-gate");
const {
  buildLiveFeed,
  mapLedgerEvents
} = require("../src/monitoring/live-feed");
const {
  COLLECTOR_LIMITS,
  StreamRehearsalCollector,
  recordDigest
} = require("../src/stream/rehearsal-collector");
const {
  CAPTURE_SCHEMA,
  readFeedSnapshots,
  parseArguments: parseCollectorArguments,
  writeBundle
} = require("../src/stream/collect-rehearsal");
const {
  EXPECTATIONS_SCHEMA,
  computeLedgerRecordHash,
  computeMonitoringManifestHash,
  evaluateStreamReadiness,
  formatStreamReadinessMarkdown,
  verifyLedgerHashChain
} = require("../src/stream/rehearsal-acceptance");
const {
  MAXIMUM_INPUT_BYTES: MAXIMUM_VERIFIER_INPUT_BYTES,
  parseArguments,
  readJson,
  readLedger,
  writeReport
} = require("../src/stream/verify-rehearsal");

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const START = Date.parse("2026-07-26T10:00:00.000Z");
const END = START + 30 * 60 * 1000;
const ACTION_COUNT = 103;
const APPROVAL_SECRET = "stream-approval-secret";
const VERIFIER_SECRET = "stream-verifier-secret";
const NAVIGATION_PROCEDURES = Object.freeze([
  "open_control_panel",
  "open_capital",
  "economy",
  "markets",
  "diplomacy",
  "military",
  "alerts"
]);
const STREAM_SESSION = Object.freeze({
  schemaVersion: SESSION_SCHEMA,
  rehearsalId: "stream-rehearsal-1",
  campaignId: "holland-stream-test",
  countryId: "HOL",
  gameBuild: "1.0.2",
  modVersion: "0.3.0",
  modManifestSha256: HASH_A,
  seedSaveSha256: HASH_B
});

function timestamp(offsetMs) {
  return new Date(START + offsetMs).toISOString();
}

function record(recordType, sequence, offsetMs, payload, options = {}) {
  return {
    recordId: `record-${sequence}`,
    recordType,
    occurredAtUtc: timestamp(offsetMs),
    recordedAtUtc: timestamp(offsetMs + (options.ingestMs ?? 100)),
    sequence,
    captureSessionId: "stream-rehearsal-1",
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    subject: {
      campaignId: "holland-stream-test",
      countryId: "HOL"
    },
    provenance: {
      adapter: { id: "stream-test", version: "1" },
      verification: {
        status: options.status || "verified",
        evidence: "Synthetic acceptance fixture."
      },
      freshness: options.freshness || "fresh",
      rawArtifactSha256: HASH_A
    },
    payload
  };
}

function expectations(overrides = {}) {
  return {
    schemaVersion: EXPECTATIONS_SCHEMA,
    fingerprint: {
      campaignId: "holland-stream-test",
      countryId: "HOL",
      gameBuild: "1.0.2",
      modVersion: "0.3.0",
      modManifestSha256: HASH_A,
      seedSaveSha256: HASH_B
    },
    ...overrides
  };
}

function appendLedger(ledger, body) {
  const record = {
    ...body,
    sequence: ledger.length,
    previousHash: ledger.length ? ledger.at(-1).recordHash : null
  };
  record.recordHash = computeLedgerRecordHash(record);
  ledger.push(record);
}

function completeLedger(actionCount = 2) {
  const ledger = [];
  for (let action = 0; action < actionCount; action += 1) {
    const declarationId = `declaration-${action}`;
    const gameplayCapabilities = [
      "economy_decision",
      "diplomacy_decision",
      "recruitment_inspection"
    ];
    const capability = action >= 100 ? gameplayCapabilities[action - 100] : null;
    const actionId = capability || `navigation-${action}`;
    const actionFamily = capability
      ? ["economy", "diplomacy", "military"][action - 100]
      : "navigation";
    const procedure = capability || NAVIGATION_PROCEDURES[action % NAVIGATION_PROCEDURES.length];
    for (const lifecycleState of [
      "declared",
      "gated",
      "confirmed",
      "authorized",
      "dispatched",
      "acknowledged",
      "verified"
    ]) {
      appendLedger(ledger, {
        declarationId,
        rehearsalId: "stream-rehearsal-1",
        campaignId: "holland-stream-test",
        countryId: "HOL",
        ...(lifecycleState === "declared"
          ? { actionId, actionFamily, procedure, capability }
          : {}),
        lifecycleState,
        verified: lifecycleState === "verified",
        recordedAtUtc: timestamp(action * 1000)
      });
    }
  }
  return ledger;
}

function resealLedger(ledger) {
  let previousHash = null;
  ledger.forEach((item, index) => {
    item.sequence = index;
    item.previousHash = previousHash;
    item.recordHash = computeLedgerRecordHash(item);
    previousHash = item.recordHash;
  });
  return ledger;
}

function shiftLedgerTo(ledger, startAtMs) {
  const deltaMs = startAtMs - START;
  ledger.forEach((item) => {
    item.recordedAtUtc = new Date(Date.parse(item.recordedAtUtc) + deltaMs).toISOString();
  });
  return resealLedger(ledger);
}

function passingBundle() {
  const records = [];
  let sequence = 0;
  for (const component of ["test-session", "mod-bridge", "monitoring-feed", "control-ledger"]) {
    records.push(record("health", sequence++, END - START - 500, {
      component,
      status: "available",
      ...(component === "test-session" ? { fingerprint: expectations().fingerprint } : {})
    }));
  }
  for (const domain of ["nation", "economy", "markets", "diplomacy", "military"]) {
    records.push(record("nation_snapshot", sequence++, END - START - 1_000, {
      domain,
      gameDate: "1337-05-12",
      paused: true
    }));
  }
  const advanceEvidence = [
    { offsetMs: 4 * 60 * 1000, gameDate: "1337-05-01" },
    { offsetMs: 5 * 60 * 1000, gameDate: "1337-05-02" },
    { offsetMs: 10 * 60 * 1000, gameDate: "1337-05-03" },
    { offsetMs: 15 * 60 * 1000, gameDate: "1337-05-04" }
  ].map(({ offsetMs, gameDate }) => {
    const snapshot = record("nation_snapshot", sequence++, offsetMs, {
      domain: "nation",
      gameDate,
      paused: true
    });
    records.push(snapshot);
    return snapshot;
  });
  for (let index = 0; index < 3; index += 1) {
    records.push(record("game_event", sequence++, 5 * 60 * 1000 + index * 5 * 60 * 1000, {
      eventType: "bounded_time_advance",
      bounded: true,
      beforePaused: true,
      afterPaused: true,
      beforeGameDate: `1337-05-0${index + 1}`,
      afterGameDate: `1337-05-0${index + 2}`,
      overshootDays: index === 2 ? 1 : 0,
      beforeEvidenceSha256: recordDigest(advanceEvidence[index]),
      afterEvidenceSha256: recordDigest(advanceEvidence[index + 1])
    }));
  }
  for (let index = 0; index < 100; index += 1) {
    const correlationId = `declaration-${index}`;
    records.push(record("llm_action_proposed", sequence++, 20 * 60 * 1000 + index * 5_000 - 100, {
      actionFamily: "navigation",
      procedure: NAVIGATION_PROCEDURES[index % NAVIGATION_PROCEDURES.length],
      actionId: `navigation-${index}`
    }, { correlationId }));
    records.push(record("llm_action_outcome", sequence++, 20 * 60 * 1000 + index * 5_000, {
      actionFamily: "navigation",
      procedure: NAVIGATION_PROCEDURES[index % NAVIGATION_PROCEDURES.length],
      outcome: "success",
      actionId: `navigation-${index}`,
      latencyMs: 250 + index
    }, { correlationId }));
  }
  for (const [offset, capability, actionFamily] of [
    [0, "economy_decision", "economy"],
    [1, "diplomacy_decision", "diplomacy"],
    [2, "recruitment_inspection", "military"]
  ]) {
    const correlationId = `declaration-${100 + offset}`;
    records.push(record("llm_action_proposed", sequence++, 29 * 60 * 1000 + offset * 1_000, {
      actionFamily,
      capability,
      procedure: capability,
      actionId: capability
    }, { correlationId }));
    records.push(record("llm_action_outcome", sequence++, 29 * 60 * 1000 + offset * 1_000 + 500, {
      actionFamily,
      capability,
      procedure: capability,
      outcome: "success",
      actionId: capability,
      latencyMs: 500
    }, { correlationId }));
  }
  records.push(record("game_event", sequence++, 0, {
    eventType: "rehearsal_started",
    rehearsalId: "stream-rehearsal-1"
  }));
  records.push(record("game_event", sequence++, END - START, {
    eventType: "rehearsal_completed",
    rehearsalId: "stream-rehearsal-1"
  }));
  const bundle = {
    schemaVersion: "eu5.monitoring-bundle/v1",
    bundleId: "stream-rehearsal-1",
    generatedAtUtc: new Date(END + 1_000).toISOString(),
    sourceMode: "offline-import",
    records,
    integrity: {}
  };
  bundle.integrity.manifestSha256 = computeMonitoringManifestHash(bundle);
  return bundle;
}

function resealBundle(bundle) {
  bundle.records.forEach((item, index) => {
    item.sequence = index;
  });
  bundle.integrity.manifestSha256 = computeMonitoringManifestHash(bundle);
  return bundle;
}

function shiftBundleTo(bundle, generatedAtMs) {
  const deltaMs = generatedAtMs - Date.parse(bundle.generatedAtUtc);
  const originalEvidence = new Map(
    bundle.records
      .filter((item) =>
        item.recordType === "nation_snapshot" &&
        item.payload.domain === "nation"
      )
      .map((item) => [item.recordId, recordDigest(item)])
  );
  for (const item of bundle.records) {
    item.occurredAtUtc = new Date(Date.parse(item.occurredAtUtc) + deltaMs).toISOString();
    item.recordedAtUtc = new Date(Date.parse(item.recordedAtUtc) + deltaMs).toISOString();
  }
  const shiftedEvidence = new Map();
  for (const item of bundle.records) {
    if (originalEvidence.has(item.recordId)) {
      shiftedEvidence.set(originalEvidence.get(item.recordId), recordDigest(item));
    }
  }
  for (const item of bundle.records) {
    if (item.payload.eventType === "bounded_time_advance") {
      item.payload.beforeEvidenceSha256 =
        shiftedEvidence.get(item.payload.beforeEvidenceSha256) ||
        item.payload.beforeEvidenceSha256;
      item.payload.afterEvidenceSha256 =
        shiftedEvidence.get(item.payload.afterEvidenceSha256) ||
        item.payload.afterEvidenceSha256;
    }
  }
  bundle.generatedAtUtc = new Date(generatedAtMs).toISOString();
  return resealBundle(bundle);
}

function protocolLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-stream-protocol-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const now = END - 2_000;
  const protocol = new ControlProtocol({
    ledger: new ControlLedger({ dataDirectory: directory }),
    now: () => now,
    approvalSecret: APPROVAL_SECRET,
    verifierSecret: VERIFIER_SECRET,
    sessionContext: STREAM_SESSION
  });
  const actions = ["economy", "markets", "diplomacy", "military"];
  const declarations = [];
  for (const [index, procedure] of actions.entries()) {
    const declaration = runProtocolAction(protocol, { procedure }, index, now);
    declarations.push({
      ...catalogueAction(procedure),
      declarationId: declaration.declarationId
    });
  }
  return { declarations, ledger: protocol.events() };
}

function bundleForProtocolLedger(ledger) {
  const bundle = passingBundle();
  bundle.records = bundle.records.filter((item) =>
    item.recordType !== "llm_action_proposed" &&
    item.recordType !== "llm_action_outcome"
  );
  const mapped = mapLedgerEvents(ledger, { now: () => END + 1_000 });
  for (const item of mapped) {
    bundle.records.push({
      ...item,
      sequence: bundle.records.length
    });
  }
  return resealBundle(bundle);
}

function actualModLogLiterals() {
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
  const parsed = [...source.matchAll(/\bdebug_log\s*=\s*"((?:\\.|[^"])*)"/g)]
    .map((match) => JSON.parse(`"${match[1]}"`))
    .filter((line) => line.startsWith("EU5_CONTROL "))
    .map((line) => ({ line, record: JSON.parse(line.slice("EU5_CONTROL ".length)) }));
  const selected = [];
  const availableFields = new Set();
  for (const candidate of parsed) {
    if (candidate.record.recordType !== "telemetry_fact") {
      if ([
        "player_summary",
        "economy_snapshot",
        "markets_snapshot",
        "diplomacy_snapshot",
        "military_snapshot"
      ].includes(candidate.record.recordType)) {
        selected.push(candidate.line);
      }
      continue;
    }
    if (candidate.record.availability === "unavailable") {
      selected.push(candidate.line);
      continue;
    }
    const fieldKey = `${candidate.record.section}:${candidate.record.field}`;
    if (!availableFields.has(fieldKey)) {
      availableFields.add(fieldKey);
      selected.push(candidate.line);
    }
  }
  return selected;
}

function writeActualModLog(logPath, capturedAtMs) {
  const capturedAt = new Date(capturedAtMs);
  const clock = [
    capturedAt.getUTCHours(),
    capturedAt.getUTCMinutes(),
    capturedAt.getUTCSeconds()
  ].map((part) => String(part).padStart(2, "0")).join(":");
  const contents = actualModLogLiterals().map((line, index) =>
    `[${clock}][jomini_effect_impl.cpp:479]: common/scripted_guis/eu5_control_debug.txt:${20 + index}: ${line}`
  ).join("\n");
  fs.writeFileSync(logPath, contents, "utf8");
  const modified = new Date(capturedAtMs);
  fs.utimesSync(logPath, modified, modified);
}

function signApproval(declaration, nowMs) {
  const approval = {
    approvalId: crypto.randomUUID(),
    declarationId: declaration.declarationId,
    actionDigest: declaration.actionDigest,
    catalogId: declaration.catalogId,
    catalogEntryDigest: declaration.catalogEntryDigest,
    preObservationId: declaration.preObservation.id,
    preObservationSha256: declaration.preObservation.evidenceSha256,
    rehearsalId: STREAM_SESSION.rehearsalId,
    countryId: STREAM_SESSION.countryId,
    sessionFingerprintSha256: declaration.sessionFingerprintSha256,
    gameBuild: STREAM_SESSION.gameBuild,
    modVersion: STREAM_SESSION.modVersion,
    modManifestSha256: STREAM_SESSION.modManifestSha256,
    seedSaveSha256: STREAM_SESSION.seedSaveSha256,
    campaign: "holland-stream-test",
    version: ACTION_BINDING_SCHEMA,
    expiresAtUtc: new Date(nowMs + 30_000).toISOString()
  };
  approval.signature = crypto.createHmac("sha256", APPROVAL_SECRET)
    .update(approvalPayload(approval))
    .digest("hex");
  return approval;
}

function signVerification(outcome, declaration, nowMs, evidenceSha256) {
  const verification = {
    verificationId: crypto.randomUUID(),
    outcomeId: outcome.outcomeId,
    declarationId: declaration.declarationId,
    evidenceSha256,
    outcomeObservedAtUtc: outcome.observedAtUtc,
    outcomeRecordHash: outcome.recordHash,
    result: "verified",
    verifiedAtUtc: new Date(nowMs).toISOString()
  };
  verification.signature = crypto.createHmac("sha256", VERIFIER_SECRET)
    .update(verificationPayload(verification))
    .digest("hex");
  return verification;
}

function runProtocolAction(protocol, definition, index, nowMs) {
  const action = catalogueAction(definition.procedure);
  const preObservation = {
    schemaVersion: PRE_OBSERVATION_SCHEMA,
    id: `pre-observation-${index}`,
    capturedAtUtc: new Date(nowMs).toISOString(),
    evidenceSha256: crypto.createHash("sha256")
      .update(`pre-observation:${definition.procedure}:${index}`)
      .digest("hex"),
    rehearsalId: STREAM_SESSION.rehearsalId,
    campaignId: STREAM_SESSION.campaignId,
    countryId: STREAM_SESSION.countryId,
    gameBuild: STREAM_SESSION.gameBuild,
    modVersion: STREAM_SESSION.modVersion,
    modManifestSha256: STREAM_SESSION.modManifestSha256,
    seedSaveSha256: STREAM_SESSION.seedSaveSha256
  };
  const declaration = protocol.declare({
    action,
    idempotencyKey: `production-rehearsal-${index}`,
    campaign: "holland-stream-test",
    version: ACTION_BINDING_SCHEMA,
    preObservation
  });
  const authorization = protocol.authorize({
    declarationId: declaration.declarationId,
    approval: signApproval(declaration, nowMs)
  });
  const dispatch = protocol.dispatch({ authorizationId: authorization.authorizationId });
  const evidenceSha256 = crypto.createHash("sha256")
    .update(`${action.id}:${index}`)
    .digest("hex");
  const outcome = protocol.outcome({
    dispatchId: dispatch.dispatchId,
    acknowledged: true,
    evidenceConclusive: true,
    actualVisibleResult: action.expectedVisibleResult,
    observedAtUtc: new Date(nowMs).toISOString(),
    evidence: {
      reference: `rehearsal:${action.id}:${index}`,
      sha256: evidenceSha256
    }
  });
  const verification = signVerification(
    protocol.events().find(
      (event) => event.type === "outcome" && event.outcomeId === outcome.outcomeId
    ),
    declaration,
    nowMs,
    evidenceSha256
  );
  assert.equal(
    protocol.verify({ outcomeId: outcome.outcomeId, verification }).state,
    "verified"
  );
  return declaration;
}

function productionRehearsal(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-production-rehearsal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logPath = path.join(root, "debug.log");
  const ledger = new ControlLedger({ dataDirectory: path.join(root, "ledger") });
  let nowMs = START;
  const protocol = new ControlProtocol({
    ledger,
    now: () => nowMs,
    approvalSecret: APPROVAL_SECRET,
    verifierSecret: VERIFIER_SECRET,
    sessionContext: STREAM_SESSION
  });
  const collector = new StreamRehearsalCollector({
    rehearsalId: "stream-rehearsal-1",
    fingerprint: expectations().fingerprint,
    fingerprintEvidenceSha256: HASH_A,
    startedAtUtc: timestamp(0)
  });
  const capture = (capturedAtMs) => {
    writeActualModLog(logPath, capturedAtMs - 200);
    nowMs = capturedAtMs;
    const feed = buildLiveFeed({
      now: () => nowMs,
      logPath,
      ledgerReader: () => protocol.events(),
      saveDirectory: path.join(root, "missing-saves")
    });
    collector.ingest(feed);
    return feed;
  };

  capture(START + 60_000);

  const definitions = [];
  for (let index = 0; index < 100; index += 1) {
    definitions.push({
      procedure: NAVIGATION_PROCEDURES[index % NAVIGATION_PROCEDURES.length]
    });
  }
  definitions.push(
    { procedure: "economy" },
    { procedure: "diplomacy" },
    { procedure: "military" }
  );
  const actionStart = START + 16 * 60_000;
  const actionSpacingMs = 7_500;
  for (const [index, definition] of definitions.entries()) {
    nowMs = actionStart + index * actionSpacingMs;
    runProtocolAction(protocol, definition, index, nowMs);
    const feed = buildLiveFeed({
      now: () => nowMs,
      logPath,
      ledgerReader: () => protocol.events(),
      saveDirectory: path.join(root, "missing-saves")
    });
    collector.ingest(feed);
  }

  const finalFeed = capture(END - 2_000);
  return {
    bundle: collector.complete(new Date(END).toISOString()),
    ledger: protocol.events(),
    finalFeed
  };
}

test("a complete 30-minute artifact rehearsal passes every stream gate", () => {
  const report = evaluateStreamReadiness({
    bundle: passingBundle(),
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  assert.equal(report.verdict, "stream_ready");
  assert.deepEqual(report.blockers, []);
  assert.ok(report.criteria.every((item) => item.status === "pass"));
  assert.deepEqual(report.safety, {
    inputSent: false,
    saveEdited: false,
    consoleInvoked: false,
    automaticRetryPerformed: false
  });
  assert.match(formatStreamReadinessMarkdown(report), /STREAM READY/);
});

test("real ControlProtocol lifecycle records satisfy the stream acceptance contract", (t) => {
  const produced = protocolLedger(t);
  const report = evaluateStreamReadiness({
    bundle: bundleForProtocolLedger(produced.ledger),
    ledger: produced.ledger,
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });

  assert.equal(report.verdict, "not_stream_ready");
  assert.equal(report.metrics.ledgerDeclarations, 4);
  assert.equal(
    report.criteria.find((item) => item.id === "action-ledger-completeness").status,
    "pass"
  );
});

test("actual partial mod output remains visible but cannot fabricate stream readiness", (t) => {
  const rehearsal = productionRehearsal(t);
  const report = evaluateStreamReadiness({
    bundle: rehearsal.bundle,
    ledger: rehearsal.ledger,
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });

  assert.equal(report.verdict, "not_stream_ready");
  assert.ok(report.blockers.includes("required-domain-observations"));
  assert.ok(report.blockers.includes("pause-and-bounded-time"));
  assert.ok(report.blockers.includes("component-health"));
  assert.equal(report.metrics.navigationAttempts, ACTION_COUNT);
  assert.equal(report.metrics.ledgerDeclarations, ACTION_COUNT);
  assert.equal(report.metrics.boundedAdvancements, 0);
  assert.equal(Object.isFrozen(rehearsal.bundle), true);
  assert.equal(Object.isFrozen(rehearsal.bundle.records), true);
  assert.equal(rehearsal.finalFeed.currentState.status, "unavailable");
  assert.deepEqual(
    Object.keys(rehearsal.finalFeed.currentObservations.domains).sort(),
    ["diplomacy", "economy", "markets", "military", "nation"]
  );
  assert.equal(
    rehearsal.finalFeed.currentObservations.domains.economy.fields.monthlyBalance
      .availability,
    "unavailable"
  );
  assert.equal(
    rehearsal.finalFeed.currentObservations.domains.markets.fields.shortages
      .availability,
    "unavailable"
  );
  const firstNavigation = rehearsal.bundle.records.find((item) =>
    item.recordType === "llm_action_outcome" &&
    item.payload.procedure === "open_control_panel"
  );
  assert.ok(firstNavigation);
  assert.equal(firstNavigation.provenance.freshness, "fresh");
  assert.ok(END - Date.parse(firstNavigation.occurredAtUtc) > 2 * 60 * 1000);
  const health = rehearsal.bundle.records.filter((item) => item.recordType === "health");
  assert.deepEqual(health.map((item) => item.payload.component).sort(),
    ["control-ledger", "mod-bridge", "monitoring-feed", "test-session"]);
  assert.equal(
    health.find((item) => item.payload.component === "mod-bridge").payload.status,
    "unavailable"
  );
  for (const item of health.filter((record) =>
    record.payload.component !== "test-session"
  )) {
    assert.equal(item.payload.sourceFeedId, rehearsal.finalFeed.feedId);
    assert.equal(
      item.payload.sourceFeedManifestSha256,
      rehearsal.finalFeed.integrity.manifestSha256
    );
  }
});

test("production collector rejects a live feed changed after manifest creation", () => {
  const collector = new StreamRehearsalCollector({
    rehearsalId: "stream-rehearsal-1",
    fingerprint: expectations().fingerprint,
    fingerprintEvidenceSha256: HASH_A,
    startedAtUtc: timestamp(0)
  });
  const feed = buildLiveFeed({
    now: () => START + 1_000,
    logPath: "Z:\\missing\\debug.log",
    ledgerReader: () => [],
    saveDirectory: "Z:\\missing\\saves"
  });
  feed.records[0].payload.component = "tampered-component";

  assert.throws(() => collector.ingest(feed), /manifest/);
});

test("a late-invalid feed record leaves collector output byte-equivalent", (t) => {
  const produced = protocolLedger(t);
  const feed = buildLiveFeed({
    now: () => END - 2_000,
    logPath: "Z:\\missing\\debug.log",
    ledgerReader: () => produced.ledger,
    saveDirectory: "Z:\\missing\\saves"
  });
  const createCollector = () => new StreamRehearsalCollector({
    rehearsalId: "stream-rehearsal-1",
    fingerprint: expectations().fingerprint,
    fingerprintEvidenceSha256: HASH_A,
    startedAtUtc: timestamp(0)
  });
  const baseline = createCollector();
  const rejected = createCollector();
  baseline.ingest(feed);
  rejected.ingest(feed);

  const invalidFeed = structuredClone(feed);
  const actionRecord = invalidFeed.records.find((record) =>
    record.recordType === "llm_action_outcome"
  );
  const validNewRecord = structuredClone(actionRecord);
  validNewRecord.recordId = "atomic-valid-before-error";
  validNewRecord.sequence = invalidFeed.records.length;
  const lateInvalidRecord = structuredClone(actionRecord);
  lateInvalidRecord.recordId = "atomic-invalid-subject";
  lateInvalidRecord.sequence = invalidFeed.records.length + 1;
  lateInvalidRecord.subject.countryId = "BAD";
  invalidFeed.records.push(validNewRecord, lateInvalidRecord);
  invalidFeed.integrity.manifestSha256 = crypto.createHash("sha256")
    .update(JSON.stringify(invalidFeed.records))
    .digest("hex");

  assert.throws(() => rejected.ingest(invalidFeed), /wrong subject/);
  const completedAtUtc = new Date(END).toISOString();
  assert.equal(
    JSON.stringify(rejected.complete(completedAtUtc)),
    JSON.stringify(baseline.complete(completedAtUtc))
  );
});

test("collector health is bound only to the final validated live feed", (t) => {
  const produced = protocolLedger(t);
  const firstFeed = buildLiveFeed({
    now: () => END - 4_000,
    logPath: "Z:\\missing\\debug.log",
    ledgerReader: () => produced.ledger,
    saveDirectory: "Z:\\missing\\saves"
  });
  const finalFeed = buildLiveFeed({
    now: () => END - 2_000,
    logPath: "Z:\\missing\\debug.log",
    ledgerReader: () => {
      throw new Error("deliberately unavailable final ledger source");
    },
    saveDirectory: "Z:\\missing\\saves"
  });
  const collector = new StreamRehearsalCollector({
    rehearsalId: "stream-rehearsal-1",
    fingerprint: expectations().fingerprint,
    fingerprintEvidenceSha256: HASH_A,
    startedAtUtc: timestamp(0)
  });

  collector.ingest(firstFeed);
  collector.ingest(finalFeed);
  const bundle = collector.complete(new Date(END).toISOString());
  const ledgerHealth = bundle.records.find((item) =>
    item.recordType === "health" &&
    item.payload.component === "control-ledger"
  );

  assert.equal(ledgerHealth.payload.status, "unavailable");
  assert.equal(ledgerHealth.payload.sourceFeedId, finalFeed.feedId);
  assert.equal(
    ledgerHealth.payload.sourceFeedManifestSha256,
    finalFeed.integrity.manifestSha256
  );
  assert.equal(
    ledgerHealth.payload.sourceFeedGeneratedAtUtc,
    finalFeed.generatedAtUtc
  );
});

test("failed completion leaves collector state byte-equivalent and uncompleted", () => {
  const collector = new StreamRehearsalCollector({
    rehearsalId: "stream-rehearsal-1",
    fingerprint: expectations().fingerprint,
    fingerprintEvidenceSha256: HASH_A,
    startedAtUtc: timestamp(0)
  });
  collector.ingest(buildLiveFeed({
    now: () => START + 1_000,
    logPath: "Z:\\missing\\debug.log",
    ledgerReader: () => [],
    saveDirectory: "Z:\\missing\\saves"
  }));
  collector.addCollectorRecord({
    recordId: "invalid-completion-record",
    recordType: "unsupported_record_type",
    occurredAtUtc: new Date(START + 1_000).toISOString(),
    recordedAtUtc: new Date(START + 1_000).toISOString(),
    payload: {},
    provenance: {
      adapter: { id: "eu5-stream-rehearsal-collector", version: "1" },
      verification: {
        status: "verified",
        evidence: "Deliberate completion-validation failure."
      },
      freshness: "fresh"
    }
  });
  const before = JSON.stringify([...collector.records.entries()]);

  assert.throws(
    () => collector.complete(new Date(START + 2_000).toISOString()),
    /recordType/
  );
  assert.equal(collector.completed, false);
  assert.equal(JSON.stringify([...collector.records.entries()]), before);
});

test("collector rejects oversized feed snapshots before schema traversal", () => {
  const collector = new StreamRehearsalCollector({
    rehearsalId: "stream-rehearsal-1",
    fingerprint: expectations().fingerprint,
    fingerprintEvidenceSha256: HASH_A,
    startedAtUtc: timestamp(0)
  });
  assert.throws(
    () => collector.ingest({
      records: new Array(COLLECTOR_LIMITS.maximumFeedRecords + 1).fill(null)
    }),
    /at most/
  );
});

test("bounded-advance evidence pairs cannot be replayed or capture-reversed", () => {
  const createCollector = () => {
    const collector = new StreamRehearsalCollector({
      rehearsalId: "stream-rehearsal-1",
      fingerprint: expectations().fingerprint,
      fingerprintEvidenceSha256: HASH_A,
      startedAtUtc: timestamp(0)
    });
    collector.ingest(buildLiveFeed({
      now: () => START + 500,
      logPath: "Z:\\missing\\debug.log",
      ledgerReader: () => [],
      saveDirectory: "Z:\\missing\\saves"
    }));
    return collector;
  };
  const provenance = {
    adapter: { id: "eu5-stream-rehearsal-collector", version: "1" },
    verification: { status: "verified", evidence: "Test evidence snapshot." },
    freshness: "fresh"
  };
  const addSnapshot = (collector, recordId, gameDate, occurredAtMs) =>
    collector.addCollectorRecord({
      recordId,
      recordType: "nation_snapshot",
      occurredAtUtc: new Date(occurredAtMs).toISOString(),
      recordedAtUtc: new Date(occurredAtMs).toISOString(),
      payload: { domain: "nation", gameDate, paused: true },
      provenance
    });

  const replay = createCollector();
  addSnapshot(replay, "advance-before", "1337-05-01", START + 1_000);
  addSnapshot(replay, "advance-after", "1337-05-02", START + 2_000);
  replay.recordBoundedAdvance({
    beforeRecordId: "advance-before",
    afterRecordId: "advance-after",
    maximumDays: 1,
    recordedAtUtc: new Date(START + 2_000).toISOString()
  });
  assert.throws(() => replay.recordBoundedAdvance({
    beforeRecordId: "advance-before",
    afterRecordId: "advance-after",
    maximumDays: 2,
    recordedAtUtc: new Date(START + 2_000).toISOString()
  }), /already recorded/);
  addSnapshot(replay, "advance-third", "1337-05-03", START + 3_000);
  replay.recordBoundedAdvance({
    beforeRecordId: "advance-after",
    afterRecordId: "advance-third",
    maximumDays: 1,
    recordedAtUtc: new Date(START + 3_000).toISOString()
  });
  assert.throws(() => replay.recordBoundedAdvance({
    beforeRecordId: "advance-before",
    afterRecordId: "advance-third",
    maximumDays: 2,
    recordedAtUtc: new Date(START + 3_000).toISOString()
  }), /overlaps/);

  const reversed = createCollector();
  addSnapshot(reversed, "reversed-before", "1337-05-01", START + 2_000);
  addSnapshot(reversed, "reversed-after", "1337-05-02", START + 1_000);
  assert.throws(() => reversed.recordBoundedAdvance({
    beforeRecordId: "reversed-before",
    afterRecordId: "reversed-after",
    maximumDays: 1,
    recordedAtUtc: new Date(START + 2_000).toISOString()
  }), /chronologically ordered/);
});

test("collector finalizes at the exact dashboard record limit and rejects one over", () => {
  const collector = new StreamRehearsalCollector({
    rehearsalId: "stream-rehearsal-1",
    fingerprint: expectations().fingerprint,
    fingerprintEvidenceSha256: HASH_A,
    startedAtUtc: timestamp(0)
  });
  collector.ingest(buildLiveFeed({
    now: () => START + 1_000,
    logPath: "Z:\\missing\\debug.log",
    ledgerReader: () => [],
    saveDirectory: "Z:\\missing\\saves"
  }));
  const provenance = {
    adapter: { id: "eu5-stream-rehearsal-collector", version: "1" },
    verification: { status: "verified", evidence: "Capacity boundary fixture." },
    freshness: "fresh"
  };
  const capacityBeforeCompletion =
    COLLECTOR_LIMITS.maximumCollectedRecords -
    COLLECTOR_LIMITS.completionRecords;
  for (let index = 1; index < capacityBeforeCompletion; index += 1) {
    collector.addCollectorRecord({
      recordId: `capacity-${index}`,
      recordType: "game_event",
      occurredAtUtc: new Date(START + 1_000).toISOString(),
      recordedAtUtc: new Date(START + 1_000).toISOString(),
      payload: { eventType: "capacity_probe" },
      provenance
    });
  }
  assert.throws(() => collector.addCollectorRecord({
    recordId: "capacity-over",
    recordType: "game_event",
    occurredAtUtc: new Date(START + 1_000).toISOString(),
    recordedAtUtc: new Date(START + 1_000).toISOString(),
    payload: { eventType: "capacity_probe" },
    provenance
  }), /limited to 2000 records/);
  assert.equal(
    collector.complete(new Date(START + 2_000).toISOString()).records.length,
    COLLECTOR_LIMITS.maximumCollectedRecords
  );
});

test("production collector CLI creates one new bundle and refuses overwrite", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-collector-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const feedPath = path.join(root, "feed.json");
  const sessionPath = path.join(root, "capture.json");
  const outputPath = path.join(root, "bundle.json");
  const feed = buildLiveFeed({
    now: () => START + 1_000,
    logPath: path.join(root, "missing.log"),
    ledgerReader: () => [],
    saveDirectory: path.join(root, "missing-saves")
  });
  fs.writeFileSync(feedPath, JSON.stringify(feed));
  fs.writeFileSync(sessionPath, JSON.stringify({
    schemaVersion: CAPTURE_SCHEMA,
    rehearsalId: "stream-rehearsal-1",
    fingerprint: expectations().fingerprint,
    fingerprintEvidenceSha256: HASH_A,
    startedAtUtc: timestamp(0),
    completedAtUtc: timestamp(2_000),
    boundedAdvances: []
  }));
  const cli = path.join(__dirname, "..", "src", "stream", "collect-rehearsal.js");
  const args = [
    cli,
    "--feeds", feedPath,
    "--session", sessionPath,
    "--output", outputPath
  ];
  const first = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).schemaVersion,
    "eu5.monitoring-bundle/v1");
  const second = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /EEXIST/);
  assert.deepEqual(
    parseCollectorArguments([
      "--feeds", feedPath,
      "--session", sessionPath,
      "--output", outputPath
    ]),
    { feeds: feedPath, session: sessionPath, output: outputPath }
  );
  assert.throws(
    () => writeBundle(feedPath, {}, [feedPath, sessionPath]),
    /must not alias/
  );
  assert.throws(
    () => writeBundle(path.join(root, "campaign.eu5"), {}, []),
    /new \.json/
  );
  assert.throws(
    () => writeBundle(path.join(root, "bundle.json:stream"), {}, []),
    /alternate data stream/
  );
});

test("missing domains, weak navigation, unsafe pause evidence, and incomplete actions fail closed", () => {
  const bundle = passingBundle();
  let outcomeIndex = 0;
  bundle.records = bundle.records.filter((item) =>
    item.payload.domain !== "military" &&
    !(item.recordType === "llm_action_outcome" && outcomeIndex++ % 2 === 0)
  );
  const advance = bundle.records.find((item) => item.payload.eventType === "bounded_time_advance");
  advance.payload.afterPaused = false;
  resealBundle(bundle);
  const ledger = completeLedger(ACTION_COUNT);
  ledger.splice(-1);
  const report = evaluateStreamReadiness({
    bundle,
    ledger,
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  assert.equal(report.verdict, "not_stream_ready");
  assert.ok(report.blockers.includes("required-domain-observations"));
  assert.ok(report.blockers.includes("pause-and-bounded-time"));
  assert.ok(report.blockers.includes("navigation-reliability"));
  assert.ok(!report.blockers.includes("ledger-integrity"));
  assert.ok(report.blockers.includes("action-ledger-completeness"));
});

test("zero-day and negative-overshoot advances are unsafe", () => {
  for (const mutate of [
    (advance) => {
      advance.payload.afterGameDate = advance.payload.beforeGameDate;
    },
    (advance) => {
      advance.payload.overshootDays = -1;
    }
  ]) {
    const bundle = passingBundle();
    const advance = bundle.records.find((record) =>
      record.payload.eventType === "bounded_time_advance"
    );
    mutate(advance);
    resealBundle(bundle);
    const report = evaluateStreamReadiness({
      bundle,
      ledger: completeLedger(ACTION_COUNT),
      expectations: expectations(),
      generatedAtUtc: new Date(END + 1_000).toISOString()
    });
    const gate = report.criteria.find((item) => item.id === "pause-and-bounded-time");
    assert.equal(gate.status, "fail");
    assert.ok(gate.evidence.unsafeRecordIds.includes(advance.recordId));
  }
});

test("replayed bounded receipts cannot satisfy the minimum advancement gate", () => {
  const bundle = passingBundle();
  const receipt = bundle.records.find((record) =>
    record.payload.eventType === "bounded_time_advance"
  );
  const clones = ["replayed-advance-1", "replayed-advance-2"].map((recordId) => ({
    ...structuredClone(receipt),
    recordId
  }));
  bundle.records.push(...clones);
  resealBundle(bundle);
  const report = evaluateStreamReadiness({
    bundle,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  const gate = report.criteria.find((item) => item.id === "pause-and-bounded-time");
  assert.equal(gate.status, "fail");
  assert.ok(gate.evidence.unsafeRecordIds.includes(receipt.recordId));
  assert.ok(gate.evidence.unsafeRecordIds.includes("replayed-advance-1"));
  assert.ok(gate.evidence.unsafeRecordIds.includes("replayed-advance-2"));
});

test("overlapping A-to-B, B-to-C, and A-to-C receipts cannot count as three", () => {
  const bundle = passingBundle();
  const nationEvidence = bundle.records.filter((record) =>
    record.recordType === "nation_snapshot" &&
    record.payload.domain === "nation" &&
    ["1337-05-01", "1337-05-03"].includes(record.payload.gameDate)
  );
  const first = nationEvidence.find((record) =>
    record.payload.gameDate === "1337-05-01"
  );
  const third = nationEvidence.find((record) =>
    record.payload.gameDate === "1337-05-03"
  );
  const receipts = bundle.records.filter((record) =>
    record.payload.eventType === "bounded_time_advance"
  );
  receipts[2].payload.beforeGameDate = first.payload.gameDate;
  receipts[2].payload.afterGameDate = third.payload.gameDate;
  receipts[2].payload.beforeEvidenceSha256 = recordDigest(first);
  receipts[2].payload.afterEvidenceSha256 = recordDigest(third);
  resealBundle(bundle);

  const report = evaluateStreamReadiness({
    bundle,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  const gate = report.criteria.find((item) => item.id === "pause-and-bounded-time");
  assert.equal(gate.status, "fail");
  assert.ok(gate.evidence.unsafeRecordIds.includes(receipts[2].recordId));
});

test("duplicate receipt IDs are rejected before overlap maps are constructed", () => {
  const bundle = passingBundle();
  const receipts = bundle.records.filter((record) =>
    record.payload.eventType === "bounded_time_advance"
  );
  const nationEvidence = bundle.records.filter((record) =>
    record.recordType === "nation_snapshot" &&
    record.payload.domain === "nation"
  );
  const first = nationEvidence.find((record) =>
    record.payload.gameDate === "1337-05-01"
  );
  const third = nationEvidence.find((record) =>
    record.payload.gameDate === "1337-05-03"
  );
  receipts[2].payload.beforeGameDate = first.payload.gameDate;
  receipts[2].payload.afterGameDate = third.payload.gameDate;
  receipts[2].payload.beforeEvidenceSha256 = recordDigest(first);
  receipts[2].payload.afterEvidenceSha256 = recordDigest(third);
  receipts[1].recordId = receipts[0].recordId;
  receipts[2].recordId = receipts[0].recordId;
  resealBundle(bundle);

  assert.throws(() => evaluateStreamReadiness({
    bundle,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  }), /recordId.*(?:globally|must be) unique/);
});

test("fingerprint mismatch and stale or slow telemetry are explicit blockers", () => {
  const bundle = passingBundle();
  const session = bundle.records.find((item) => item.payload.component === "test-session");
  session.payload.fingerprint.modVersion = "0.2.0";
  const economy = bundle.records.find((item) => item.payload.domain === "economy");
  economy.occurredAtUtc = timestamp(20 * 60 * 1000);
  economy.recordedAtUtc = timestamp(20 * 60 * 1000 + 6_000);
  resealBundle(bundle);
  const report = evaluateStreamReadiness({
    bundle,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  assert.ok(report.blockers.includes("campaign-fingerprint"));
  assert.ok(report.blockers.includes("telemetry-freshness"));
});

test("unknown outcomes and p95 latency cannot be hidden by successful attempts", () => {
  const bundle = passingBundle();
  const navigation = bundle.records.filter((item) =>
    item.recordType === "llm_action_outcome" &&
    item.payload.actionFamily === "navigation"
  );
  navigation[0].payload.outcome = "execution_unknown";
  navigation[1].payload.latencyMs = 5_000;
  navigation[2].payload.latencyMs = 5_000;
  navigation[3].payload.latencyMs = 5_000;
  navigation[4].payload.latencyMs = 5_000;
  navigation[5].payload.latencyMs = 5_000;
  resealBundle(bundle);
  const report = evaluateStreamReadiness({
    bundle,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  const gate = report.criteria.find((item) => item.id === "navigation-reliability");
  assert.equal(gate.status, "fail");
  assert.equal(gate.evidence.unknownOutcomes, 1);
  assert.equal(gate.evidence.p95LatencyMs, 5_000);
});

test("ledger hash verification detects tampering and reordering", () => {
  const ledger = completeLedger(1);
  assert.equal(verifyLedgerHashChain(ledger).valid, true);
  ledger[2].verified = true;
  const result = verifyLedgerHashChain(ledger);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /recordHash is invalid/);
});

test("CLI helpers read JSONL and emit markdown or JSON reports", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-stream-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  fs.writeFileSync(ledgerPath, completeLedger(1).map((item) => JSON.stringify(item)).join("\n"));
  assert.equal(readLedger(ledgerPath).length, 7);
  assert.deepEqual(
    parseArguments([
      "--bundle", "bundle.json",
      "--ledger", "ledger.jsonl",
      "--expectations", "expectations.json"
    ]),
    { bundle: "bundle.json", ledger: "ledger.jsonl", expectations: "expectations.json" }
  );
  const report = evaluateStreamReadiness({
    bundle: passingBundle(),
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  const markdown = writeReport(path.join(directory, "report.md"), report);
  const json = writeReport(path.join(directory, "report.json"), report);
  assert.match(fs.readFileSync(markdown, "utf8"), /EU5 Stream Readiness Rehearsal/);
  assert.equal(JSON.parse(fs.readFileSync(json, "utf8")).verdict, "stream_ready");
});

test("verifier bounds and validates artifact paths before JSON parsing", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-stream-inputs-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const oversizedPath = path.join(directory, "oversized.json");
  fs.writeFileSync(oversizedPath, "{}");
  fs.truncateSync(oversizedPath, MAXIMUM_VERIFIER_INPUT_BYTES + 1);

  assert.throws(
    () => readJson(oversizedPath, "oversized artifact"),
    /exceeds the .*byte limit/
  );
  const originalFstatSync = fs.fstatSync;
  fs.fstatSync = (...args) => {
    const actual = originalFstatSync(...args);
    const understated = Object.assign(
      Object.create(Object.getPrototypeOf(actual)),
      actual
    );
    understated.size = 2;
    return understated;
  };
  try {
    assert.throws(
      () => readJson(oversizedPath, "grown artifact"),
      /exceeds the .*byte limit/
    );
    assert.throws(
      () => readFeedSnapshots(oversizedPath),
      /exceeds the .*byte limit/
    );
  } finally {
    fs.fstatSync = originalFstatSync;
  }
  assert.throws(
    () => readJson(`${oversizedPath}:alternate`, "alternate stream"),
    /alternate data stream/
  );
});

test("collector input rejects a file swapped between lstat and open", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-stream-swap-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "feeds.json");
  const replacementPath = path.join(directory, "replacement.json");
  fs.writeFileSync(inputPath, "{}");
  fs.writeFileSync(replacementPath, "[]");
  const originalOpenSync = fs.openSync;
  let swapped = false;
  fs.openSync = (candidate, ...args) => {
    if (!swapped && path.resolve(candidate) === path.resolve(inputPath)) {
      swapped = true;
      fs.unlinkSync(inputPath);
      fs.renameSync(replacementPath, inputPath);
    }
    return originalOpenSync(candidate, ...args);
  };
  try {
    assert.throws(
      () => readFeedSnapshots(inputPath),
      /changed while it was being opened/
    );
  } finally {
    fs.openSync = originalOpenSync;
  }
});

test("expectations reject malformed hashes and impossible thresholds", () => {
  assert.throws(() => evaluateStreamReadiness({
    bundle: passingBundle(),
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations({
      fingerprint: { ...expectations().fingerprint, seedSaveSha256: "bad" }
    }),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  }), /seedSaveSha256/);
  assert.throws(() => evaluateStreamReadiness({
    bundle: passingBundle(),
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations({ thresholds: { minimumNavigationSuccessRate: 2 } }),
    generatedAtUtc: new Date(END).toISOString()
  }), /minimumNavigationSuccessRate/);
});

test("stream-readiness defaults cannot be weakened or omitted", () => {
  const weakerThresholds = [
    ["minimumDurationMs", 30 * 60 * 1000 - 1],
    ["minimumBoundedAdvancements", 2],
    ["maximumAdvanceOvershootDays", 2],
    ["maximumTelemetryAgeMs", 30_001],
    ["maximumIngestLatencyMs", 5_001],
    ["minimumNavigationAttempts", 99],
    ["minimumNavigationSuccessRate", 0.98],
    ["maximumNavigationP95LatencyMs", 2_001],
    ["maximumUnknownOutcomes", 1],
    ["minimumProcedureSuccesses", 2]
  ];
  for (const [field, value] of weakerThresholds) {
    assert.throws(() => evaluateStreamReadiness({
      bundle: passingBundle(),
      ledger: completeLedger(ACTION_COUNT),
      expectations: expectations({ thresholds: { [field]: value } }),
      generatedAtUtc: new Date(END + 1_000).toISOString()
    }), /cannot weaken the default policy/, field);
  }

  for (const [field, values] of [
    ["requiredDomains", ["nation", "economy", "markets", "diplomacy"]],
    ["requiredNavigationProcedures", NAVIGATION_PROCEDURES.slice(0, -1)],
    ["requiredHealthComponents", ["test-session", "mod-bridge", "monitoring-feed"]],
    [
      "requiredGameplayCapabilities",
      ["economy_decision", "diplomacy_decision"]
    ]
  ]) {
    assert.throws(() => evaluateStreamReadiness({
      bundle: passingBundle(),
      ledger: completeLedger(ACTION_COUNT),
      expectations: expectations({ [field]: values }),
      generatedAtUtc: new Date(END + 1_000).toISOString()
    }), /cannot omit default requirements/, field);
  }
});

test("duplicate action correlations cannot share one verified ledger lifecycle", () => {
  const bundle = passingBundle();
  const duplicateProposal = {
    ...bundle.records.find((item) => item.recordType === "llm_action_proposed"),
    recordId: "duplicate-proposal"
  };
  const duplicateOutcome = {
    ...bundle.records.find((item) => item.recordType === "llm_action_outcome"),
    recordId: "duplicate-outcome"
  };
  bundle.records.push(duplicateProposal, duplicateOutcome);
  resealBundle(bundle);
  const report = evaluateStreamReadiness({
    bundle,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  const gate = report.criteria.find((item) => item.id === "action-ledger-completeness");
  assert.equal(gate.status, "fail");
  assert.deepEqual(gate.evidence.duplicateProposalCorrelations, ["declaration-0"]);
  assert.deepEqual(gate.evidence.duplicateOutcomeCorrelations, ["declaration-0"]);
});

test("navigation successes require finite latency and fresh verified provenance", () => {
  const bundle = passingBundle();
  const outcomes = bundle.records.filter((item) => item.recordType === "llm_action_outcome");
  delete outcomes[0].payload.latencyMs;
  outcomes[1].provenance.freshness = "stale";
  resealBundle(bundle);
  const report = evaluateStreamReadiness({
    bundle,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  const gate = report.criteria.find((item) => item.id === "navigation-reliability");
  assert.equal(gate.status, "fail");
  assert.equal(gate.evidence.successes, 98);
});

test("a post-verification failure blocks a valid hash-chained ledger", () => {
  const ledger = completeLedger(ACTION_COUNT);
  appendLedger(ledger, {
    declarationId: "declaration-0",
    lifecycleState: "failed",
    verified: false,
    recordedAtUtc: timestamp(29 * 60 * 1000)
  });
  assert.equal(verifyLedgerHashChain(ledger).valid, true);
  const report = evaluateStreamReadiness({
    bundle: passingBundle(),
    ledger,
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  const gate = report.criteria.find((item) => item.id === "action-ledger-completeness");
  assert.equal(gate.status, "fail");
  assert.ok(gate.evidence.invalidTerminals.includes("declaration-0"));
});

test("delayed evaluation and missing explicit boundaries block readiness", () => {
  const delayed = evaluateStreamReadiness({
    bundle: passingBundle(),
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: "2030-07-26T10:30:01.000Z"
  });
  assert.ok(delayed.blockers.includes("telemetry-freshness"));
  assert.ok(delayed.blockers.includes("component-health"));

  const withoutStart = passingBundle();
  withoutStart.records = withoutStart.records.filter((item) =>
    item.payload.eventType !== "rehearsal_started"
  );
  resealBundle(withoutStart);
  const missingBoundary = evaluateStreamReadiness({
    bundle: withoutStart,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  assert.ok(missingBoundary.blockers.includes("rehearsal-duration"));
});

test("report writer rejects input aliasing, save targets, and existing files", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-stream-output-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, "expectations.json");
  const existing = path.join(directory, "existing.md");
  fs.writeFileSync(input, "{}");
  fs.writeFileSync(existing, "keep");
  const report = evaluateStreamReadiness({
    bundle: passingBundle(),
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  assert.throws(() => writeReport(input, report, [input]), /must not alias/);
  assert.throws(() => writeReport(path.join(directory, "campaign.eu5"), report), /new .md or .json/);
  assert.throws(() => writeReport(path.join(directory, "campaign.save"), report), /new .md or .json/);
  assert.throws(
    () => writeReport(path.join(directory, "campaign.eu5:report.md"), report),
    /alternate data stream/
  );
  assert.throws(() => writeReport(existing, report), /EEXIST/);
  assert.equal(fs.readFileSync(existing, "utf8"), "keep");
});

test("CLI exits 0 for ready, 2 for failed gates, and 1 for invalid input", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-stream-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bundlePath = path.join(directory, "bundle.json");
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const expectationsPath = path.join(directory, "expectations.json");
  const currentBundle = shiftBundleTo(passingBundle(), Date.now() - 100);
  fs.writeFileSync(bundlePath, JSON.stringify(currentBundle));
  const currentStartAt = Date.parse(
    currentBundle.records.find((item) => item.payload.eventType === "rehearsal_started")
      .occurredAtUtc
  );
  fs.writeFileSync(
    ledgerPath,
    shiftLedgerTo(completeLedger(ACTION_COUNT), currentStartAt)
      .map((item) => JSON.stringify(item)).join("\n")
  );
  fs.writeFileSync(expectationsPath, JSON.stringify(expectations()));
  const cli = path.join(__dirname, "..", "src", "stream", "verify-rehearsal.js");
  const baseArgs = [
    cli,
    "--bundle", bundlePath,
    "--ledger", ledgerPath,
    "--expectations", expectationsPath
  ];
  const ready = spawnSync(process.execPath, baseArgs, { encoding: "utf8" });
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.stdout, /STREAM READY/);

  currentBundle.records = currentBundle.records.filter((item) =>
    item.payload.domain !== "military"
  );
  resealBundle(currentBundle);
  fs.writeFileSync(bundlePath, JSON.stringify(currentBundle));
  const failed = spawnSync(process.execPath, baseArgs, { encoding: "utf8" });
  assert.equal(failed.status, 2, failed.stderr);
  assert.match(failed.stdout, /NOT STREAM READY/);

  fs.writeFileSync(bundlePath, "{");
  const invalid = spawnSync(process.execPath, baseArgs, { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Cannot read monitoring bundle/);
});

test("pre-rehearsal navigation and time evidence cannot satisfy a later session window", () => {
  const bundle = passingBundle();
  const start = bundle.records.find((item) => item.payload.eventType === "rehearsal_started");
  const completed = bundle.records.find((item) => item.payload.eventType === "rehearsal_completed");
  start.occurredAtUtc = timestamp(29 * 60 * 1000);
  start.recordedAtUtc = timestamp(29 * 60 * 1000 + 100);
  completed.occurredAtUtc = timestamp(59 * 60 * 1000);
  completed.recordedAtUtc = timestamp(59 * 60 * 1000 + 100);
  bundle.generatedAtUtc = timestamp(59 * 60 * 1000 + 1_000);
  resealBundle(bundle);
  const report = evaluateStreamReadiness({
    bundle,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: bundle.generatedAtUtc
  });
  assert.ok(report.blockers.includes("rehearsal-session-binding"));
  assert.ok(report.blockers.includes("navigation-reliability"));
  assert.ok(report.blockers.includes("pause-and-bounded-time"));
});

test("economy, diplomacy, and recruitment deliverables are mandatory", () => {
  const bundle = passingBundle();
  bundle.records = bundle.records.filter((item) =>
    item.payload.capability !== "economy_decision"
  );
  resealBundle(bundle);
  const report = evaluateStreamReadiness({
    bundle,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  const gate = report.criteria.find((item) => item.id === "gameplay-coverage");
  assert.equal(gate.status, "fail");
  assert.deepEqual(gate.evidence.missingCapabilities, ["economy_decision"]);
});

test("evidence recorded after completion cannot satisfy action or navigation gates", () => {
  const bundle = passingBundle();
  const outcome = bundle.records.find((item) =>
    item.recordType === "llm_action_outcome" &&
    item.payload.actionFamily === "navigation"
  );
  outcome.occurredAtUtc = timestamp(30 * 60 * 1000 + 200);
  outcome.recordedAtUtc = timestamp(30 * 60 * 1000 + 300);
  bundle.generatedAtUtc = timestamp(30 * 60 * 1000 + 1_000);
  resealBundle(bundle);
  const report = evaluateStreamReadiness({
    bundle,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: bundle.generatedAtUtc
  });
  assert.ok(report.blockers.includes("rehearsal-session-binding"));
  assert.ok(report.blockers.includes("navigation-reliability"));
  assert.ok(report.blockers.includes("action-ledger-completeness"));
});

test("outcome relabeling cannot fabricate gameplay coverage", () => {
  const bundle = passingBundle();
  const economyOutcome = bundle.records.find((item) =>
    item.recordType === "llm_action_outcome" &&
    item.payload.capability === "economy_decision"
  );
  const economyProposal = bundle.records.find((item) =>
    item.recordType === "llm_action_proposed" &&
    item.correlationId === economyOutcome.correlationId
  );
  economyProposal.payload.capability = null;
  economyProposal.payload.actionFamily = "navigation";
  economyProposal.payload.actionId = "navigation-relabel";
  resealBundle(bundle);
  const report = evaluateStreamReadiness({
    bundle,
    ledger: completeLedger(ACTION_COUNT),
    expectations: expectations(),
    generatedAtUtc: new Date(END + 1_000).toISOString()
  });
  const coverage = report.criteria.find((item) => item.id === "gameplay-coverage");
  const lifecycle = report.criteria.find((item) => item.id === "action-ledger-completeness");
  assert.ok(coverage.evidence.missingCapabilities.includes("economy_decision"));
  assert.ok(lifecycle.evidence.semanticActionMismatches.includes("declaration-100"));
});

test("failed or expired monitoring outcomes block readiness despite a verified ledger", () => {
  for (const outcomeValue of ["failed", "expired"]) {
    const bundle = passingBundle();
    const outcome = bundle.records.find((item) =>
      item.recordType === "llm_action_outcome" &&
      item.payload.capability === "diplomacy_decision"
    );
    outcome.payload.outcome = outcomeValue;
    resealBundle(bundle);
    const report = evaluateStreamReadiness({
      bundle,
      ledger: completeLedger(ACTION_COUNT),
      expectations: expectations(),
      generatedAtUtc: new Date(END + 1_000).toISOString()
    });
    const gate = report.criteria.find((item) => item.id === "action-ledger-completeness");
    assert.equal(gate.status, "fail");
    assert.deepEqual(gate.evidence.blockingActionOutcomes, [outcome.recordId]);
  }
});
