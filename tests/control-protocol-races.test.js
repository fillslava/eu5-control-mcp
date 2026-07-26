"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { catalogueAction } = require("../src/control/action-gate");
const { ControlLedger } = require("../src/control/control-ledger");
const {
  ACTION_BINDING_SCHEMA,
  ControlProtocol,
  MAX_EVENT_CLOCK_SKEW_MS,
  approvalPayload,
  recoveryPayload,
  verificationPayload
} = require("../src/control/control-protocol");

const NOW_ISO = "2026-07-26T10:00:00.000Z";
const MOD_HASH = "1".repeat(64);
const SAVE_HASH = "2".repeat(64);
const OBSERVATION_HASH = "3".repeat(64);
const CROSS_PROCESS_DISPATCH_WORKER = String.raw`
const config = JSON.parse(process.argv[1]);
const { ControlLedger } = require(config.ledgerModule);
const { ControlProtocol } = require(config.protocolModule);
const protocol = new ControlProtocol({
  ledger: new ControlLedger({ dataDirectory: config.dataDirectory }),
  now: () => config.nowMs,
  authorizationTtlMs: 1000,
  approvalSecret: config.approvalSecret,
  verifierSecret: config.verifierSecret,
  sessionContext: config.sessionContext
});
process.send({ type: "ready" });
process.on("message", (message) => {
  if (!message || message.type !== "go") return;
  let payload;
  try {
    payload = {
      ok: true,
      result: protocol.dispatch({ authorizationId: config.authorizationId })
    };
  } catch (error) {
    payload = { ok: false, error: error && error.message };
  }
  process.send({ type: "result", payload }, () => process.exit(0));
});
`;

class HookedLedger extends ControlLedger {
  armAppendOnce(predicate, callback) {
    this.appendOnceHook = { predicate, callback };
  }

  appendOnce(event, options) {
    const hook = this.appendOnceHook;
    if (hook && hook.predicate(event)) {
      this.appendOnceHook = null;
      hook.callback(event, options);
    }
    return super.appendOnce(event, options);
  }
}

function sessionContext() {
  return {
    schemaVersion: "eu5.rehearsal-session/v1",
    rehearsalId: "race-rehearsal",
    campaignId: "holland-race-test",
    countryId: "HOL",
    gameBuild: "1.0.2",
    modVersion: "0.3.1",
    modManifestSha256: MOD_HASH,
    seedSaveSha256: SAVE_HASH
  };
}

function preObservation(id) {
  return {
    schemaVersion: "eu5.pre-observation/v1",
    id,
    capturedAtUtc: NOW_ISO,
    evidenceSha256: OBSERVATION_HASH,
    ...sessionContext(),
    schemaVersion: "eu5.pre-observation/v1"
  };
}

function fixture(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-control-race-"));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const ledger = new HookedLedger({ dataDirectory });
  const approvalSecret = "race-approval-secret";
  const verifierSecret = "race-verifier-secret";
  let nowMs = Date.parse(NOW_ISO);
  const protocol = new ControlProtocol({
    ledger,
    now: () => nowMs,
    authorizationTtlMs: 1_000,
    approvalSecret,
    verifierSecret,
    sessionContext: sessionContext()
  });
  return {
    dataDirectory,
    ledger,
    protocol,
    approvalSecret,
    verifierSecret,
    advance(ms) {
      nowMs += ms;
    },
    setNow(iso) {
      nowMs = Date.parse(iso);
    }
  };
}

