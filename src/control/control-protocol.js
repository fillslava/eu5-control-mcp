"use strict";

const crypto = require("node:crypto");
const { ControlLedger } = require("./control-ledger");
const { validateActionPreview } = require("./action-gate");

const DEFAULT_AUTHORIZATION_TTL_MS = 60_000;

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

function sameAction(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function actionDigest(action) { return crypto.createHash("sha256").update(JSON.stringify(action)).digest("hex"); }
function approvalPayload(approval) {
  return JSON.stringify({ approvalId: approval.approvalId, declarationId: approval.declarationId, actionDigest: approval.actionDigest, campaign: approval.campaign, version: approval.version, expiresAtUtc: approval.expiresAtUtc });
}
function validHash(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }

class ControlProtocol {
  constructor({ ledger = new ControlLedger(), now = () => Date.now(), authorizationTtlMs = DEFAULT_AUTHORIZATION_TTL_MS, approvalSecret = process.env.EU5_CONTROL_APPROVAL_SECRET } = {}) {
    if (!Number.isSafeInteger(authorizationTtlMs) || authorizationTtlMs <= 0) throw new TypeError("authorizationTtlMs must be positive");
    this.ledger = ledger;
    this.now = now;
    this.authorizationTtlMs = authorizationTtlMs;
    this.approvalSecret = approvalSecret;
  }

  events() { return this.ledger.readAll(); }
  event(type, field, id) { return this.events().find((item) => item.type === type && item[field] === id); }

  declare({ action, idempotencyKey, campaign, version }) {
    requiredString(idempotencyKey, "idempotencyKey");
    requiredString(campaign, "campaign");
    requiredString(version, "version");
    const validated = validateActionPreview(action);
    const existing = this.events().find((item) => item.type === "declared" && item.idempotencyKey === idempotencyKey);
    if (existing) {
      if (!sameAction(existing.action, validated) || existing.campaign !== campaign || existing.version !== version) throw new Error("idempotencyKey is already bound to a different declaration");
      return { declarationId: existing.declarationId, state: "declared", idempotent: true, action: existing.action, actionDigest: existing.actionDigest };
    }
    const declarationId = crypto.randomUUID();
    const digest = actionDigest(validated);
    this.ledger.append({ type: "declared", declarationId, idempotencyKey, campaign, version, action: validated, actionDigest: digest });
    return { declarationId, state: "declared", idempotent: false, action: validated, actionDigest: digest };
  }

  authorize({ declarationId, approval }) {
    requiredString(declarationId, "declarationId");
    if (!this.approvalSecret) throw new Error("approval secret is unavailable to the MCP protocol");
    if (!approval || typeof approval !== "object") throw new TypeError("signed approval artifact is required");
    const declaration = this.event("declared", "declarationId", declarationId);
    if (!declaration) throw new Error("unknown declaration");
    if (approval.declarationId !== declarationId || approval.actionDigest !== declaration.actionDigest || approval.campaign !== declaration.campaign || approval.version !== declaration.version) throw new Error("approval does not bind this exact declaration");
    if (!validHash(approval.signature) || !requiredString(approval.approvalId, "approval.approvalId") || !Number.isFinite(Date.parse(approval.expiresAtUtc))) throw new Error("approval artifact is malformed");
    const expectedSignature = crypto.createHmac("sha256", this.approvalSecret).update(approvalPayload(approval)).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(expectedSignature, "hex"), Buffer.from(approval.signature, "hex"))) throw new Error("approval signature is invalid");
    const expiresAtMs = Date.parse(approval.expiresAtUtc);
    if (this.now() >= expiresAtMs) throw new Error("approval has expired");
    if (this.events().some((item) => item.type === "authorized" && item.approvalId === approval.approvalId)) throw new Error("approval artifact was already used");
    const authorizationId = crypto.randomUUID();
    this.ledger.append({ type: "authorized", authorizationId, declarationId, approvalId: approval.approvalId, expiresAtMs });
    return { authorizationId, declarationId, state: "authorized", expiresAtUtc: new Date(expiresAtMs).toISOString(), oneUse: true };
  }

  dispatch({ authorizationId }) {
    requiredString(authorizationId, "authorizationId");
    const authorization = this.event("authorized", "authorizationId", authorizationId);
    if (!authorization) throw new Error("unknown authorization");
    if (this.now() >= authorization.expiresAtMs) throw new Error("authorization has expired");
    const existing = this.event("dispatched", "authorizationId", authorizationId);
    if (existing) return { dispatchId: existing.dispatchId, state: "dispatch_prepared", idempotent: true, uiInputExecuted: false };
    const dispatchId = crypto.randomUUID();
    this.ledger.append({ type: "dispatched", dispatchId, authorizationId, declarationId: authorization.declarationId, uiInputExecuted: false });
    return { dispatchId, state: "dispatch_prepared", idempotent: false, uiInputExecuted: false, externalExecutionRequired: true };
  }

  outcome({ dispatchId, actualVisibleResult, observedAtUtc, evidence }) {
    requiredString(dispatchId, "dispatchId");
    requiredString(actualVisibleResult, "actualVisibleResult");
    if (!Number.isFinite(Date.parse(observedAtUtc))) throw new TypeError("observedAtUtc must be ISO-8601");
    if (!evidence || typeof evidence !== "object" || !requiredString(evidence.reference, "evidence.reference") || !validHash(evidence.sha256)) throw new TypeError("outcome requires an evidence reference and SHA-256");
    if (!this.event("dispatched", "dispatchId", dispatchId)) throw new Error("unknown dispatch");
    const existing = this.event("outcome", "dispatchId", dispatchId);
    if (existing) {
      if (existing.actualVisibleResult !== actualVisibleResult || existing.observedAtUtc !== observedAtUtc || JSON.stringify(existing.evidence) !== JSON.stringify(evidence)) throw new Error("dispatch outcome already recorded differently");
      return { outcomeId: existing.outcomeId, state: "outcome_recorded", idempotent: true };
    }
    const outcomeId = crypto.randomUUID();
    this.ledger.append({ type: "outcome", outcomeId, dispatchId, actualVisibleResult, observedAtUtc, evidence });
    return { outcomeId, state: "outcome_recorded", idempotent: false };
  }

  verify({ outcomeId }) {
    requiredString(outcomeId, "outcomeId");
    const outcome = this.event("outcome", "outcomeId", outcomeId);
    if (!outcome) throw new Error("unknown outcome");
    const existing = this.event("verified", "outcomeId", outcomeId);
    if (existing) return { outcomeId, state: existing.state, verified: existing.verified, idempotent: true };
    const dispatch = this.event("dispatched", "dispatchId", outcome.dispatchId);
    const declaration = dispatch && this.event("declared", "declarationId", dispatch.declarationId);
    const matchesExpected = Boolean(declaration && declaration.action.expectedVisibleResult === outcome.actualVisibleResult);
    // MCP-supplied evidence is an attestation, not an independently authenticated
    // verifier result. `verified` is intentionally unreachable in this release.
    const state = matchesExpected ? "attested_untrusted" : "verification_failed";
    this.ledger.append({ type: "verified", outcomeId, state, verified: false, evidenceReference: outcome.evidence.reference, evidenceSha256: outcome.evidence.sha256 });
    return { outcomeId, state, verified: false, idempotent: false, stopRequired: !matchesExpected };
  }
}

module.exports = { ControlProtocol, DEFAULT_AUTHORIZATION_TTL_MS, actionDigest, approvalPayload };
