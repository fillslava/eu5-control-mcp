"use strict";

// Run manually in a trusted local shell. It prints a signed approval artifact
// to stdout; the secret is never printed and this script exposes no MCP tool.
const crypto = require("node:crypto");
const { ControlLedger } = require("../src/control/control-ledger");
const {
  ACTION_BINDING_SCHEMA,
  actionDigest,
  approvalPayload,
  sessionFingerprintDigest
} = require("../src/control/control-protocol");
const { CATALOG_ID } = require("../src/control/control-procedure-catalog");

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is missing from the declaration`);
  }
  return value;
}

function requiredHash(value, name) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} is not a SHA-256 digest`);
  }
  return value;
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
  const secret = process.env.EU5_CONTROL_APPROVAL_SECRET;
  if (!secret) throw new Error("EU5_CONTROL_APPROVAL_SECRET must be set in this trusted local shell");
  const declarationId = option("declaration-id");
  const dataDirectory = option("data-dir");
  const expiresAtUtc = option("expires-at");
  if (!declarationId || !dataDirectory || !expiresAtUtc) {
    throw new Error("Usage: node scripts/approve-euv-action.js --data-dir <dir> --declaration-id <uuid> --expires-at <ISO-UTC>");
  }
  if (Date.now() >= canonicalUtc(expiresAtUtc, "expires-at")) {
    throw new Error("expiry must be in the future");
  }
  const declaration = new ControlLedger({ dataDirectory }).readAll().find((event) => event.type === "declared" && event.declarationId === declarationId);
  if (!declaration) throw new Error("declaration was not found in the local ledger");
  if (declaration.version !== ACTION_BINDING_SCHEMA) {
    throw new Error("declaration action schema is not supported");
  }
  if (declaration.catalogId !== CATALOG_ID) {
    throw new Error("declaration catalogue is not supported");
  }
  if (
    requiredString(declaration.campaignId, "declaration.campaignId") !==
    requiredString(declaration.campaign, "declaration.campaign")
  ) {
    throw new Error("declaration campaign binding is inconsistent");
  }
  if (
    !declaration.preObservation ||
    typeof declaration.preObservation !== "object" ||
    (
      declaration.preObservation.id !== declaration.preObservationId ||
      declaration.preObservation.evidenceSha256 !== declaration.preObservationSha256
    )
  ) {
    throw new Error("declaration pre-observation binding is inconsistent");
  }
  if (
    !declaration.binding ||
    typeof declaration.binding !== "object" ||
    declaration.binding.catalogId !== declaration.catalogId ||
    declaration.binding.catalogEntryDigest !== declaration.catalogEntryDigest ||
    declaration.binding.preObservation?.id !== declaration.preObservationId ||
    declaration.binding.preObservation?.evidenceSha256 !== declaration.preObservationSha256 ||
    declaration.binding.declarationVersion !== declaration.version ||
    actionDigest(declaration.binding) !== declaration.actionDigest
  ) {
    throw new Error("declaration action binding is inconsistent");
  }
  const boundSession = declaration.binding.session;
  if (
    !boundSession ||
    typeof boundSession !== "object" ||
    boundSession.rehearsalId !== declaration.rehearsalId ||
    boundSession.campaignId !== declaration.campaignId ||
    boundSession.countryId !== declaration.countryId ||
    boundSession.gameBuild !== declaration.gameBuild ||
    boundSession.modVersion !== declaration.modVersion ||
    boundSession.modManifestSha256 !== declaration.modManifestSha256 ||
    boundSession.seedSaveSha256 !== declaration.seedSaveSha256 ||
    sessionFingerprintDigest(boundSession) !== declaration.sessionFingerprintSha256
  ) {
    throw new Error("declaration session binding is inconsistent");
  }
  const approval = {
    approvalId: crypto.randomUUID(),
    declarationId,
    actionDigest: requiredHash(declaration.actionDigest, "declaration.actionDigest"),
    catalogId: requiredString(declaration.catalogId, "declaration.catalogId"),
    catalogEntryDigest: requiredHash(
      declaration.catalogEntryDigest,
      "declaration.catalogEntryDigest"
    ),
    preObservationId: requiredString(
      declaration.preObservationId,
      "declaration.preObservationId"
    ),
    preObservationSha256: requiredHash(
      declaration.preObservationSha256,
      "declaration.preObservationSha256"
    ),
    rehearsalId: requiredString(declaration.rehearsalId, "declaration.rehearsalId"),
    countryId: requiredString(declaration.countryId, "declaration.countryId"),
    sessionFingerprintSha256: requiredHash(
      declaration.sessionFingerprintSha256,
      "declaration.sessionFingerprintSha256"
    ),
    gameBuild: requiredString(declaration.gameBuild, "declaration.gameBuild"),
    modVersion: requiredString(declaration.modVersion, "declaration.modVersion"),
    modManifestSha256: requiredHash(
      declaration.modManifestSha256,
      "declaration.modManifestSha256"
    ),
    seedSaveSha256: requiredHash(
      declaration.seedSaveSha256,
      "declaration.seedSaveSha256"
    ),
    campaign: declaration.campaign,
    version: requiredString(declaration.version, "declaration.version"),
    expiresAtUtc
  };
  approval.signature = crypto.createHmac("sha256", secret).update(approvalPayload(approval)).digest("hex");
  process.stdout.write(`${JSON.stringify(approval)}\n`);
}

try { main(); } catch (error) { console.error(`Approval not issued: ${error.message}`); process.exitCode = 1; }