function spawnDispatchWorker(config) {
  const child = spawn(
    process.execPath,
    ["-e", CROSS_PROCESS_DISPATCH_WORKER, JSON.stringify(config)],
    {
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true
    }
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  let readyResolve;
  let readyReject;
  let resultResolve;
  let resultReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const result = new Promise((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  let settled = false;
  child.on("message", (message) => {
    if (message && message.type === "ready") readyResolve();
    if (message && message.type === "result") {
      settled = true;
      resultResolve(message.payload);
    }
  });
  child.on("error", (error) => {
    readyReject(error);
    resultReject(error);
  });
  child.on("exit", (code) => {
    if (code !== 0 || !settled) {
      const error = new Error(
        `dispatch worker exited ${code}; stderr=${stderr.trim() || "<empty>"}`
      );
      readyReject(error);
      resultReject(error);
    }
  });
  return { child, ready, result };
}

function declare(f, procedure, suffix) {
  return f.protocol.declare({
    action: catalogueAction(procedure),
    idempotencyKey: `race-${procedure}-${suffix}`,
    campaign: "holland-race-test",
    version: ACTION_BINDING_SCHEMA,
    preObservation: preObservation(`observation-${procedure}-${suffix}`)
  });
}

function signedApproval(f, declaration) {
  const approval = {
    approvalId: crypto.randomUUID(),
    declarationId: declaration.declarationId,
    actionDigest: declaration.actionDigest,
    catalogId: declaration.catalogId,
    catalogEntryDigest: declaration.catalogEntryDigest,
    preObservationId: declaration.preObservation.id,
    preObservationSha256: declaration.preObservation.evidenceSha256,
    rehearsalId: "race-rehearsal",
    countryId: "HOL",
    sessionFingerprintSha256: declaration.sessionFingerprintSha256,
    gameBuild: "1.0.2",
    modVersion: "0.3.1",
    modManifestSha256: MOD_HASH,
    seedSaveSha256: SAVE_HASH,
    campaign: "holland-race-test",
    version: ACTION_BINDING_SCHEMA,
    expiresAtUtc: "2026-07-26T10:00:00.900Z"
  };
  approval.signature = crypto
    .createHmac("sha256", f.approvalSecret)
    .update(approvalPayload(approval))
    .digest("hex");
  return approval;
}

function authorize(f, declaration) {
  return f.protocol.authorize({
    declarationId: declaration.declarationId,
    approval: signedApproval(f, declaration)
  });
}

function conclusiveOutcome(f, dispatch, declaration, suffix) {
  return f.protocol.outcome({
    dispatchId: dispatch.dispatchId,
    acknowledged: true,
    evidenceConclusive: true,
    actualVisibleResult: declaration.action.expectedVisibleResult,
    observedAtUtc: `2026-07-26T10:00:00.${suffix}00Z`,
    evidence: {
      reference: `manual:race-${suffix}`,
      sha256: String(suffix).repeat(64)
    }
  });
}

function signedRecovery(f, outcomeId, recoveryId = crypto.randomUUID()) {
  const recovery = {
    schemaVersion: "eu5.action-family-recovery/v1",
    recoveryId,
    rehearsalId: "race-rehearsal",
    campaignId: "holland-race-test",
    countryId: "HOL",
    actionFamily: "economy",
    blockedOutcomeId: outcomeId,
    reason: "Human inspected the frozen test campaign and restored a known state.",
    approvedAtUtc: NOW_ISO
  };
  recovery.signature = crypto
    .createHmac("sha256", f.approvalSecret)
    .update(recoveryPayload(recovery))
    .digest("hex");
  return recovery;
}

function signedVerification(
  f,
  outcome,
  declaration,
  verificationId,
  verifiedAtUtc = outcome.observedAtUtc
) {
  const verification = {
    verificationId,
    outcomeId: outcome.outcomeId,
    declarationId: declaration.declarationId,
    evidenceSha256: outcome.evidence.sha256,
    outcomeObservedAtUtc: outcome.observedAtUtc,
    outcomeRecordHash: outcome.recordHash,
    result: "verified",
    verifiedAtUtc
  };
  verification.signature = crypto
    .createHmac("sha256", f.verifierSecret)
    .update(verificationPayload(verification))
    .digest("hex");
  return verification;
}

test("dispatch locked guard rejects a family frozen immediately before append", (t) => {
  const f = fixture(t);
  const blocker = declare(f, "economy", "blocker");
  const blockerDispatch = f.protocol.dispatch({
    authorizationId: authorize(f, blocker).authorizationId
  });
  const target = declare(f, "economy", "target");
  const targetAuthorization = authorize(f, target);
  f.advance(100);

  f.ledger.armAppendOnce(
    (event) => event.type === "dispatched" &&
      event.authorizationId === targetAuthorization.authorizationId,
    () => {
      f.protocol.outcome({
        dispatchId: blockerDispatch.dispatchId,
        acknowledged: false,
        evidenceConclusive: false,
        observedAtUtc: "2026-07-26T10:00:00.100Z"
      });
    }
  );

  assert.throws(
    () => f.protocol.dispatch({ authorizationId: targetAuthorization.authorizationId }),
    /family economy is frozen/
  );
  assert.equal(
    f.protocol.events().some(
      (event) =>
        event.type === "dispatched" &&
        event.authorizationId === targetAuthorization.authorizationId
    ),
    false
  );
});

test("competing outcomes append once and conflicting evidence is rejected", (t) => {
  const f = fixture(t);
  const declaration = declare(f, "economy", "outcome");
  const dispatch = f.protocol.dispatch({
    authorizationId: authorize(f, declaration).authorizationId
  });
  const winning = {
    dispatchId: dispatch.dispatchId,
    acknowledged: true,
    evidenceConclusive: true,
    actualVisibleResult: declaration.action.expectedVisibleResult,
    observedAtUtc: "2026-07-26T10:00:00.100Z",
    evidence: { reference: "manual:winning", sha256: "a".repeat(64) }
  };
  const losing = {
    ...winning,
    observedAtUtc: "2026-07-26T10:00:00.200Z",
    evidence: { reference: "manual:losing", sha256: "b".repeat(64) }
  };
  f.advance(200);

  f.ledger.armAppendOnce(
    (event) => event.type === "outcome" && event.dispatchId === dispatch.dispatchId,
    () => f.protocol.outcome(winning)
  );

  assert.throws(() => f.protocol.outcome(losing), /already recorded differently/);
  const outcomes = f.protocol.events().filter(
    (event) => event.type === "outcome" && event.dispatchId === dispatch.dispatchId
  );
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].evidence.reference, "manual:winning");
  assert.equal(f.protocol.outcome(winning).idempotent, true);
});

test("one blocked outcome cannot be recovered by different signed artifacts", (t) => {
  const f = fixture(t);
  const declaration = declare(f, "economy", "recovery");
  const dispatch = f.protocol.dispatch({
    authorizationId: authorize(f, declaration).authorizationId
  });
  f.advance(100);
  const outcome = f.protocol.outcome({
    dispatchId: dispatch.dispatchId,
    acknowledged: false,
    evidenceConclusive: false,
    observedAtUtc: "2026-07-26T10:00:00.100Z"
  });
  const winner = signedRecovery(f, outcome.outcomeId);
  const loser = signedRecovery(f, outcome.outcomeId);

  f.ledger.armAppendOnce(
    (event) => event.type === "family_recovered" &&
      event.blockedOutcomeId === outcome.outcomeId,
    () => f.protocol.recoverFamily({ actionFamily: "economy", recovery: winner })
  );

  assert.throws(
    () => f.protocol.recoverFamily({ actionFamily: "economy", recovery: loser }),
    /already recovered with a different artifact/
  );
  const recoveries = f.protocol.events().filter(
    (event) =>
      event.type === "family_recovered" &&
      event.blockedOutcomeId === outcome.outcomeId
  );
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].recoveryId, winner.recoveryId);
});

