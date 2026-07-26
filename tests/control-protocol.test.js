"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ControlLedger } = require("../src/control/control-ledger");
const { catalogueAction } = require("../src/control/action-gate");
const { CATALOG_ID } = require("../src/control/control-procedure-catalog");
const {
  ACTION_BINDING_SCHEMA,
  ControlProtocol,
  approvalPayload,
  recoveryPayload,
  verificationPayload
} = require("../src/control/control-protocol");
const {
  assessLedgerCompleteness,
  verifyLedgerHashChain
} = require("../src/stream/rehearsal-acceptance");

const MOD_HASH = "1".repeat(64);
const SAVE_HASH = "2".repeat(64);
const OBSERVATION_HASH = "3".repeat(64);

function sessionContext(overrides = {}) {
  return {
    schemaVersion: "eu5.rehearsal-session/v1",
    rehearsalId: "stream-rehearsal-1",
    campaignId: "holland-test",
    countryId: "HOL",
    gameBuild: "1.0.2",
    modVersion: "0.3.1",
    modManifestSha256: MOD_HASH,
    seedSaveSha256: SAVE_HASH,
    ...overrides
  };
}

function preObservation(overrides = {}) {
  return {
    schemaVersion: "eu5.pre-observation/v1",
    id: "observation-1",
    capturedAtUtc: "2026-07-26T10:00:00.000Z",
    evidenceSha256: OBSERVATION_HASH,
    ...sessionContext(),
    schemaVersion: "eu5.pre-observation/v1",
    ...overrides
  };
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-control-ledger-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = Date.parse("2026-07-26T10:00:00.000Z");
  const secret = "supervisor-secret";
  const verifierSecret = "independent-verifier-secret";
  const protocol = new ControlProtocol({
    ledger: new ControlLedger({ dataDirectory: dir }),
    now: () => now,
    approvalSecret: secret,
    verifierSecret,
    authorizationTtlMs: 1_000,
    sessionContext: sessionContext()
  });
  const protocolDeclare = protocol.declare.bind(protocol);
  protocol.declare = (input) => protocolDeclare({
    ...input,
    preObservation: input.preObservation || preObservation()
  });
  return {
    dir,
    secret,
    verifierSecret,
    protocol,
    advance(ms) { now += ms; },
    action: catalogueAction("economy")
  };
}
function sign(f, declaration, extra = {}) {
  const approval = {
    approvalId: crypto.randomUUID(),
    declarationId: declaration.declarationId,
    actionDigest: declaration.actionDigest,
    catalogId: declaration.catalogId,
    catalogEntryDigest: declaration.catalogEntryDigest,
    preObservationId: declaration.preObservation.id,
    preObservationSha256: declaration.preObservation.evidenceSha256,
    rehearsalId: "stream-rehearsal-1",
    countryId: "HOL",
    sessionFingerprintSha256: declaration.sessionFingerprintSha256,
    gameBuild: "1.0.2",
    modVersion: "0.3.1",
    modManifestSha256: MOD_HASH,
    seedSaveSha256: SAVE_HASH,
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA,
    expiresAtUtc: "2026-07-26T10:00:00.900Z",
    ...extra
  };
  approval.signature = crypto.createHmac("sha256", f.secret).update(approvalPayload(approval)).digest("hex");
  return approval;
}
function verifySign(f, outcome, declaration, extra = {}) {
  const ledgerOutcome = f.protocol.events().find(
    (event) => event.type === "outcome" && event.outcomeId === outcome.outcomeId
  );
  const verification = {
    verificationId: crypto.randomUUID(),
    outcomeId: outcome.outcomeId,
    declarationId: declaration.declarationId,
    evidenceSha256: "a".repeat(64),
    outcomeObservedAtUtc: ledgerOutcome.observedAtUtc,
    outcomeRecordHash: ledgerOutcome.recordHash,
    result: "verified",
    verifiedAtUtc: ledgerOutcome.observedAtUtc,
    ...extra
  };
  verification.signature = crypto
    .createHmac("sha256", f.verifierSecret)
    .update(verificationPayload(verification))
    .digest("hex");
  return verification;
}
function recoverySign(f, outcomeId, extra = {}) {
  const recovery = {
    schemaVersion: "eu5.action-family-recovery/v1",
    recoveryId: crypto.randomUUID(),
    rehearsalId: "stream-rehearsal-1",
    campaignId: "holland-test",
    countryId: "HOL",
    actionFamily: "economy",
    blockedOutcomeId: outcomeId,
    reason: "Human inspected the game and restored a known paused screen.",
    approvedAtUtc: "2026-07-26T10:00:00.000Z",
    ...extra
  };
  recovery.signature = crypto
    .createHmac("sha256", f.secret)
    .update(recoveryPayload(recovery))
    .digest("hex");
  return recovery;
}

