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
  actionDigest,
  approvalPayload,
  sessionFingerprintDigest,
  verificationPayload
} = require("../src/control/control-protocol");
const { CATALOG_ID } = require("../src/control/control-procedure-catalog");

const ROOT = path.join(__dirname, "..");
const APPROVAL_SCRIPT = path.join(ROOT, "scripts", "approve-euv-action.js");
const VERIFIER_SCRIPT = path.join(ROOT, "scripts", "verify-euv-action.js");
const HASHES = Object.freeze({
  catalog: "2".repeat(64),
  observation: "3".repeat(64),
  manifest: "5".repeat(64),
  save: "6".repeat(64),
  evidence: "7".repeat(64)
});

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-action-helper-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const declarationId = crypto.randomUUID();
  const session = {
    schemaVersion: "eu5.rehearsal-session/v1",
    rehearsalId: "rehearsal-1",
    campaignId: "holland-test",
    countryId: "HOL",
    gameBuild: "1.3.11",
    modVersion: "0.4.0",
    modManifestSha256: HASHES.manifest,
    seedSaveSha256: HASHES.save
  };
  const preObservation = {
    schemaVersion: "eu5.pre-observation/v1",
    id: "observation-1",
    capturedAtUtc: new Date().toISOString(),
    evidenceSha256: HASHES.observation,
    ...session
  };
  const binding = {
    schemaVersion: ACTION_BINDING_SCHEMA,
    catalogId: CATALOG_ID,
    catalogEntryDigest: HASHES.catalog,
    action: {
      expectedVisibleResult: "Economy panel is visible."
    },
    session,
    preObservation,
    declarationVersion: ACTION_BINDING_SCHEMA
  };
  const declaration = {
    type: "declared",
    declarationId,
    action: binding.action,
    binding,
    actionDigest: actionDigest(binding),
    catalogId: CATALOG_ID,
    catalogEntryDigest: HASHES.catalog,
    preObservationId: "observation-1",
    preObservationSha256: HASHES.observation,
    preObservation,
    rehearsalId: "rehearsal-1",
    campaignId: "holland-test",
    countryId: "HOL",
    sessionFingerprintSha256: sessionFingerprintDigest(session),
    gameBuild: "1.3.11",
    modVersion: "0.4.0",
    modManifestSha256: HASHES.manifest,
    seedSaveSha256: HASHES.save,
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA,
    ...overrides
  };
  const ledger = new ControlLedger({ dataDirectory: directory });
  ledger.append(declaration);
  return { directory, declaration, ledger };
}

function run(script, args, env) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

test("approval helper emits the complete session-bound server artifact without leaking its secret", (t) => {
  const f = fixture(t);
  const secret = "approval-secret-that-must-not-appear";
  const expiresAtUtc = new Date(Date.now() + 30_000).toISOString();
  const result = run(APPROVAL_SCRIPT, [
    "--data-dir", f.directory,
    "--declaration-id", f.declaration.declarationId,
    "--expires-at", expiresAtUtc
  ], { EU5_CONTROL_APPROVAL_SECRET: secret });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
  const approval = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(approval).sort(), [
    "actionDigest",
    "approvalId",
    "campaign",
    "catalogEntryDigest",
    "catalogId",
    "countryId",
    "declarationId",
    "expiresAtUtc",
    "gameBuild",
    "modManifestSha256",
    "modVersion",
    "preObservationId",
    "preObservationSha256",
    "rehearsalId",
    "seedSaveSha256",
    "sessionFingerprintSha256",
    "signature",
    "version"
  ].sort());
  assert.equal(approval.rehearsalId, f.declaration.rehearsalId);
  assert.equal(approval.campaign, f.declaration.campaignId);
  assert.equal(approval.countryId, f.declaration.countryId);
  assert.equal(approval.catalogEntryDigest, f.declaration.catalogEntryDigest);
  assert.equal(approval.preObservationSha256, f.declaration.preObservationSha256);
  assert.equal(
    approval.signature,
    crypto.createHmac("sha256", secret).update(approvalPayload(approval)).digest("hex")
  );
});

test("approval helper refuses incomplete or internally inconsistent declaration bindings", (t) => {
  const secret = "approval-secret-that-must-not-appear";
  const f = fixture(t, { campaignId: "different-campaign" });
  const result = run(APPROVAL_SCRIPT, [
    "--data-dir", f.directory,
    "--declaration-id", f.declaration.declarationId,
    "--expires-at", new Date(Date.now() + 30_000).toISOString()
  ], { EU5_CONTROL_APPROVAL_SECRET: secret });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /campaign binding is inconsistent/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
});

test("verifier helper binds an independently confirmed result and evidence without leaking its secret", (t) => {
  const f = fixture(t);
  const dispatchId = crypto.randomUUID();
  const outcomeId = crypto.randomUUID();
  const observedAtUtc = new Date(Date.now() - 1_000).toISOString();
  f.ledger.append({
    type: "dispatched",
    dispatchId,
    declarationId: f.declaration.declarationId
  }, { recordedAtUtc: observedAtUtc });
  f.ledger.append({
    type: "outcome",
    outcomeId,
    dispatchId,
    state: "outcome_recorded",
    acknowledged: true,
    evidenceConclusive: true,
    actualVisibleResult: f.declaration.action.expectedVisibleResult,
    observedAtUtc,
    evidence: {
      reference: "screenshots/economy.png",
      sha256: HASHES.evidence
    }
  }, { recordedAtUtc: observedAtUtc });
  const secret = "verifier-secret-that-must-not-appear";
  const result = run(VERIFIER_SCRIPT, [
    "--data-dir", f.directory,
    "--outcome-id", outcomeId,
    "--confirm-result", f.declaration.action.expectedVisibleResult,
    "--evidence-sha256", HASHES.evidence
  ], { EU5_CONTROL_VERIFIER_SECRET: secret });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
  const verification = JSON.parse(result.stdout);
  const outcome = f.ledger.readAll().find((event) => event.outcomeId === outcomeId);
  assert.equal(verification.declarationId, f.declaration.declarationId);
  assert.equal(verification.outcomeRecordHash, outcome.recordHash);
  assert.equal(verification.outcomeObservedAtUtc, outcome.observedAtUtc);
  assert.equal(
    verification.signature,
    crypto.createHmac("sha256", secret)
      .update(verificationPayload(verification))
      .digest("hex")
  );
});

test("verifier helper refuses a result or evidence mismatch", (t) => {
  const f = fixture(t);
  const dispatchId = crypto.randomUUID();
  const outcomeId = crypto.randomUUID();
  const observedAtUtc = new Date(Date.now() - 1_000).toISOString();
  f.ledger.append({
    type: "dispatched",
    dispatchId,
    declarationId: f.declaration.declarationId
  }, { recordedAtUtc: observedAtUtc });
  f.ledger.append({
    type: "outcome",
    outcomeId,
    dispatchId,
    state: "outcome_recorded",
    acknowledged: true,
    evidenceConclusive: true,
    actualVisibleResult: f.declaration.action.expectedVisibleResult,
    observedAtUtc,
    evidence: {
      reference: "screenshots/economy.png",
      sha256: HASHES.evidence
    }
  }, { recordedAtUtc: observedAtUtc });
  const secret = "verifier-secret-that-must-not-appear";
  const result = run(VERIFIER_SCRIPT, [
    "--data-dir", f.directory,
    "--outcome-id", outcomeId,
    "--confirm-result", "A different panel is visible.",
    "--evidence-sha256", HASHES.evidence
  ], { EU5_CONTROL_VERIFIER_SECRET: secret });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /confirmed result does not match/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
});
