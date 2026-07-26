"use strict";

const crypto = require("node:crypto");
const { ControlLedger, stableStringify } = require("./control-ledger");
const {
  ACTION_FAMILIES,
  catalogueEntryDigest,
  validateActionSemantics
} = require("./action-gate");
const { CATALOG_ID } = require("./control-procedure-catalog");
const { resolveObservationMaxAgeMs } = require("./observation-policy");

const DEFAULT_AUTHORIZATION_TTL_MS = 60_000;
const SESSION_SCHEMA = "eu5.rehearsal-session/v1";
const PRE_OBSERVATION_SCHEMA = "eu5.pre-observation/v1";
const ACTION_BINDING_SCHEMA = "eu5.action-binding/v1";
const RECOVERY_SCHEMA = "eu5.action-family-recovery/v1";
const MAX_EVENT_CLOCK_SKEW_MS = 2_000;

class AuthorizationExpiredError extends Error {
  constructor() {
    super("authorization has expired");
    this.name = "AuthorizationExpiredError";
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function canonicalUtcTimestamp(value, name) {
  const timestampMs = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(timestampMs) ||
    new Date(timestampMs).toISOString() !== value
  ) {
    throw new TypeError(`${name} must be canonical ISO-8601 UTC`);
  }
  return timestampMs;
}

function actionDigest(binding) {
  return crypto.createHash("sha256").update(stableStringify(binding)).digest("hex");
}

function artifactDigest(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function sessionFingerprintDigest(session) {
  return crypto.createHash("sha256").update(stableStringify(session)).digest("hex");
}

function approvalPayload(approval) {
  return stableStringify({
    approvalId: approval.approvalId,
    declarationId: approval.declarationId,
    actionDigest: approval.actionDigest,
    catalogId: approval.catalogId,
    catalogEntryDigest: approval.catalogEntryDigest,
    preObservationId: approval.preObservationId,
    preObservationSha256: approval.preObservationSha256,
    rehearsalId: approval.rehearsalId,
    countryId: approval.countryId,
    sessionFingerprintSha256: approval.sessionFingerprintSha256,
    gameBuild: approval.gameBuild,
    modVersion: approval.modVersion,
    modManifestSha256: approval.modManifestSha256,
    seedSaveSha256: approval.seedSaveSha256,
    campaign: approval.campaign,
    version: approval.version,
    expiresAtUtc: approval.expiresAtUtc
  });
}

function verificationPayload(verification) {
  return stableStringify({
    verificationId: verification.verificationId,
    outcomeId: verification.outcomeId,
    declarationId: verification.declarationId,
    evidenceSha256: verification.evidenceSha256,
    outcomeObservedAtUtc: verification.outcomeObservedAtUtc,
    outcomeRecordHash: verification.outcomeRecordHash,
    result: verification.result,
    verifiedAtUtc: verification.verifiedAtUtc
  });
}

function recoveryPayload(recovery) {
  return stableStringify({
    schemaVersion: recovery.schemaVersion,
    recoveryId: recovery.recoveryId,
    rehearsalId: recovery.rehearsalId,
    campaignId: recovery.campaignId,
    countryId: recovery.countryId,
    actionFamily: recovery.actionFamily,
    blockedOutcomeId: recovery.blockedOutcomeId,
    reason: recovery.reason,
    approvedAtUtc: recovery.approvedAtUtc
  });
}

function validateSessionContext(context) {
  if (context === undefined || context === null) return null;
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError("sessionContext must be an object");
  }
  if (context.schemaVersion !== SESSION_SCHEMA) {
    throw new TypeError(`sessionContext.schemaVersion must be ${SESSION_SCHEMA}`);
  }
  return Object.freeze({
    schemaVersion: SESSION_SCHEMA,
    rehearsalId: requiredString(context.rehearsalId, "sessionContext.rehearsalId"),
    campaignId: requiredString(context.campaignId, "sessionContext.campaignId"),
    countryId: requiredString(context.countryId, "sessionContext.countryId"),
    gameBuild: requiredString(context.gameBuild, "sessionContext.gameBuild"),
    modVersion: requiredString(context.modVersion, "sessionContext.modVersion"),
    modManifestSha256: validHash(context.modManifestSha256)
      ? context.modManifestSha256
      : (() => { throw new TypeError("sessionContext.modManifestSha256 must be SHA-256"); })(),
    seedSaveSha256: validHash(context.seedSaveSha256)
      ? context.seedSaveSha256
      : (() => { throw new TypeError("sessionContext.seedSaveSha256 must be SHA-256"); })()
  });
}

function sessionContextFromEnvironment(env = process.env) {
  const values = {
    rehearsalId: env.EU5_REHEARSAL_ID,
    campaignId: env.EU5_REHEARSAL_CAMPAIGN_ID,
    countryId: env.EU5_REHEARSAL_COUNTRY_ID,
    gameBuild: env.EU5_EXPECTED_GAME_BUILD,
    modVersion: env.EU5_EXPECTED_MOD_VERSION,
    modManifestSha256: env.EU5_EXPECTED_MOD_MANIFEST_SHA256,
    seedSaveSha256: env.EU5_EXPECTED_SEED_SAVE_SHA256
  };
  if (Object.values(values).every((value) => value === undefined || value === "")) return null;
  return validateSessionContext({ schemaVersion: SESSION_SCHEMA, ...values });
}

function validatePreObservation(observation, session, now, maxAgeMs) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    throw new TypeError("preObservation must be an object");
  }
  if (observation.schemaVersion !== PRE_OBSERVATION_SCHEMA) {
    throw new TypeError(`preObservation.schemaVersion must be ${PRE_OBSERVATION_SCHEMA}`);
  }
  const capturedAtMs = Date.parse(observation.capturedAtUtc);
  if (!Number.isFinite(capturedAtMs)) {
    throw new TypeError("preObservation.capturedAtUtc must be ISO-8601");
  }
  const ageMs = now - capturedAtMs;
  if (ageMs < 0 || ageMs > maxAgeMs) {
    throw new Error("preObservation is not fresh");
  }
  const normalized = Object.freeze({
    schemaVersion: PRE_OBSERVATION_SCHEMA,
    id: requiredString(observation.id, "preObservation.id"),
    capturedAtUtc: new Date(capturedAtMs).toISOString(),
    evidenceSha256: validHash(observation.evidenceSha256)
      ? observation.evidenceSha256
      : (() => { throw new TypeError("preObservation.evidenceSha256 must be SHA-256"); })(),
    rehearsalId: requiredString(observation.rehearsalId, "preObservation.rehearsalId"),
    campaignId: requiredString(observation.campaignId, "preObservation.campaignId"),
    countryId: requiredString(observation.countryId, "preObservation.countryId"),
    gameBuild: requiredString(observation.gameBuild, "preObservation.gameBuild"),
    modVersion: requiredString(observation.modVersion, "preObservation.modVersion"),
    modManifestSha256: validHash(observation.modManifestSha256)
      ? observation.modManifestSha256
      : (() => { throw new TypeError("preObservation.modManifestSha256 must be SHA-256"); })(),
    seedSaveSha256: validHash(observation.seedSaveSha256)
      ? observation.seedSaveSha256
      : (() => { throw new TypeError("preObservation.seedSaveSha256 must be SHA-256"); })()
  });
  for (const field of [
    "rehearsalId",
    "campaignId",
    "countryId",
    "gameBuild",
    "modVersion",
    "modManifestSha256",
    "seedSaveSha256"
  ]) {
    if (normalized[field] !== session[field]) {
      throw new Error(`preObservation ${field} does not match the rehearsal session`);
    }
  }
  return normalized;
}

