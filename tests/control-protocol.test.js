"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ControlLedger } = require("../src/control/control-ledger");
const { ControlProtocol, approvalPayload } = require("../src/control/control-protocol");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-control-ledger-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = Date.parse("2026-07-26T10:00:00.000Z");
  const secret = "supervisor-secret";
  return { dir, secret, protocol: new ControlProtocol({ ledger: new ControlLedger({ dataDirectory: dir }), now: () => now, approvalSecret: secret, authorizationTtlMs: 1_000 }), advance(ms) { now += ms; }, action: { id: "eu5.open_economy", risk: "read_only", expectedVisibleResult: "Economy panel is open.", preconditions: ["Game is paused."] } };
}
function sign(f, declaration, extra = {}) {
  const approval = { approvalId: crypto.randomUUID(), declarationId: declaration.declarationId, actionDigest: declaration.actionDigest, campaign: "holland-test", version: "1", expiresAtUtc: "2026-07-26T10:00:00.900Z", ...extra };
  approval.signature = crypto.createHmac("sha256", f.secret).update(approvalPayload(approval)).digest("hex");
  return approval;
}

test("lifecycle requires independently signed approval and is record-only", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({ action: f.action, idempotencyKey: "economy-1", campaign: "holland-test", version: "1" });
  const authorization = f.protocol.authorize({ declarationId: declared.declarationId, approval: sign(f, declared) });
  const dispatched = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  assert.equal(dispatched.uiInputExecuted, false);
  const outcome = f.protocol.outcome({ dispatchId: dispatched.dispatchId, actualVisibleResult: "Economy panel is open.", observedAtUtc: "2026-07-26T10:00:00.100Z", evidence: { reference: "manual:screenshot-1", sha256: "a".repeat(64) } });
  assert.equal(f.protocol.verify({ outcomeId: outcome.outcomeId }).state, "attested_untrusted");
  assert.deepEqual(f.protocol.events().map((event) => event.type), ["declared", "authorized", "dispatched", "outcome", "verified"]);
});

test("self approval, replayed approvals, and false positive verification are rejected", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({ action: f.action, idempotencyKey: "economy-2", campaign: "holland-test", version: "1" });
  assert.throws(() => f.protocol.authorize({ declarationId: declared.declarationId, approval: { ...sign(f, declared), signature: "0".repeat(64) } }), /signature/);
  const approval = sign(f, declared);
  const authorization = f.protocol.authorize({ declarationId: declared.declarationId, approval });
  assert.throws(() => f.protocol.authorize({ declarationId: declared.declarationId, approval }), /already used/);
  const dispatched = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  const outcome = f.protocol.outcome({ dispatchId: dispatched.dispatchId, actualVisibleResult: "Unexpected modal", observedAtUtc: "2026-07-26T10:00:00.100Z", evidence: { reference: "manual:screenshot-2", sha256: "b".repeat(64) } });
  const result = f.protocol.verify({ outcomeId: outcome.outcomeId });
  assert.equal(result.state, "verification_failed");
  assert.equal(result.stopRequired, true);
});

test("spoofed allowlisted adapter metadata never creates a verified ledger state", (t) => {
  const f = fixture(t);
  const declared = f.protocol.declare({ action: f.action, idempotencyKey: "economy-3", campaign: "holland-test", version: "1" });
  const authorization = f.protocol.authorize({ declarationId: declared.declarationId, approval: sign(f, declared) });
  const dispatched = f.protocol.dispatch({ authorizationId: authorization.authorizationId });
  const outcome = f.protocol.outcome({ dispatchId: dispatched.dispatchId, actualVisibleResult: f.action.expectedVisibleResult, observedAtUtc: "2026-07-26T10:00:00.100Z", evidence: { reference: "caller:claimed-adapter", sha256: "c".repeat(64), adapterId: "official", adapterVersion: "1" } });
  const result = f.protocol.verify({ outcomeId: outcome.outcomeId });
  assert.deepEqual(result, { outcomeId: outcome.outcomeId, state: "attested_untrusted", verified: false, idempotent: false, stopRequired: false });
  assert.equal(f.protocol.events().some((event) => event.type === "verified" && event.state === "verified"), false);
});