test("one verifier artifact identity cannot verify two outcomes", (t) => {
  const f = fixture(t);
  const firstDeclaration = declare(f, "economy", "verify-first");
  const firstDispatch = f.protocol.dispatch({
    authorizationId: authorize(f, firstDeclaration).authorizationId
  });
  f.advance(100);
  const firstOutcome = conclusiveOutcome(f, firstDispatch, firstDeclaration, 1);
  const secondDeclaration = declare(f, "diplomacy", "verify-second");
  const secondDispatch = f.protocol.dispatch({
    authorizationId: authorize(f, secondDeclaration).authorizationId
  });
  f.advance(100);
  const secondOutcome = conclusiveOutcome(f, secondDispatch, secondDeclaration, 2);
  const verificationId = crypto.randomUUID();
  const firstArtifact = signedVerification(
    f,
    f.protocol.events().find((event) => event.outcomeId === firstOutcome.outcomeId),
    firstDeclaration,
    verificationId
  );
  const secondArtifact = signedVerification(
    f,
    f.protocol.events().find((event) => event.outcomeId === secondOutcome.outcomeId),
    secondDeclaration,
    verificationId
  );

  assert.throws(
    () => f.protocol.verify({
      outcomeId: secondOutcome.outcomeId,
      verification: firstArtifact
    }),
    /does not bind this exact outcome/
  );
  f.ledger.armAppendOnce(
    (event) => event.type === "verified" && event.outcomeId === secondOutcome.outcomeId,
    () => f.protocol.verify({
      outcomeId: firstOutcome.outcomeId,
      verification: firstArtifact
    })
  );

  assert.throws(
    () => f.protocol.verify({
      outcomeId: secondOutcome.outcomeId,
      verification: secondArtifact
    }),
    /verification artifact was already used/
  );
  const verified = f.protocol.events().filter(
    (event) => event.type === "verified" && event.verified === true
  );
  assert.equal(verified.length, 1);
  assert.equal(verified[0].outcomeId, firstOutcome.outcomeId);
  assert.equal(verified[0].verificationId, verificationId);
});