class ControlProtocol {
  constructor({
    ledger = new ControlLedger(),
    now = () => Date.now(),
    authorizationTtlMs = DEFAULT_AUTHORIZATION_TTL_MS,
    preObservationMaxAgeMs = resolveObservationMaxAgeMs(),
    approvalSecret = process.env.EU5_CONTROL_APPROVAL_SECRET,
    verifierSecret = process.env.EU5_CONTROL_VERIFIER_SECRET,
    sessionContext = sessionContextFromEnvironment()
  } = {}) {
    if (!Number.isSafeInteger(authorizationTtlMs) || authorizationTtlMs <= 0) {
      throw new TypeError("authorizationTtlMs must be positive");
    }
    this.ledger = ledger;
    this.now = now;
    this.authorizationTtlMs = authorizationTtlMs;
    this.preObservationMaxAgeMs = resolveObservationMaxAgeMs({
      maxAgeMs: preObservationMaxAgeMs
    });
    this.approvalSecret = approvalSecret;
    this.verifierSecret = verifierSecret;
    this.sessionContext = validateSessionContext(sessionContext);
    if (this.sessionContext && typeof this.ledger.validate === "function") {
      this.ledger.validate();
    }
    if (
      this.sessionContext &&
      this.events().some((event) =>
        event.rehearsalId !== this.sessionContext.rehearsalId ||
        event.campaignId !== this.sessionContext.campaignId ||
        event.countryId !== this.sessionContext.countryId ||
        event.gameBuild !== this.sessionContext.gameBuild ||
        event.modVersion !== this.sessionContext.modVersion ||
        event.modManifestSha256 !== this.sessionContext.modManifestSha256 ||
        event.seedSaveSha256 !== this.sessionContext.seedSaveSha256
      )
    ) {
      throw new Error("session-bound protocol requires a dedicated matching control ledger");
    }
  }

  events() {
    return this.ledger.readAll();
  }

  event(type, field, id) {
    return this.events().find((item) => item.type === type && item[field] === id);
  }

  declaration(declarationId) {
    return this.event("declared", "declarationId", declarationId);
  }

  frozenFamily(actionFamily, ledgerEvents = this.events()) {
    const events = ledgerEvents.filter((event) => event.actionFamily === actionFamily);
    return [...events].reverse().find((event) => {
      const freezesFamily =
        (event.type === "outcome" && event.state === "execution_unknown") ||
        (
          event.type === "verified" &&
          (event.lifecycleState === "ambiguous" || event.lifecycleState === "failed")
        );
      if (!freezesFamily) return false;
      return !events.some(
        (candidate) =>
          candidate.type === "family_recovered" &&
          candidate.blockedOutcomeId === event.outcomeId &&
          candidate.sequence > event.sequence
      );
    }) || null;
  }

  pendingFamilyDispatch(actionFamily, ledgerEvents = this.events()) {
    return ledgerEvents.find((event) => {
      if (
        event.type !== "dispatched" ||
        event.actionFamily !== actionFamily ||
        event.rehearsalId !== this.sessionContext.rehearsalId
      ) {
        return false;
      }
      const outcome = ledgerEvents.find(
        (candidate) =>
          candidate.type === "outcome" &&
          candidate.dispatchId === event.dispatchId
      );
      if (!outcome) return true;
      if (outcome.state === "execution_unknown") return false;
      return !ledgerEvents.some(
        (candidate) =>
          candidate.type === "verified" &&
          candidate.outcomeId === outcome.outcomeId &&
          ["verified", "ambiguous", "failed"].includes(candidate.lifecycleState)
      );
    }) || null;
  }

