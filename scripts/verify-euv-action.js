"use strict";

// Run manually in a trusted local shell after independently inspecting the
// visible result and evidence. The verifier secret is never printed.
const crypto = require("node:crypto");
const { ControlLedger } = require("../src/control/control-ledger");
const { verificationPayload } = require("../src/control/control-protocol");

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function canonicalUtc(value, name) {
  const timestamp = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(`${name} must be a canonical ISO-8601 UTC timestamp`);
  }
  return timestamp;
}

function main() {
  const secret = process.env.EU5_CONTROL_VERIFIER_SECRET;
  if (!secret) {
    throw new Error("EU5_CONTROL_VERIFIER_SECRET must be set in this trusted local shell");
  }
  const outcomeId = option("outcome-id");
  const dataDirectory = option("data-dir");
  const confirmedResult = option("confirm-result");
  const confirmedEvidenceSha256 = option("evidence-sha256");
  const verifiedAtUtc = option("verified-at") || new Date().toISOString();
  if (!outcomeId || !dataDirectory || !confirmedResult || !confirmedEvidenceSha256) {
    throw new Error(
      "Usage: node scripts/verify-euv-action.js --data-dir <dir> --outcome-id <uuid> " +
      "--confirm-result <exact-visible-result> --evidence-sha256 <sha256> [--verified-at <ISO-UTC>]"
    );
  }
  const verifiedAtMs = canonicalUtc(verifiedAtUtc, "verified-at");
  if (!/^[a-f0-9]{64}$/.test(confirmedEvidenceSha256)) {
    throw new Error("evidence-sha256 must be a SHA-256 digest");
  }
  const events = new ControlLedger({ dataDirectory }).readAll();
  const outcome = events.find(
    (event) => event.type === "outcome" && event.outcomeId === outcomeId
  );
  if (!outcome) throw new Error("outcome was not found in the local ledger");
  if (
    outcome.state !== "outcome_recorded" ||
    outcome.acknowledged !== true ||
    outcome.evidenceConclusive !== true ||
    !outcome.evidence
  ) {
    throw new Error("only an acknowledged, conclusive outcome can be verified");
  }
  const dispatch = events.find(
    (event) => event.type === "dispatched" && event.dispatchId === outcome.dispatchId
  );
  const declaration = dispatch && events.find(
    (event) =>
      event.type === "declared" &&
      event.declarationId === dispatch.declarationId
  );
  if (!declaration) throw new Error("outcome declaration was not found in the local ledger");
  if (
    confirmedResult !== outcome.actualVisibleResult ||
    confirmedResult !== declaration.action.expectedVisibleResult
  ) {
    throw new Error("confirmed result does not match the recorded and declared result");
  }
  if (
    confirmedEvidenceSha256 !== outcome.evidence.sha256 ||
    !/^[a-f0-9]{64}$/.test(outcome.recordHash)
  ) {
    throw new Error("confirmed evidence does not match the recorded outcome");
  }
  const minimumVerifiedAtMs = Math.max(
    canonicalUtc(outcome.observedAtUtc, "outcome.observedAtUtc"),
    canonicalUtc(outcome.recordedAtUtc, "outcome.recordedAtUtc")
  );
  if (verifiedAtMs < minimumVerifiedAtMs) {
    throw new Error("verification timestamp predates the recorded outcome");
  }
  if (verifiedAtMs > Date.now() + 2_000) {
    throw new Error("verification timestamp is in the future");
  }
  const verification = {
    verificationId: crypto.randomUUID(),
    outcomeId,
    declarationId: declaration.declarationId,
    evidenceSha256: outcome.evidence.sha256,
    outcomeObservedAtUtc: outcome.observedAtUtc,
    outcomeRecordHash: outcome.recordHash,
    result: "verified",
    verifiedAtUtc
  };
  verification.signature = crypto
    .createHmac("sha256", secret)
    .update(verificationPayload(verification))
    .digest("hex");
  process.stdout.write(`${JSON.stringify(verification)}\n`);
}

try {
  main();
} catch (error) {
  console.error(`Verification not issued: ${error.message}`);
  process.exitCode = 1;
}
