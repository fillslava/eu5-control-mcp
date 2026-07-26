"use strict";

// Run manually in a trusted local shell. It prints a signed approval artifact
// to stdout; the secret is never printed and this script exposes no MCP tool.
const crypto = require("node:crypto");
const { ControlLedger } = require("../src/control/control-ledger");
const { approvalPayload } = require("../src/control/control-protocol");

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const secret = process.env.EU5_CONTROL_APPROVAL_SECRET;
  if (!secret) throw new Error("EU5_CONTROL_APPROVAL_SECRET must be set in this trusted local shell");
  const declarationId = option("declaration-id");
  const dataDirectory = option("data-dir");
  const expiresAtUtc = option("expires-at");
  if (!declarationId || !dataDirectory || !expiresAtUtc || !Number.isFinite(Date.parse(expiresAtUtc))) {
    throw new Error("Usage: node scripts/approve-euv-action.js --data-dir <dir> --declaration-id <uuid> --expires-at <ISO-UTC>");
  }
  if (Date.now() >= Date.parse(expiresAtUtc)) throw new Error("expiry must be in the future");
  const declaration = new ControlLedger({ dataDirectory }).readAll().find((event) => event.type === "declared" && event.declarationId === declarationId);
  if (!declaration) throw new Error("declaration was not found in the local ledger");
  const approval = { approvalId: crypto.randomUUID(), declarationId, actionDigest: declaration.actionDigest, campaign: declaration.campaign, version: declaration.version, expiresAtUtc };
  approval.signature = crypto.createHmac("sha256", secret).update(approvalPayload(approval)).digest("hex");
  process.stdout.write(`${JSON.stringify(approval)}\n`);
}

try { main(); } catch (error) { console.error(`Approval not issued: ${error.message}`); process.exitCode = 1; }