  assertFamilyAvailable(actionFamily, ledgerEvents) {
    const frozen = this.frozenFamily(actionFamily, ledgerEvents);
    if (frozen) {
      throw new Error(
        `action family ${actionFamily} is frozen by ${frozen.lifecycleState} ${frozen.outcomeId}; explicit human recovery is required`
      );
    }
  }

  assertCatalogueAndObservationCurrent(declaration) {
    const currentDigest = catalogueEntryDigest(declaration.procedure);
    if (
      declaration.catalogId !== CATALOG_ID ||
      declaration.catalogEntryDigest !== currentDigest
    ) {
      throw new Error("catalogue entry drifted after declaration");
    }
    validatePreObservation(
      declaration.preObservation,
      this.sessionContext,
      this.now(),
      this.preObservationMaxAgeMs
    );
  }

  lifecycleEvent(declaration, lifecycleState, body = {}) {
    if (!declaration) throw new Error("lifecycle declaration is required");
    const session = this.sessionContext
      ? {
          rehearsalId: this.sessionContext.rehearsalId,
          campaignId: this.sessionContext.campaignId,
          countryId: this.sessionContext.countryId,
          gameBuild: this.sessionContext.gameBuild,
          modVersion: this.sessionContext.modVersion,
          modManifestSha256: this.sessionContext.modManifestSha256,
          seedSaveSha256: this.sessionContext.seedSaveSha256
        }
      : {
          campaignId: declaration.campaign
        };
    return {
      ...body,
      ...session,
      declarationId: declaration.declarationId,
      actionId: declaration.actionId,
      actionFamily: declaration.actionFamily,
      procedure: declaration.procedure,
      capability: declaration.capability,
      catalogId: declaration.catalogId,
      catalogEntryDigest: declaration.catalogEntryDigest,
      preObservationId: declaration.preObservation.id,
      preObservationSha256: declaration.preObservation.evidenceSha256,
      actionDigest: declaration.actionDigest,
      sessionFingerprintSha256: declaration.sessionFingerprintSha256,
      lifecycleState,
      verified: lifecycleState === "verified"
    };
  }

  declare({ action, idempotencyKey, campaign, version, preObservation }) {
    if (!this.sessionContext) {
      throw new Error("session-bound control lifecycle requires rehearsal context");
    }
    requiredString(idempotencyKey, "idempotencyKey");
    requiredString(campaign, "campaign");
    if (version !== ACTION_BINDING_SCHEMA) {
      throw new Error(`version must be the pinned action schema ${ACTION_BINDING_SCHEMA}`);
    }
    const validated = validateActionSemantics(action);
    if (this.sessionContext && campaign !== this.sessionContext.campaignId) {
      throw new Error("declaration campaign does not match the rehearsal session");
    }
    this.assertFamilyAvailable(validated.actionFamily);
    const normalizedObservation = validatePreObservation(
      preObservation,
      this.sessionContext,
      this.now(),
      this.preObservationMaxAgeMs
    );
    const entryDigest = catalogueEntryDigest(validated.procedure);
    const binding = Object.freeze({
      schemaVersion: ACTION_BINDING_SCHEMA,
      catalogId: CATALOG_ID,
      catalogEntryDigest: entryDigest,
      action: validated,
      session: this.sessionContext,
      preObservation: normalizedObservation,
      declarationVersion: version
    });
    const digest = actionDigest(binding);
    const fingerprintDigest = sessionFingerprintDigest(this.sessionContext);
    const declarationId = crypto.randomUUID();
    const declaration = {
      type: "declared",
      declarationId,
      idempotencyKey,
      campaign,
      version,
      action: validated,
      binding,
      actionId: validated.id,
      actionFamily: validated.actionFamily,
      procedure: validated.procedure,
      capability: validated.capability,
      catalogId: CATALOG_ID,
      catalogEntryDigest: entryDigest,
      preObservation: normalizedObservation,
      sessionFingerprintSha256: fingerprintDigest,
      actionDigest: digest
    };
    const prepared = this.lifecycleEvent(declaration, "declared", {
      type: "declared",
      idempotencyKey,
      campaign,
      version,
      action: validated,
      binding,
      catalogId: CATALOG_ID,
      catalogEntryDigest: entryDigest,
      preObservation: normalizedObservation,
      sessionFingerprintSha256: fingerprintDigest,
      actionDigest: digest
    });
    const persisted = this.ledger.appendOnce(prepared, {
      uniqueBy: { type: "declared", idempotencyKey },
      guard: (events) => {
        this.assertFamilyAvailable(validated.actionFamily, events);
        validatePreObservation(
          normalizedObservation,
          this.sessionContext,
          this.now(),
          this.preObservationMaxAgeMs
        );
        if (catalogueEntryDigest(validated.procedure) !== entryDigest) {
          throw new Error("catalogue entry drifted before declaration persistence");
        }
      },
      recordedAtUtc: new Date(this.now()).toISOString()
    });
    const record = persisted.record;
    if (!persisted.appended && (
      record.actionDigest !== digest ||
      record.campaign !== campaign ||
      record.version !== version
    )) {
      throw new Error("idempotencyKey is already bound to a different declaration");
    }
    return {
      declarationId: record.declarationId,
      state: "declared",
      idempotent: !persisted.appended,
      action: record.action,
      actionDigest: record.actionDigest,
      catalogId: record.catalogId,
      catalogEntryDigest: record.catalogEntryDigest,
      preObservation: record.preObservation,
      sessionFingerprintSha256: record.sessionFingerprintSha256
    };
  }