test("outcome chronology rejects observations before dispatch and in the future", (t) => {
  const f = fixture(t);
  const declaration = declare(f, "economy", "outcome-chronology");
  const authorization = authorize(f, declaration);
  f.advance(200);
  const dispatch = f.protocol.dispatch({
    authorizationId: authorization.authorizationId
  });
  const base = {
    dispatchId: dispatch.dispatchId,
    acknowledged: true,
    evidenceConclusive: true,
    actualVisibleResult: declaration.action.expectedVisibleResult,
    evidence: {
      reference: "manual:chronology",
      sha256: "c".repeat(64)
    }
  };

  assert.throws(
    () => f.protocol.outcome({
      ...base,
      observedAtUtc: "2026-07-26T10:00:00.100Z"
    }),
    /predates dispatch|before.*dispatch|chronolog/i
  );
  assert.throws(
    () => f.protocol.outcome({
      ...base,
      observedAtUtc: new Date(
        Date.parse("2026-07-26T10:00:00.200Z") +
        MAX_EVENT_CLOCK_SKEW_MS +
        1
      ).toISOString()
    }),
    /clock tolerance|future|chronolog/i
  );
  assert.equal(
    f.protocol.events().filter(
      (event) => event.type === "outcome" && event.dispatchId === dispatch.dispatchId
    ).length,
    0
  );

  f.advance(100);
  assert.equal(
    f.protocol.outcome({
      ...base,
      observedAtUtc: "2026-07-26T10:00:00.300Z"
    }).state,
    "outcome_recorded"
  );
});

test("same-family dispatch race admits one pending dispatch until its terminal outcome", (t) => {
  const f = fixture(t);
  const firstDeclaration = declare(f, "economy", "serialized-first");
  const secondDeclaration = declare(f, "economy", "serialized-second");
  const firstAuthorization = authorize(f, firstDeclaration);
  const secondAuthorization = authorize(f, secondDeclaration);
  let winningDispatch;

  f.ledger.armAppendOnce(
    (event) =>
      event.type === "dispatched" &&
      event.authorizationId === firstAuthorization.authorizationId,
    () => {
      winningDispatch = f.protocol.dispatch({
        authorizationId: secondAuthorization.authorizationId
      });
    }
  );

  assert.throws(
    () => f.protocol.dispatch({
      authorizationId: firstAuthorization.authorizationId
    }),
    /pending|in[- ]flight|active dispatch/i
  );
  assert.equal(winningDispatch.state, "dispatch_prepared");
  assert.equal(
    f.protocol.events().filter(
      (event) => event.type === "dispatched" && event.actionFamily === "economy"
    ).length,
    1
  );
  assert.throws(
    () => f.protocol.dispatch({
      authorizationId: firstAuthorization.authorizationId
    }),
    /pending|in[- ]flight|active dispatch/i
  );

  f.advance(100);
  const winningOutcome = conclusiveOutcome(
    f,
    winningDispatch,
    secondDeclaration,
    1
  );
  assert.throws(
    () => f.protocol.dispatch({
      authorizationId: firstAuthorization.authorizationId
    }),
    /pending/
  );
  const ledgerOutcome = f.protocol.events().find(
    (event) => event.type === "outcome" && event.outcomeId === winningOutcome.outcomeId
  );
  f.protocol.verify({
    outcomeId: winningOutcome.outcomeId,
    verification: signedVerification(
      f,
      ledgerOutcome,
      secondDeclaration,
      crypto.randomUUID(),
      "2026-07-26T10:00:00.100Z"
    )
  });
  const nextDispatch = f.protocol.dispatch({
    authorizationId: firstAuthorization.authorizationId
  });
  assert.equal(nextDispatch.state, "dispatch_prepared");
  assert.equal(
    f.protocol.events().filter(
      (event) => event.type === "dispatched" && event.actionFamily === "economy"
    ).length,
    2
  );
});