test("lifecycle requires independently signed approval and is record-only", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({ action: f.action, idempotencyKey: "economy-1", campaign: "holland-test", version: ACTION_BINDING_SCHEMA });
  const authorization = f.protocol.authorize({ declarationId: declared.declarationId, approval: sign(f, declared) });
  const dispatched = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  assert.equal(dispatched.uiInputExecuted, false);
  const outcome = f.protocol.outcome({ dispatchId: dispatched.dispatchId, acknowledged: true, evidenceConclusive: true, actualVisibleResult: f.action.expectedVisibleResult, observedAtUtc: "2026-07-26T10:00:00.100Z", evidence: { reference: "manual:screenshot-1", sha256: "a".repeat(64) } });
  assert.equal(f.protocol.verify({ outcomeId: outcome.outcomeId }).state, "attested_untrusted");
  assert.deepEqual(
    f.protocol.events().map((event) => event.type),
    ["declared", "gated", "confirmed", "authorized", "dispatched", "outcome", "verified"]
  );
});

test("self approval, replayed approvals, and false positive verification are rejected", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({ action: f.action, idempotencyKey: "economy-2", campaign: "holland-test", version: ACTION_BINDING_SCHEMA });
  assert.throws(() => f.protocol.authorize({ declarationId: declared.declarationId, approval: { ...sign(f, declared), signature: "0".repeat(64) } }), /signature/);
  const approval = sign(f, declared);
  const authorization = f.protocol.authorize({ declarationId: declared.declarationId, approval });
  assert.throws(() => f.protocol.authorize({ declarationId: declared.declarationId, approval }), /already used/);
  const dispatched = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  const outcome = f.protocol.outcome({ dispatchId: dispatched.dispatchId, acknowledged: true, evidenceConclusive: true, actualVisibleResult: "Unexpected modal", observedAtUtc: "2026-07-26T10:00:00.100Z", evidence: { reference: "manual:screenshot-2", sha256: "b".repeat(64) } });
  const result = f.protocol.verify({ outcomeId: outcome.outcomeId });
  assert.equal(result.state, "verification_failed");
  assert.equal(result.stopRequired, true);
});