  authorize({ declarationId, approval }) {
    requiredString(declarationId, "declarationId");
    if (!this.approvalSecret) throw new Error("approval secret is unavailable to the MCP protocol");
    if (!approval || typeof approval !== "object") {
      throw new TypeError("signed approval artifact is required");
    }
    const declaration = this.declaration(declarationId);
    if (!declaration) throw new Error("unknown declaration");
    this.assertFamilyAvailable(declaration.actionFamily);
    this.assertCatalogueAndObservationCurrent(declaration);
    if (
      approval.declarationId !== declarationId ||
      approval.actionDigest !== declaration.actionDigest ||
      approval.catalogId !== declaration.catalogId ||
      approval.catalogEntryDigest !== declaration.catalogEntryDigest ||
      approval.preObservationId !== declaration.preObservation.id ||
      approval.preObservationSha256 !== declaration.preObservation.evidenceSha256 ||
      approval.rehearsalId !== this.sessionContext.rehearsalId ||
      approval.countryId !== this.sessionContext.countryId ||
      approval.sessionFingerprintSha256 !== declaration.sessionFingerprintSha256 ||
      approval.gameBuild !== this.sessionContext.gameBuild ||
      approval.modVersion !== this.sessionContext.modVersion ||
      approval.modManifestSha256 !== this.sessionContext.modManifestSha256 ||
      approval.seedSaveSha256 !== this.sessionContext.seedSaveSha256 ||
      approval.campaign !== declaration.campaign ||
      approval.version !== declaration.version
    ) {
      throw new Error("approval does not bind this exact declaration");
    }
    if (
      !validHash(approval.signature) ||
      !requiredString(approval.approvalId, "approval.approvalId") ||
      !Number.isFinite(Date.parse(approval.expiresAtUtc))
    ) {
      throw new Error("approval artifact is malformed");
    }
    const expectedSignature = crypto
      .createHmac("sha256", this.approvalSecret)
      .update(approvalPayload(approval))
      .digest("hex");
    if (
      !crypto.timingSafeEqual(
        Buffer.from(expectedSignature, "hex"),
        Buffer.from(approval.signature, "hex")
      )
    ) {
      throw new Error("approval signature is invalid");
    }
    const approvalExpiresAtMs = Date.parse(approval.expiresAtUtc);
    const nowMs = this.now();
    if (nowMs >= approvalExpiresAtMs) throw new Error("approval has expired");
    const expiresAtMs = Math.min(
      approvalExpiresAtMs,
      nowMs + this.authorizationTtlMs
    );
    const authorizationId = crypto.randomUUID();
    const transitions = [
      this.lifecycleEvent(declaration, "gated", {
        type: "gated",
        gate: "signed_approval_binding_valid"
      }),
      this.lifecycleEvent(declaration, "confirmed", {
        type: "confirmed",
        approvalId: approval.approvalId
      }),
      this.lifecycleEvent(declaration, "authorized", {
        type: "authorized",
        authorizationId,
        approvalId: approval.approvalId,
        authorizedAtMs: nowMs,
        approvalExpiresAtMs,
        authorizationTtlMs: this.authorizationTtlMs,
        expiresAtMs,
        bindingDigest: declaration.actionDigest
      })
    ];
    const persisted = this.ledger.appendManyOnce(transitions, {
      uniqueBy: [
        { type: "authorized", declarationId },
        { type: "authorized", approvalId: approval.approvalId }
      ],
      guard: (events) => {
        const lockedDeclaration = events.find(
          (event) =>
            event.type === "declared" &&
            event.declarationId === declarationId
        );
        if (!lockedDeclaration) throw new Error("unknown declaration");
        this.assertFamilyAvailable(lockedDeclaration.actionFamily, events);
        this.assertCatalogueAndObservationCurrent(lockedDeclaration);
        const lockedNowMs = this.now();
        if (lockedNowMs >= approvalExpiresAtMs || lockedNowMs >= expiresAtMs) {
          throw new Error("approval has expired");
        }
      },
      recordedAtUtc: new Date(this.now()).toISOString()
    });
    if (!persisted.appended) {
      if (persisted.matched.approvalId === approval.approvalId) {
        throw new Error("approval artifact was already used");
      }
      throw new Error("declaration is already authorized");
    }
    return {
      authorizationId,
      declarationId,
      state: "authorized",
      expiresAtUtc: new Date(expiresAtMs).toISOString(),
      oneUse: true
    };
  }