test("cross-process same-family dispatch race admits exactly one pending dispatch", async (t) => {
  const f = fixture(t);
  const firstDeclaration = declare(f, "economy", "process-first");
  const secondDeclaration = declare(f, "economy", "process-second");
  const firstAuthorization = authorize(f, firstDeclaration);
  const secondAuthorization = authorize(f, secondDeclaration);
  const common = {
    dataDirectory: f.dataDirectory,
    nowMs: Date.parse(NOW_ISO),
    approvalSecret: f.approvalSecret,
    verifierSecret: f.verifierSecret,
    sessionContext: sessionContext(),
    ledgerModule: path.resolve(__dirname, "../src/control/control-ledger.js"),
    protocolModule: path.resolve(__dirname, "../src/control/control-protocol.js")
  };
  const firstWorker = spawnDispatchWorker({
    ...common,
    authorizationId: firstAuthorization.authorizationId
  });
  const secondWorker = spawnDispatchWorker({
    ...common,
    authorizationId: secondAuthorization.authorizationId
  });
  t.after(() => {
    if (firstWorker.child.exitCode === null) firstWorker.child.kill();
    if (secondWorker.child.exitCode === null) secondWorker.child.kill();
  });

  await Promise.all([firstWorker.ready, secondWorker.ready]);
  firstWorker.child.send({ type: "go" });
  secondWorker.child.send({ type: "go" });
  const results = await Promise.all([firstWorker.result, secondWorker.result]);
  const successes = results.filter((entry) => entry.ok);
  const rejections = results.filter((entry) => !entry.ok);

  assert.equal(successes.length, 1);
  assert.equal(successes[0].result.state, "dispatch_prepared");
  assert.equal(successes[0].result.externalExecutionRequired, true);
  assert.equal(rejections.length, 1);
  assert.match(rejections[0].error, /family economy already has pending dispatch/);
  const dispatches = f.protocol.events().filter(
    (event) => event.type === "dispatched" && event.actionFamily === "economy"
  );
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].dispatchId, successes[0].result.dispatchId);
});

test("verification chronology is enforced before and during replay handling", (t) => {
  const f = fixture(t);
  const declaration = declare(f, "economy", "verification-chronology");
  const dispatch = f.protocol.dispatch({
    authorizationId: authorize(f, declaration).authorizationId
  });
  f.advance(300);
  const outcome = conclusiveOutcome(f, dispatch, declaration, 3);
  const ledgerOutcome = f.protocol.events().find(
    (event) => event.type === "outcome" && event.outcomeId === outcome.outcomeId
  );
  const verificationId = crypto.randomUUID();
  const premature = signedVerification(
    f,
    ledgerOutcome,
    declaration,
    verificationId,
    "2026-07-26T10:00:00.200Z"
  );

  assert.throws(
    () => f.protocol.verify({
      outcomeId: outcome.outcomeId,
      verification: premature
    }),
    /predates.*outcome|before.*outcome|chronolog/i
  );
  assert.equal(
    f.protocol.events().some(
      (event) => event.type === "verified" && event.outcomeId === outcome.outcomeId
    ),
    false
  );

  const valid = signedVerification(
    f,
    ledgerOutcome,
    declaration,
    verificationId,
    "2026-07-26T10:00:00.300Z"
  );
  assert.equal(
    f.protocol.verify({ outcomeId: outcome.outcomeId, verification: valid }).state,
    "verified"
  );
  assert.throws(
    () => f.protocol.verify({
      outcomeId: outcome.outcomeId,
      verification: premature
    }),
    /predates.*outcome|before.*outcome|chronolog/i
  );
  assert.equal(
    f.protocol.verify({ outcomeId: outcome.outcomeId, verification: valid }).idempotent,
    true
  );
});