test("one declaration has exactly one authorization transition", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({
    action: f.action,
    idempotencyKey: "single-authorization",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  const firstApproval = sign(f, declared);
  f.protocol.authorize({
    declarationId: declared.declarationId,
    approval: firstApproval
  });
  assert.throws(
    () => f.protocol.authorize({
      declarationId: declared.declarationId,
      approval: sign(f, declared)
    }),
    /declaration is already authorized/
  );
  const lifecycle = f.protocol.events().filter(
    (event) => event.declarationId === declared.declarationId
  );
  assert.equal(lifecycle.filter((event) => event.type === "gated").length, 1);
  assert.equal(lifecycle.filter((event) => event.type === "confirmed").length, 1);
  assert.equal(lifecycle.filter((event) => event.type === "authorized").length, 1);

  const second = f.protocol.declare({
    action: catalogueAction("diplomacy"),
    idempotencyKey: "approval-id-global",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  assert.throws(
    () => f.protocol.authorize({
      declarationId: second.declarationId,
      approval: sign(f, second, { approvalId: firstApproval.approvalId })
    }),
    /approval artifact was already used/
  );
});

test("spoofed allowlisted adapter metadata never creates a verified ledger state", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({ action: f.action, idempotencyKey: "economy-3", campaign: "holland-test", version: ACTION_BINDING_SCHEMA });
  const authorization = f.protocol.authorize({ declarationId: declared.declarationId, approval: sign(f, declared) });
  const dispatched = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  const outcome = f.protocol.outcome({ dispatchId: dispatched.dispatchId, acknowledged: true, evidenceConclusive: true, actualVisibleResult: f.action.expectedVisibleResult, observedAtUtc: "2026-07-26T10:00:00.100Z", evidence: { reference: "caller:claimed-adapter", sha256: "c".repeat(64), adapterId: "official", adapterVersion: "1" } });
  const result = f.protocol.verify({ outcomeId: outcome.outcomeId });
  assert.deepEqual(result, {
    outcomeId: outcome.outcomeId,
    state: "attested_untrusted",
    verified: false,
    idempotent: false,
    stopRequired: true,
    automaticRetryAllowed: false
  });
  assert.equal(f.protocol.events().some((event) => event.type === "verified" && event.state === "verified"), false);
});

test("missing external acknowledgement records execution_unknown and freezes retries", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({
    action: f.action,
    idempotencyKey: "economy-unknown-ack",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  const authorization = f.protocol.authorize({
    declarationId: declared.declarationId,
    approval: sign(f, declared)
  });
  const dispatched = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  const outcome = f.protocol.outcome({
    dispatchId: dispatched.dispatchId,
    acknowledged: false,
    evidenceConclusive: false,
    observedAtUtc: "2026-07-26T10:00:00.100Z"
  });

  assert.equal(outcome.state, "execution_unknown");
  assert.equal(outcome.stopRequired, true);
  assert.equal(outcome.automaticRetryAllowed, false);
  assert.equal(outcome.requiresFreshDeclarationForRetry, true);

  const verified = f.protocol.verify({ outcomeId: outcome.outcomeId });
  assert.equal(verified.state, "execution_unknown");
  assert.equal(verified.verified, false);
  assert.equal(verified.stopRequired, true);
  assert.equal(verified.automaticRetryAllowed, false);
  assert.throws(
    () => f.protocol.verify({
      outcomeId: outcome.outcomeId,
      verification: {
        verificationId: crypto.randomUUID()
      }
    }),
    /cannot accept verification artifacts/
  );

  const ledgerOutcome = f.protocol.events().find((event) => event.outcomeId === outcome.outcomeId);
  assert.equal(ledgerOutcome.acknowledged, false);
  assert.equal(ledgerOutcome.evidence, null);
});

test("execution_unknown freezes the exact family until signed human recovery", (t) => {
  const f = fixture(t);
  const first = f.protocol.declare({
    action: f.action,
    idempotencyKey: "economy-freeze-first",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  const authorization = f.protocol.authorize({
    declarationId: first.declarationId,
    approval: sign(f, first)
  });
  const dispatched = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  const outcome = f.protocol.outcome({
    dispatchId: dispatched.dispatchId,
    acknowledged: false,
    evidenceConclusive: false,
    observedAtUtc: "2026-07-26T10:00:00.100Z"
  });

  assert.throws(
    () => f.protocol.declare({
      action: f.action,
      idempotencyKey: "economy-freeze-second",
      campaign: "holland-test",
      version: ACTION_BINDING_SCHEMA
    }),
    /family economy is frozen/
  );
  const diplomacy = f.protocol.declare({
    action: catalogueAction("diplomacy"),
    idempotencyKey: "diplomacy-not-frozen",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  assert.equal(diplomacy.action.actionFamily, "diplomacy");

  const recovery = recoverySign(f, outcome.outcomeId);
  assert.equal(
    f.protocol.recoverFamily({ actionFamily: "economy", recovery }).state,
    "family_recovered"
  );
  assert.equal(
    f.protocol.recoverFamily({ actionFamily: "economy", recovery }).idempotent,
    true
  );
  const afterRecovery = f.protocol.declare({
    action: f.action,
    idempotencyKey: "economy-after-recovery",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  assert.equal(afterRecovery.state, "declared");
});

test("one pending action and each later unknown require recovery before family reuse", (t) => {
  const f = fixture(t);
  const declarations = ["first", "second"].map((suffix) =>
    f.protocol.declare({
      action: f.action,
      idempotencyKey: `multi-unknown-${suffix}`,
      campaign: "holland-test",
      version: ACTION_BINDING_SCHEMA
    })
  );
  const authorizations = declarations.map((declaration) =>
    f.protocol.authorize({
      declarationId: declaration.declarationId,
      approval: sign(f, declaration)
    })
  );
  const firstDispatch = f.protocol.dispatch({
    authorizationId: authorizations[0].authorizationId
  });
  assert.throws(
    () => f.protocol.dispatch({
      authorizationId: authorizations[1].authorizationId
    }),
    /pending dispatch/
  );
  const firstOutcome = f.protocol.outcome({
    dispatchId: firstDispatch.dispatchId,
    acknowledged: false,
    evidenceConclusive: false,
    observedAtUtc: "2026-07-26T10:00:00.100Z"
  });
  assert.throws(
    () => f.protocol.dispatch({
      authorizationId: authorizations[1].authorizationId
    }),
    new RegExp(firstOutcome.outcomeId)
  );
  f.protocol.recoverFamily({
    actionFamily: "economy",
    recovery: recoverySign(f, firstOutcome.outcomeId)
  });
  const secondDispatch = f.protocol.dispatch({
    authorizationId: authorizations[1].authorizationId
  });
  const secondOutcome = f.protocol.outcome({
    dispatchId: secondDispatch.dispatchId,
    acknowledged: false,
    evidenceConclusive: false,
    observedAtUtc: "2026-07-26T10:00:00.200Z"
  });
  f.protocol.recoverFamily({
    actionFamily: "economy",
    recovery: recoverySign(f, secondOutcome.outcomeId)
  });
  assert.equal(
    f.protocol.declare({
      action: f.action,
      idempotencyKey: "all-recovered",
      campaign: "holland-test",
      version: ACTION_BINDING_SCHEMA
    }).state,
    "declared"
  );
});

test("ambiguous and failed verification freeze their action family until signed recovery", (t) => {
  for (const scenario of [
    {
      suffix: "ambiguous",
      visibleResult: null,
      expectedState: "attested_untrusted",
      expectedLifecycle: "ambiguous"
    },
    {
      suffix: "failed",
      visibleResult: "Unexpected modal",
      expectedState: "verification_failed",
      expectedLifecycle: "failed"
    }
  ]) {
    const f = fixture(t);
    const declared = f.protocol.declare({
      action: f.action,
      idempotencyKey: `freeze-${scenario.suffix}`,
      campaign: "holland-test",
      version: ACTION_BINDING_SCHEMA
    });
    const authorization = f.protocol.authorize({
      declarationId: declared.declarationId,
      approval: sign(f, declared)
    });
    const dispatched = f.protocol.dispatch({
      authorizationId: authorization.authorizationId
    });
    const outcome = f.protocol.outcome({
      dispatchId: dispatched.dispatchId,
      acknowledged: true,
      evidenceConclusive: true,
      actualVisibleResult:
        scenario.visibleResult === null
          ? f.action.expectedVisibleResult
          : scenario.visibleResult,
      observedAtUtc: "2026-07-26T10:00:00.100Z",
      evidence: {
        reference: `manual:${scenario.suffix}`,
        sha256: "a".repeat(64)
      }
    });
    const verification = f.protocol.verify({ outcomeId: outcome.outcomeId });
    assert.equal(verification.state, scenario.expectedState);
    assert.equal(
      f.protocol.events().find(
        (event) => event.type === "verified" && event.outcomeId === outcome.outcomeId
      ).lifecycleState,
      scenario.expectedLifecycle
    );
    assert.throws(
      () => f.protocol.declare({
        action: f.action,
        idempotencyKey: `blocked-${scenario.suffix}`,
        campaign: "holland-test",
        version: ACTION_BINDING_SCHEMA
      }),
      /family economy is frozen/
    );
    f.protocol.recoverFamily({
      actionFamily: "economy",
      recovery: recoverySign(f, outcome.outcomeId)
    });
    assert.equal(
      f.protocol.declare({
        action: f.action,
        idempotencyKey: `recovered-${scenario.suffix}`,
        campaign: "holland-test",
        version: ACTION_BINDING_SCHEMA
      }).state,
      "declared"
    );
  }
});

test("duplicate dispatch never reissues an external execution instruction", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({
    action: f.action,
    idempotencyKey: "dispatch-idempotency",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  const authorization = f.protocol.authorize({
    declarationId: declared.declarationId,
    approval: sign(f, declared)
  });
  const first = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  const duplicate = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  assert.equal(first.externalExecutionRequired, true);
  assert.equal(duplicate.dispatchId, first.dispatchId);
  assert.equal(duplicate.state, "already_dispatched");
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.externalExecutionRequired, false);
  assert.equal(
    f.protocol.events().filter((event) => event.type === "dispatched").length,
    1
  );
});

test("declaration and approval bind catalogue, build, mod, save and fresh pre-observation", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.protocol.declare({
      action: f.action,
      idempotencyKey: "unpinned-version",
      campaign: "holland-test",
      version: "caller-selected-version"
    }),
    /pinned action schema/
  );
  assert.throws(
    () => f.protocol.declare({
      action: f.action,
      idempotencyKey: "mismatched-build",
      campaign: "holland-test",
      version: ACTION_BINDING_SCHEMA,
      preObservation: preObservation({ gameBuild: "unexpected-build" })
    }),
    /gameBuild does not match/
  );

  const declared = f.protocol.declare({
    action: f.action,
    idempotencyKey: "binding-approval",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  for (const mutation of [
    { catalogEntryDigest: "f".repeat(64) },
    { preObservationSha256: "e".repeat(64) },
    { gameBuild: "unexpected-build" },
    { modVersion: "unexpected-mod" },
    { modManifestSha256: "d".repeat(64) },
    { seedSaveSha256: "c".repeat(64) }
  ]) {
    assert.throws(
      () => f.protocol.authorize({
        declarationId: declared.declarationId,
        approval: sign(f, declared, mutation)
      }),
      /does not bind this exact declaration/
    );
  }

  f.advance(45_001);
  assert.throws(
    () => f.protocol.authorize({
      declarationId: declared.declarationId,
      approval: sign(f, declared, {
        expiresAtUtc: "2026-07-26T10:02:00.000Z"
      })
    }),
    /preObservation is not fresh/
  );
});

test("authorization rejects a validly chained declaration after catalogue drift", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-control-catalogue-drift-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = new ControlLedger({ dataDirectory: directory });
  const declarationId = crypto.randomUUID();
  const observation = preObservation();
  ledger.append({
    type: "declared",
    declarationId,
    idempotencyKey: "catalogue-drift",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA,
    action: catalogueAction("economy"),
    actionId: "eu5.open_economy",
    actionFamily: "economy",
    procedure: "economy",
    capability: "economy_decision",
    catalogId: CATALOG_ID,
    catalogEntryDigest: "0".repeat(64),
    preObservation: observation,
    preObservationId: observation.id,
    preObservationSha256: observation.evidenceSha256,
    actionDigest: "4".repeat(64),
    rehearsalId: "stream-rehearsal-1",
    campaignId: "holland-test",
    countryId: "HOL",
    gameBuild: "1.0.2",
    modVersion: "0.3.1",
    modManifestSha256: MOD_HASH,
    seedSaveSha256: SAVE_HASH,
    lifecycleState: "declared",
    verified: false
  }, { recordedAtUtc: "2026-07-26T10:00:00.000Z" });
  const protocol = new ControlProtocol({
    ledger,
    now: () => Date.parse("2026-07-26T10:00:00.000Z"),
    approvalSecret: "supervisor-secret",
    sessionContext: sessionContext()
  });
  assert.throws(
    () => protocol.authorize({ declarationId, approval: {} }),
    /catalogue entry drifted/
  );
});

test("omitting acknowledgement cannot be inferred from a claimed visible result", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({
    action: f.action,
    idempotencyKey: "economy-missing-ack",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  const authorization = f.protocol.authorize({
    declarationId: declared.declarationId,
    approval: sign(f, declared)
  });
  const dispatched = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  const outcome = f.protocol.outcome({
    dispatchId: dispatched.dispatchId,
    evidenceConclusive: true,
    actualVisibleResult: f.action.expectedVisibleResult,
    observedAtUtc: "2026-07-26T10:00:00.100Z",
    evidence: { reference: "manual:screenshot-unacknowledged", sha256: "e".repeat(64) }
  });
  assert.equal(outcome.state, "execution_unknown");
  assert.equal(outcome.stopRequired, true);
});

test("inconclusive external evidence is immutable and cannot be replaced by a retry", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({
    action: f.action,
    idempotencyKey: "economy-unknown-evidence",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  const authorization = f.protocol.authorize({
    declarationId: declared.declarationId,
    approval: sign(f, declared)
  });
  const dispatched = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  const input = {
    dispatchId: dispatched.dispatchId,
    acknowledged: true,
    evidenceConclusive: false,
    actualVisibleResult: "Economy panel may be open.",
    observedAtUtc: "2026-07-26T10:00:00.100Z",
    evidence: { reference: "manual:screenshot-unknown", sha256: "d".repeat(64) }
  };
  const outcome = f.protocol.outcome(input);
  assert.equal(f.protocol.outcome(input).idempotent, true);
  assert.equal(outcome.state, "execution_unknown");
  assert.throws(
    () => f.protocol.outcome({
      ...input,
      evidenceConclusive: true,
      actualVisibleResult: f.action.expectedVisibleResult
    }),
    /already recorded differently/
  );
});

test("outcome replay is canonical across evidence key order", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({
    action: f.action,
    idempotencyKey: "canonical-outcome",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  const dispatched = f.protocol.dispatch({
    authorizationId: f.protocol.authorize({
      declarationId: declared.declarationId,
      approval: sign(f, declared)
    }).authorizationId
  });
  const base = {
    dispatchId: dispatched.dispatchId,
    acknowledged: true,
    evidenceConclusive: true,
    actualVisibleResult: f.action.expectedVisibleResult,
    observedAtUtc: "2026-07-26T10:00:00.100Z"
  };
  const first = f.protocol.outcome({
    ...base,
    evidence: {
      reference: "manual:canonical",
      sha256: "c".repeat(64)
    }
  });
  const replay = f.protocol.outcome({
    ...base,
    evidence: {
      sha256: "c".repeat(64),
      reference: "manual:canonical"
    }
  });
  assert.equal(replay.outcomeId, first.outcomeId);
  assert.equal(replay.idempotent, true);
});

test("verified replay requires the exact same signed artifact", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({
    action: f.action,
    idempotencyKey: "exact-verification-replay",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  const dispatched = f.protocol.dispatch({
    authorizationId: f.protocol.authorize({
      declarationId: declared.declarationId,
      approval: sign(f, declared)
    }).authorizationId
  });
  const outcome = f.protocol.outcome({
    dispatchId: dispatched.dispatchId,
    acknowledged: true,
    evidenceConclusive: true,
    actualVisibleResult: f.action.expectedVisibleResult,
    observedAtUtc: "2026-07-26T10:00:00.100Z",
    evidence: { reference: "manual:verified-replay", sha256: "a".repeat(64) }
  });
  const artifact = verifySign(f, outcome, declared);
  assert.equal(
    f.protocol.verify({ outcomeId: outcome.outcomeId, verification: artifact }).verified,
    true
  );
  assert.equal(
    f.protocol.verify({ outcomeId: outcome.outcomeId, verification: artifact }).idempotent,
    true
  );
  assert.throws(
    () => f.protocol.verify({ outcomeId: outcome.outcomeId }),
    /different artifact/
  );
  assert.throws(
    () => f.protocol.verify({
      outcomeId: outcome.outcomeId,
      verification: { ...artifact, signature: "0".repeat(64) }
    }),
    /signature is invalid/
  );
  const different = verifySign(f, outcome, declared);
  assert.throws(
    () => f.protocol.verify({
      outcomeId: outcome.outcomeId,
      verification: different
    }),
    /different artifact/
  );
});

test("recovery replay requires the exact same signed artifact", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({
    action: f.action,
    idempotencyKey: "exact-recovery-replay",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  const dispatched = f.protocol.dispatch({
    authorizationId: f.protocol.authorize({
      declarationId: declared.declarationId,
      approval: sign(f, declared)
    }).authorizationId
  });
  const outcome = f.protocol.outcome({
    dispatchId: dispatched.dispatchId,
    acknowledged: false,
    evidenceConclusive: false,
    observedAtUtc: "2026-07-26T10:00:00.100Z"
  });
  const artifact = recoverySign(f, outcome.outcomeId);
  assert.equal(
    f.protocol.recoverFamily({ actionFamily: "economy", recovery: artifact }).idempotent,
    false
  );
  assert.equal(
    f.protocol.recoverFamily({ actionFamily: "economy", recovery: artifact }).idempotent,
    true
  );
  assert.throws(
    () => f.protocol.recoverFamily({
      actionFamily: "economy",
      recovery: { ...artifact, signature: "0".repeat(64) }
    }),
    /signature is invalid/
  );
  const changed = recoverySign(f, outcome.outcomeId, {
    recoveryId: artifact.recoveryId,
    reason: "A different signed recovery assertion."
  });
  assert.throws(
    () => f.protocol.recoverFamily({ actionFamily: "economy", recovery: changed }),
    /already used differently/
  );
});

test("real session-bound protocol ledger passes stream hash and lifecycle gates", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({
    action: f.action,
    idempotencyKey: "stream-economy-verified",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  const authorization = f.protocol.authorize({
    declarationId: declared.declarationId,
    approval: sign(f, declared)
  });
  const dispatched = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  const outcome = f.protocol.outcome({
    dispatchId: dispatched.dispatchId,
    acknowledged: true,
    evidenceConclusive: true,
    actualVisibleResult: f.action.expectedVisibleResult,
    observedAtUtc: "2026-07-26T10:00:00.000Z",
    evidence: { reference: "independent:screenshot-1", sha256: "a".repeat(64) }
  });
  const verified = f.protocol.verify({
    outcomeId: outcome.outcomeId,
    verification: verifySign(f, outcome, declared)
  });

  assert.equal(verified.state, "verified");
  assert.equal(verified.verified, true);
  const ledger = f.protocol.events();
  assert.equal(verifyLedgerHashChain(ledger).valid, true);
  const lifecycle = assessLedgerCompleteness(ledger);
  assert.equal(lifecycle.declarations, 1);
  assert.deepEqual(lifecycle.incomplete, []);
  assert.deepEqual(lifecycle.outOfOrder, []);
  assert.deepEqual(lifecycle.duplicateStates, []);
  assert.deepEqual(lifecycle.invalidTerminals, []);
  for (const record of ledger) {
    assert.equal(record.rehearsalId, "stream-rehearsal-1");
    assert.equal(record.campaignId, "holland-test");
    assert.equal(record.countryId, "HOL");
    assert.equal(record.declarationId, declared.declarationId);
    assert.equal(record.actionId, "eu5.open_economy");
    assert.equal(record.actionFamily, "economy");
    assert.equal(record.procedure, "economy");
    assert.equal(record.capability, "economy_decision");
  }
});

test("authorization TTL clamps a longer signed approval before dispatch", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({
    action: f.action,
    idempotencyKey: "ttl-clamp",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA
  });
  const authorization = f.protocol.authorize({
    declarationId: declared.declarationId,
    approval: sign(f, declared, {
      expiresAtUtc: "2026-07-26T10:01:00.000Z"
    })
  });
  assert.equal(authorization.expiresAtUtc, "2026-07-26T10:00:01.000Z");
  f.advance(1_001);
  assert.throws(
    () => f.protocol.dispatch({ authorizationId: authorization.authorizationId }),
    /authorization has expired/
  );
  const expired = f.protocol.events().filter(
    (event) =>
      event.type === "expired" &&
      event.authorizationId === authorization.authorizationId
  );
  assert.equal(expired.length, 1);
  assert.equal(expired[0].authorizationTtlMs, 1_000);
  assert.equal(expired[0].expiresAtMs, Date.parse("2026-07-26T10:00:01.000Z"));
  assert.equal(f.protocol.events().some((event) => event.type === "dispatched"), false);
});

test("authorization TTL expires across real tool latency", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-control-live-ttl-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secret = "live-ttl-secret";
  const protocol = new ControlProtocol({
    ledger: new ControlLedger({ dataDirectory: directory }),
    approvalSecret: secret,
    authorizationTtlMs: 25,
    sessionContext: sessionContext({ rehearsalId: "live-ttl-rehearsal" })
  });
  const declared = protocol.declare({
    action: catalogueAction("economy"),
    idempotencyKey: "live-ttl",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA,
    preObservation: preObservation({
      rehearsalId: "live-ttl-rehearsal",
      capturedAtUtc: new Date().toISOString()
    })
  });
  const approval = {
    approvalId: crypto.randomUUID(),
    declarationId: declared.declarationId,
    actionDigest: declared.actionDigest,
    catalogId: declared.catalogId,
    catalogEntryDigest: declared.catalogEntryDigest,
    preObservationId: declared.preObservation.id,
    preObservationSha256: declared.preObservation.evidenceSha256,
    rehearsalId: "live-ttl-rehearsal",
    countryId: "HOL",
    sessionFingerprintSha256: declared.sessionFingerprintSha256,
    gameBuild: "1.0.2",
    modVersion: "0.3.1",
    modManifestSha256: MOD_HASH,
    seedSaveSha256: SAVE_HASH,
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA,
    expiresAtUtc: new Date(Date.now() + 5_000).toISOString()
  };
  approval.signature = crypto
    .createHmac("sha256", secret)
    .update(approvalPayload(approval))
    .digest("hex");
  const authorization = protocol.authorize({
    declarationId: declared.declarationId,
    approval
  });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.throws(
    () => protocol.dispatch({ authorizationId: authorization.authorizationId }),
    /authorization has expired/
  );
});

test("authorization transition is not reported successful if its ledger batch fails", (t) => {
  class FailingAuthorizationLedger extends ControlLedger {
    appendManyOnce(events, options) {
      if (events.length === 3 && events.some((event) => event.type === "authorized")) {
        throw new Error("simulated authorization batch failure");
      }
      return super.appendManyOnce(events, options);
    }
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-control-batch-failure-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = Date.parse("2026-07-26T10:00:00.000Z");
  const protocol = new ControlProtocol({
    ledger: new FailingAuthorizationLedger({ dataDirectory: directory }),
    now: () => now,
    approvalSecret: "supervisor-secret",
    sessionContext: sessionContext()
  });
  const action = catalogueAction("economy");
  const declared = protocol.declare({
    action,
    idempotencyKey: "batch-failure",
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA,
    preObservation: preObservation()
  });
  const f = { secret: "supervisor-secret" };
  assert.throws(
    () => protocol.authorize({
      declarationId: declared.declarationId,
      approval: sign(f, declared)
    }),
    /simulated authorization batch failure/
  );
  assert.deepEqual(protocol.events().map((event) => event.lifecycleState), ["declared"]);
});

test("session-unbound protocol refuses executable lifecycle declarations", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-control-unbound-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const protocol = new ControlProtocol({
    ledger: new ControlLedger({ dataDirectory: directory }),
    approvalSecret: "supervisor-secret",
    sessionContext: null
  });
  assert.throws(
    () => protocol.declare({
      action: catalogueAction("economy"),
      idempotencyKey: "unbound-action",
      campaign: "holland-test",
      version: ACTION_BINDING_SCHEMA
    }),
    /requires rehearsal context/
  );
  assert.deepEqual(protocol.events(), []);
});