  recordAuthorizationExpiration(authorization) {
    const declaration = this.declaration(authorization.declarationId);
    if (!declaration) throw new Error("unknown declaration");
    const prepared = this.lifecycleEvent(declaration, "expired", {
      type: "expired",
      authorizationId: authorization.authorizationId,
      authorizedAtMs: authorization.authorizedAtMs,
      approvalExpiresAtMs: authorization.approvalExpiresAtMs,
      authorizationTtlMs: authorization.authorizationTtlMs,
      expiresAtMs: authorization.expiresAtMs
    });
    return this.ledger.appendOnce(prepared, {
      uniqueBy: [
        { type: "dispatched", authorizationId: authorization.authorizationId },
        { type: "expired", authorizationId: authorization.authorizationId }
      ],
      guard: (events) => {
        const lockedAuthorization = events.find(
          (event) =>
            event.type === "authorized" &&
            event.authorizationId === authorization.authorizationId
        );
        if (!lockedAuthorization) throw new Error("unknown authorization");
        if (this.now() < lockedAuthorization.expiresAtMs) {
          throw new Error("authorization has not expired");
        }
      },
      recordedAtUtc: new Date(this.now()).toISOString()
    }).record;
  }

  dispatch({ authorizationId }) {
    requiredString(authorizationId, "authorizationId");
    const authorization = this.event("authorized", "authorizationId", authorizationId);
    if (!authorization) throw new Error("unknown authorization");
    const existing = this.event("dispatched", "authorizationId", authorizationId);
    if (existing) {
      return {
        dispatchId: existing.dispatchId,
        state: "already_dispatched",
        idempotent: true,
        uiInputExecuted: false,
        externalExecutionRequired: false
      };
    }
    const existingExpiration = this.event("expired", "authorizationId", authorizationId);
    if (existingExpiration) throw new AuthorizationExpiredError();
    if (this.now() >= authorization.expiresAtMs) {
      const terminal = this.recordAuthorizationExpiration(authorization);
      if (terminal.type === "dispatched") {
        return {
          dispatchId: terminal.dispatchId,
          state: "already_dispatched",
          idempotent: true,
          uiInputExecuted: false,
          externalExecutionRequired: false
        };
      }
      throw new AuthorizationExpiredError();
    }
    const declaration = this.declaration(authorization.declarationId);
    this.assertFamilyAvailable(declaration.actionFamily);
    this.assertCatalogueAndObservationCurrent(declaration);
    const dispatchId = crypto.randomUUID();
    const prepared = this.lifecycleEvent(declaration, "dispatched", {
      type: "dispatched",
      dispatchId,
      authorizationId,
      uiInputExecuted: false
    });
    let persisted;
    try {
      persisted = this.ledger.appendOnce(prepared, {
        uniqueBy: [
          { type: "dispatched", authorizationId },
          { type: "expired", authorizationId }
        ],
        guard: (events) => {
          const lockedAuthorization = events.find(
            (event) =>
              event.type === "authorized" &&
              event.authorizationId === authorizationId
          );
          if (!lockedAuthorization) throw new Error("unknown authorization");
          if (this.now() >= lockedAuthorization.expiresAtMs) {
            throw new AuthorizationExpiredError();
          }
          const lockedDeclaration = events.find(
            (event) =>
              event.type === "declared" &&
              event.declarationId === lockedAuthorization.declarationId
          );
          if (!lockedDeclaration) throw new Error("unknown declaration");
          this.assertFamilyAvailable(lockedDeclaration.actionFamily, events);
          const pending = this.pendingFamilyDispatch(
            lockedDeclaration.actionFamily,
            events
          );
          if (pending) {
            throw new Error(
              `action family ${lockedDeclaration.actionFamily} already has pending dispatch ${pending.dispatchId}`
            );
          }
          this.assertCatalogueAndObservationCurrent(lockedDeclaration);
        },
        recordedAtUtc: new Date(this.now()).toISOString()
      });
    } catch (error) {
      if (!(error instanceof AuthorizationExpiredError)) throw error;
      const terminal = this.recordAuthorizationExpiration(authorization);
      if (terminal.type === "dispatched") {
        return {
          dispatchId: terminal.dispatchId,
          state: "already_dispatched",
          idempotent: true,
          uiInputExecuted: false,
          externalExecutionRequired: false
        };
      }
      throw error;
    }
    if (!persisted.appended) {
      if (persisted.record.type === "expired") {
        throw new AuthorizationExpiredError();
      }
      return {
        dispatchId: persisted.record.dispatchId,
        state: "already_dispatched",
        idempotent: true,
        uiInputExecuted: false,
        externalExecutionRequired: false
      };
    }
    return {
      dispatchId: persisted.record.dispatchId,
      state: "dispatch_prepared",
      idempotent: false,
      uiInputExecuted: false,
      externalExecutionRequired: true
    };
  }

  outcome({
    dispatchId,
    acknowledged,
    evidenceConclusive,
    actualVisibleResult,
    observedAtUtc,
    evidence
  }) {
    requiredString(dispatchId, "dispatchId");
    const observedAtMs = canonicalUtcTimestamp(observedAtUtc, "observedAtUtc");
    const dispatch = this.event("dispatched", "dispatchId", dispatchId);
    if (!dispatch) throw new Error("unknown dispatch");
    if (acknowledged !== undefined && typeof acknowledged !== "boolean") {
      throw new TypeError("acknowledged must be boolean");
    }
    if (evidenceConclusive !== undefined && typeof evidenceConclusive !== "boolean") {
      throw new TypeError("evidenceConclusive must be boolean");
    }
    const normalizedAcknowledged = acknowledged === true;
    const normalizedEvidenceConclusive = evidenceConclusive === true;
    const executionUnknown = !normalizedAcknowledged || !normalizedEvidenceConclusive;
    if (!executionUnknown) {
      requiredString(actualVisibleResult, "actualVisibleResult");
      if (
        !evidence ||
        typeof evidence !== "object" ||
        !requiredString(evidence.reference, "evidence.reference") ||
        !validHash(evidence.sha256)
      ) {
        throw new TypeError("a conclusive outcome requires an evidence reference and SHA-256");
      }
    } else if (evidence !== undefined && evidence !== null) {
      if (
        typeof evidence !== "object" ||
        !requiredString(evidence.reference, "evidence.reference") ||
        !validHash(evidence.sha256)
      ) {
        throw new TypeError("supplied outcome evidence requires a reference and SHA-256");
      }
    }
    const state = executionUnknown ? "execution_unknown" : "outcome_recorded";
    const normalizedResult =
      typeof actualVisibleResult === "string" && actualVisibleResult.trim() !== ""
        ? actualVisibleResult
        : null;
    const normalizedEvidence = evidence || null;
    const existing = this.event("outcome", "dispatchId", dispatchId);
    if (existing) {
      if (
        existing.acknowledged !== normalizedAcknowledged ||
        existing.evidenceConclusive !== normalizedEvidenceConclusive ||
        existing.actualVisibleResult !== normalizedResult ||
        existing.observedAtUtc !== observedAtUtc ||
        stableStringify(existing.evidence) !== stableStringify(normalizedEvidence)
      ) {
        throw new Error("dispatch outcome already recorded differently");
      }
      return {
        outcomeId: existing.outcomeId,
        state: existing.state,
        idempotent: true,
        stopRequired: existing.state === "execution_unknown",
        automaticRetryAllowed: false
      };
    }
    const declaration = this.declaration(dispatch.declarationId);
    const outcomeId = crypto.randomUUID();
    const prepared = this.lifecycleEvent(
      declaration,
      executionUnknown ? "execution_unknown" : "acknowledged",
      {
        type: "outcome",
        outcomeId,
        dispatchId,
        state,
        acknowledged: normalizedAcknowledged,
        evidenceConclusive: normalizedEvidenceConclusive,
        actualVisibleResult: normalizedResult,
        observedAtUtc,
        evidence: normalizedEvidence
      }
    );
    const persisted = this.ledger.appendOnce(prepared, {
      uniqueBy: { type: "outcome", dispatchId },
      guard: (events) => {
        const lockedDispatch = events.find(
          (event) => event.type === "dispatched" && event.dispatchId === dispatchId
        );
        if (!lockedDispatch) throw new Error("unknown dispatch");
        const dispatchRecordedAtMs = canonicalUtcTimestamp(
          lockedDispatch.recordedAtUtc,
          "dispatch.recordedAtUtc"
        );
        const lockedNowMs = this.now();
        if (observedAtMs < dispatchRecordedAtMs) {
          throw new Error("observedAtUtc predates dispatch");
        }
        if (observedAtMs > lockedNowMs + MAX_EVENT_CLOCK_SKEW_MS) {
          throw new Error("observedAtUtc exceeds the allowed clock tolerance");
        }
        const lockedDeclaration = events.find(
          (event) =>
            event.type === "declared" &&
            event.declarationId === lockedDispatch.declarationId
        );
        if (!lockedDeclaration) throw new Error("unknown declaration");
      },
      recordedAtUtc: new Date(this.now()).toISOString()
    });
    if (!persisted.appended) {
      const record = persisted.record;
      if (
        record.acknowledged !== normalizedAcknowledged ||
        record.evidenceConclusive !== normalizedEvidenceConclusive ||
        record.actualVisibleResult !== normalizedResult ||
        record.observedAtUtc !== observedAtUtc ||
        stableStringify(record.evidence) !== stableStringify(normalizedEvidence)
      ) {
        throw new Error("dispatch outcome already recorded differently");
      }
      return {
        outcomeId: record.outcomeId,
        state: record.state,
        idempotent: true,
        stopRequired: record.state === "execution_unknown",
        automaticRetryAllowed: false
      };
    }
    return {
      outcomeId: persisted.record.outcomeId,
      state,
      idempotent: false,
      stopRequired: executionUnknown,
      automaticRetryAllowed: false,
      requiresFreshDeclarationForRetry: executionUnknown
    };
  }

  recoverFamily({ actionFamily, recovery }) {
    if (!this.sessionContext) {
      throw new Error("session-bound control lifecycle requires rehearsal context");
    }
    if (!ACTION_FAMILIES.has(actionFamily)) {
      throw new TypeError("actionFamily is invalid");
    }
    if (!this.approvalSecret) {
      throw new Error("approval secret is unavailable to the MCP protocol");
    }
    if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)) {
      throw new TypeError("signed human recovery artifact is required");
    }
    if (
      recovery.schemaVersion !== RECOVERY_SCHEMA ||
      recovery.rehearsalId !== this.sessionContext.rehearsalId ||
      recovery.campaignId !== this.sessionContext.campaignId ||
      recovery.countryId !== this.sessionContext.countryId ||
      recovery.actionFamily !== actionFamily ||
      !requiredString(recovery.blockedOutcomeId, "recovery.blockedOutcomeId") ||
      !requiredString(recovery.recoveryId, "recovery.recoveryId") ||
      !requiredString(recovery.reason, "recovery.reason") ||
      !validHash(recovery.signature)
    ) {
      throw new Error("recovery artifact does not bind the frozen action family");
    }
    const approvedAtMs = Date.parse(recovery.approvedAtUtc);
    const ageMs = this.now() - approvedAtMs;
    if (!Number.isFinite(approvedAtMs) || ageMs < 0 || ageMs > this.authorizationTtlMs) {
      throw new Error("recovery approval is not fresh");
    }
    const expectedSignature = crypto
      .createHmac("sha256", this.approvalSecret)
      .update(recoveryPayload(recovery))
      .digest("hex");
    if (
      !crypto.timingSafeEqual(
        Buffer.from(expectedSignature, "hex"),
        Buffer.from(recovery.signature, "hex")
      )
    ) {
      throw new Error("recovery signature is invalid");
    }
    const recoveryArtifactDigest = artifactDigest(recoveryPayload(recovery));
    const existing = this.event("family_recovered", "recoveryId", recovery.recoveryId);
    if (existing) {
      if (
        existing.actionFamily !== actionFamily ||
        existing.blockedOutcomeId !== recovery.blockedOutcomeId ||
        existing.recoveryArtifactDigest !== recoveryArtifactDigest
      ) {
        throw new Error("recovery artifact was already used differently");
      }
      return {
        recoveryId: existing.recoveryId,
        actionFamily,
        state: "family_recovered",
        idempotent: true
      };
    }
    const frozen = this.frozenFamily(actionFamily);
    if (!frozen) throw new Error(`action family ${actionFamily} is not frozen`);
    if (recovery.blockedOutcomeId !== frozen.outcomeId) {
      throw new Error("recovery artifact does not bind the frozen action family");
    }
    const prepared = {
      type: "family_recovered",
      recoveryId: recovery.recoveryId,
      blockedOutcomeId: frozen.outcomeId,
      actionFamily,
      reason: recovery.reason,
      approvedAtUtc: new Date(approvedAtMs).toISOString(),
      recoveryArtifactDigest,
      rehearsalId: this.sessionContext.rehearsalId,
      campaignId: this.sessionContext.campaignId,
      countryId: this.sessionContext.countryId,
      gameBuild: this.sessionContext.gameBuild,
      modVersion: this.sessionContext.modVersion,
      modManifestSha256: this.sessionContext.modManifestSha256,
      seedSaveSha256: this.sessionContext.seedSaveSha256,
      lifecycleState: "recovered",
      verified: false
    };
    const persisted = this.ledger.appendOnce(prepared, {
      uniqueBy: [
        {
          type: "family_recovered",
          blockedOutcomeId: recovery.blockedOutcomeId
        },
        {
          type: "family_recovered",
          recoveryId: recovery.recoveryId
        }
      ],
      guard: (events) => {
        const lockedFrozen = this.frozenFamily(actionFamily, events);
        if (!lockedFrozen) {
          throw new Error(`action family ${actionFamily} is not frozen`);
        }
        if (lockedFrozen.outcomeId !== recovery.blockedOutcomeId) {
          throw new Error("recovery artifact does not bind the current frozen outcome");
        }
        const lockedAgeMs = this.now() - approvedAtMs;
        if (lockedAgeMs < 0 || lockedAgeMs > this.authorizationTtlMs) {
          throw new Error("recovery approval is not fresh");
        }
      },
      recordedAtUtc: new Date(this.now()).toISOString()
    });
    if (!persisted.appended) {
      if (
        persisted.record.recoveryId !== recovery.recoveryId ||
        persisted.record.actionFamily !== actionFamily ||
        persisted.record.recoveryArtifactDigest !== recoveryArtifactDigest
      ) {
        throw new Error("frozen outcome was already recovered with a different artifact");
      }
      return {
        recoveryId: persisted.record.recoveryId,
        actionFamily,
        state: "family_recovered",
        idempotent: true
      };
    }
    return {
      recoveryId: recovery.recoveryId,
      actionFamily,
      state: "family_recovered",
      idempotent: false
    };
  }

  verifySignedArtifact(outcome, declaration, verification) {
    if (!verification) return false;
    if (!this.verifierSecret) {
      throw new Error("verifier secret is unavailable to the MCP protocol");
    }
    if (
      verification.outcomeId !== outcome.outcomeId ||
      verification.declarationId !== declaration.declarationId ||
      verification.evidenceSha256 !== outcome.evidence.sha256 ||
      verification.outcomeObservedAtUtc !== outcome.observedAtUtc ||
      verification.outcomeRecordHash !== outcome.recordHash ||
      verification.result !== "verified" ||
      !requiredString(verification.verificationId, "verification.verificationId") ||
      !validHash(verification.signature)
    ) {
      throw new Error("verification artifact does not bind this exact outcome");
    }
    const verifiedAtMs = canonicalUtcTimestamp(
      verification.verifiedAtUtc,
      "verification.verifiedAtUtc"
    );
    const outcomeObservedAtMs = canonicalUtcTimestamp(
      outcome.observedAtUtc,
      "outcome.observedAtUtc"
    );
    const outcomeRecordedAtMs = canonicalUtcTimestamp(
      outcome.recordedAtUtc,
      "outcome.recordedAtUtc"
    );
    if (verifiedAtMs < Math.max(outcomeObservedAtMs, outcomeRecordedAtMs)) {
      throw new Error("verification artifact predates the recorded outcome");
    }
    if (verifiedAtMs > this.now() + MAX_EVENT_CLOCK_SKEW_MS) {
      throw new Error("verification artifact exceeds the allowed clock tolerance");
    }
    const expectedSignature = crypto
      .createHmac("sha256", this.verifierSecret)
      .update(verificationPayload(verification))
      .digest("hex");
    if (
      !crypto.timingSafeEqual(
        Buffer.from(expectedSignature, "hex"),
        Buffer.from(verification.signature, "hex")
      )
    ) {
      throw new Error("verification signature is invalid");
    }
    return true;
  }

  verificationReplayResult(existing, outcome, declaration, verification) {
    const supplied = verification !== undefined && verification !== null;
    if (supplied) this.verifySignedArtifact(outcome, declaration, verification);
    const suppliedDigest = supplied
      ? artifactDigest(verificationPayload(verification))
      : null;
    const suppliedId = supplied ? verification.verificationId : null;
    if (
      existing.verificationArtifactDigest !== suppliedDigest ||
      existing.verificationId !== suppliedId
    ) {
      throw new Error("verification outcome already recorded with a different artifact");
    }
    return {
      outcomeId: outcome.outcomeId,
      state: existing.state,
      verified: existing.verified,
      idempotent: true,
      stopRequired: existing.stopRequired === true,
      automaticRetryAllowed: false
    };
  }

  verify({ outcomeId, verification }) {
    requiredString(outcomeId, "outcomeId");
    const outcome = this.event("outcome", "outcomeId", outcomeId);
    if (!outcome) throw new Error("unknown outcome");
    if (outcome.state === "execution_unknown") {
      if (verification !== undefined && verification !== null) {
        throw new Error("execution_unknown outcomes cannot accept verification artifacts");
      }
      return {
        outcomeId,
        state: "execution_unknown",
        verified: false,
        idempotent: true,
        stopRequired: true,
        automaticRetryAllowed: false,
        requiresFreshDeclarationForRetry: true
      };
    }
    const dispatch = this.event("dispatched", "dispatchId", outcome.dispatchId);
    const declaration = dispatch && this.declaration(dispatch.declarationId);
    if (!declaration) throw new Error("unknown declaration");
    const existing = this.event("verified", "outcomeId", outcomeId);
    if (existing) {
      return this.verificationReplayResult(
        existing,
        outcome,
        declaration,
        verification
      );
    }
    const matchesExpected = Boolean(
      declaration &&
      declaration.action.expectedVisibleResult === outcome.actualVisibleResult
    );
    const signedArtifactValid = this.verifySignedArtifact(
      outcome,
      declaration,
      verification
    );
    const verificationArtifactDigest = signedArtifactValid
      ? artifactDigest(verificationPayload(verification))
      : null;
    const independentlyVerified = matchesExpected && signedArtifactValid;
    const state = independentlyVerified
      ? "verified"
      : matchesExpected
        ? "attested_untrusted"
        : "verification_failed";
    const lifecycleState = independentlyVerified
      ? "verified"
      : matchesExpected
        ? "ambiguous"
        : "failed";
    const prepared = this.lifecycleEvent(declaration, lifecycleState, {
      type: "verified",
      outcomeId,
      state,
      verified: independentlyVerified,
      stopRequired: !independentlyVerified,
      automaticRetryAllowed: false,
      verificationId: signedArtifactValid ? verification.verificationId : null,
      verificationArtifactDigest,
      verifiedAtUtc: signedArtifactValid ? verification.verifiedAtUtc : null,
      outcomeObservedAtUtc: outcome.observedAtUtc,
      outcomeRecordHash: outcome.recordHash,
      evidenceReference: outcome.evidence.reference,
      evidenceSha256: outcome.evidence.sha256
    });
    const persisted = this.ledger.appendOnce(prepared, {
      uniqueBy: [
        { type: "verified", outcomeId },
        ...(signedArtifactValid
          ? [{ type: "verified", verificationId: verification.verificationId }]
          : [])
      ],
      guard: (events) => {
        const lockedOutcome = events.find(
          (event) => event.type === "outcome" && event.outcomeId === outcomeId
        );
        if (!lockedOutcome) throw new Error("unknown outcome");
        const lockedDispatch = events.find(
          (event) =>
            event.type === "dispatched" &&
            event.dispatchId === lockedOutcome.dispatchId
        );
        if (!lockedDispatch) throw new Error("unknown dispatch");
        const lockedDeclaration = events.find(
          (event) =>
            event.type === "declared" &&
            event.declarationId === lockedDispatch.declarationId
        );
        if (!lockedDeclaration) throw new Error("unknown declaration");
        if (signedArtifactValid) {
          this.verifySignedArtifact(
            lockedOutcome,
            lockedDeclaration,
            verification
          );
        }
      },
      recordedAtUtc: new Date(this.now()).toISOString()
    });
    if (!persisted.appended) {
      if (persisted.record.outcomeId !== outcomeId) {
        throw new Error("verification artifact was already used");
      }
      return this.verificationReplayResult(
        persisted.record,
        outcome,
        declaration,
        verification
      );
    }
    return {
      outcomeId,
      state,
      verified: independentlyVerified,
      idempotent: false,
      stopRequired: !independentlyVerified,
      automaticRetryAllowed: false
    };
  }
}

module.exports = {
  ACTION_BINDING_SCHEMA,
  ControlProtocol,
  DEFAULT_AUTHORIZATION_TTL_MS,
  MAX_EVENT_CLOCK_SKEW_MS,
  PRE_OBSERVATION_SCHEMA,
  RECOVERY_SCHEMA,
  SESSION_SCHEMA,
  actionDigest,
  approvalPayload,
  recoveryPayload,
  sessionFingerprintDigest,
  sessionContextFromEnvironment,
  validatePreObservation,
  validateSessionContext,
  verificationPayload
};
