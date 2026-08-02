"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { catalogueAction } = require("../src/control/action-gate");
const {
  ACTION_BINDING_SCHEMA,
  approvalPayload
} = require("../src/control/control-protocol");

const MOD_HASH = "1".repeat(64);
const SAVE_HASH = "2".repeat(64);
const OBSERVATION_HASH = "3".repeat(64);

test("MCP server lists and runs its read-only tools", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-mcp-server-"));
  const approvalSecret = "server-smoke-approval-secret";
  fs.writeFileSync(path.join(root, "fixture.eu5"), "test-save");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, "..", "src", "server.js")],
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      EU5_USER_DIRECTORY: root,
      EU5_CONTROL_DATA_DIR: path.join(root, "control-data"),
      EU5_CONTROL_APPROVAL_SECRET: approvalSecret,
      EU5_REHEARSAL_ID: "smoke-rehearsal",
      EU5_REHEARSAL_CAMPAIGN_ID: "holland-test",
      EU5_REHEARSAL_COUNTRY_ID: "HOL",
      EU5_EXPECTED_GAME_BUILD: "1.0.2",
      EU5_EXPECTED_MOD_VERSION: "0.3.1",
      EU5_EXPECTED_MOD_MANIFEST_SHA256: MOD_HASH,
      EU5_EXPECTED_SEED_SAVE_SHA256: SAVE_HASH,
      EU5_OBSERVATION_MAX_AGE_MS: "60000"
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "eu5-control-mcp-test", version: "0.1.0" });
  await client.connect(transport);
  t.after(async () => client.close());

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "eu5_authorize_action",
    "eu5_classify_control_procedure_outcome",
    "eu5_declare_action",
    "eu5_dispatch_action",
    "eu5_issue_navigation_command",
    "eu5_list_control_procedures",
    "eu5_list_debug_exports",
    "eu5_list_save_checkpoints",
    "eu5_observe_checkpoint",
    "eu5_prepare_click_navigation",
    "eu5_prepare_console_dismiss",
    "eu5_prepare_control_procedure",
    "eu5_prepare_navigation_command",
    "eu5_prepare_panel_interaction",
    "eu5_preview_action",
    "eu5_record_action_outcome",
    "eu5_recover_action_family",
    "eu5_verify_action_outcome"
  ]);

  const debugExports = await client.callTool({
    name: "eu5_list_debug_exports",
    arguments: {}
  });
  const debugSnapshot = JSON.parse(debugExports.content[0].text);
  assert.equal(debugSnapshot.userDirectory, fs.realpathSync.native(root));
  assert.equal(debugSnapshot.readOnly, true);
  assert.equal(debugSnapshot.contentIncluded, false);
  assert.equal(debugSnapshot.matchedFileCount, 0);

  const clickNavigation = await client.callTool({
    name: "eu5_prepare_click_navigation",
    arguments: {
      name: "open_diplomacy_click",
      viewport: { width: 1538, height: 895 }
    }
  });
  const preparedClick = JSON.parse(clickNavigation.content[0].text);
  assert.deepEqual(preparedClick.viewport, { width: 1538, height: 895 });
  assert.equal(preparedClick.status, "candidate_requires_live_proof");
  assert.equal(preparedClick.operational, false);
  assert.equal(preparedClick.dispatch, null);
  assert.equal("candidateComputerUseProcedure" in preparedClick, false);
  assert.equal(preparedClick.risk, "read_only");
  assert.equal(preparedClick.targetVerificationRequired, false);
  assert.equal(preparedClick.verificationRequired, true);
  assert.equal("executor" in preparedClick, false);
  assert.equal("directComputerUseProcedure" in preparedClick, false);

  const rejectedClick = await client.callTool({
    name: "eu5_prepare_click_navigation",
    arguments: {
      name: "open_diplomacy_click",
      viewport: { width: 1280, height: 720 }
    }
  });
  assert.equal(rejectedClick.isError, true);

  const navigation = await client.callTool({
    name: "eu5_prepare_navigation_command",
    arguments: { name: "focus_capital" }
  });
  const preparedNavigation = JSON.parse(navigation.content[0].text);
  assert.equal(preparedNavigation.bindingReference, "ctrl+f11");
  assert.equal(preparedNavigation.operational, false);
  assert.equal(preparedNavigation.dispatch, null);
  assert.equal("directWindowsMcpProcedure" in preparedNavigation, false);
  assert.equal("executor" in preparedNavigation, false);

  const issued = await client.callTool({
    name: "eu5_issue_navigation_command",
    arguments: {
      name: "open_economy",
      observation: {
        id: "smoke-ui",
        capturedAtUtc: new Date().toISOString(),
        paused: true,
        modalPresent: false,
        textEntryFocused: false
      }
    }
  });
  const issuedNavigation = JSON.parse(issued.content[0].text);
  assert.equal(issuedNavigation.observationId, "smoke-ui");
  assert.equal("dispatched" in issuedNavigation, false);

  const checkpoint = await client.callTool({
    name: "eu5_observe_checkpoint",
    arguments: { saveDirectory: root }
  });
  assert.equal(JSON.parse(checkpoint.content[0].text).latest.relativePath, "fixture.eu5");

  const result = await client.callTool({
    name: "eu5_list_save_checkpoints",
    arguments: { saveDirectory: root, confirmedSaveDirectory: root }
  });
  const snapshot = JSON.parse(result.content[0].text);
  assert.equal(snapshot.fileCount, 1);
  assert.equal(snapshot.files[0].relativePath, "fixture.eu5");

  const procedureList = await client.callTool({
    name: "eu5_list_control_procedures",
    arguments: {}
  });
  assert.equal(
    JSON.parse(procedureList.content[0].text).observationPolicy.maxAgeMs,
    60_000
  );
  assert.equal(
    JSON.parse(procedureList.content[0].text).actionLifecyclePolicy.sessionBound,
    true
  );

  const declaredResult = await client.callTool({
    name: "eu5_declare_action",
    arguments: {
      idempotencyKey: "smoke-economy-1",
      campaign: "holland-test",
      version: ACTION_BINDING_SCHEMA,
      action: catalogueAction("economy"),
      preObservation: {
        schemaVersion: "eu5.pre-observation/v1",
        id: "smoke-pre-observation",
        capturedAtUtc: new Date().toISOString(),
        evidenceSha256: OBSERVATION_HASH,
        rehearsalId: "smoke-rehearsal",
        campaignId: "holland-test",
        countryId: "HOL",
        gameBuild: "1.0.2",
        modVersion: "0.3.1",
        modManifestSha256: MOD_HASH,
        seedSaveSha256: SAVE_HASH
      }
    }
  });
  const declared = JSON.parse(declaredResult.content[0].text);
  const approval = {
    approvalId: crypto.randomUUID(),
    declarationId: declared.declarationId,
    actionDigest: declared.actionDigest,
    catalogId: declared.catalogId,
    catalogEntryDigest: declared.catalogEntryDigest,
    preObservationId: declared.preObservation.id,
    preObservationSha256: declared.preObservation.evidenceSha256,
    rehearsalId: "smoke-rehearsal",
    countryId: "HOL",
    sessionFingerprintSha256: declared.sessionFingerprintSha256,
    gameBuild: "1.0.2",
    modVersion: "0.3.1",
    modManifestSha256: MOD_HASH,
    seedSaveSha256: SAVE_HASH,
    campaign: "holland-test",
    version: ACTION_BINDING_SCHEMA,
    expiresAtUtc: new Date(Date.now() + 30_000).toISOString()
  };
  approval.signature = crypto
    .createHmac("sha256", approvalSecret)
    .update(approvalPayload(approval))
    .digest("hex");

  const authorizedResult = await client.callTool({
    name: "eu5_authorize_action",
    arguments: { declarationId: declared.declarationId, approval }
  });
  const authorized = JSON.parse(authorizedResult.content[0].text);
  const dispatchResult = await client.callTool({
    name: "eu5_dispatch_action",
    arguments: { authorizationId: authorized.authorizationId }
  });
  const dispatch = JSON.parse(dispatchResult.content[0].text);
  assert.equal(dispatch.externalExecutionRequired, true);
  assert.equal(dispatch.uiInputExecuted, false);

  const outcomeResult = await client.callTool({
    name: "eu5_record_action_outcome",
    arguments: {
      dispatchId: dispatch.dispatchId,
      acknowledged: false,
      evidenceConclusive: false,
      observedAtUtc: new Date().toISOString()
    }
  });
  const outcome = JSON.parse(outcomeResult.content[0].text);
  assert.equal(outcome.state, "execution_unknown");
  assert.equal(outcome.stopRequired, true);
  assert.equal(outcome.automaticRetryAllowed, false);

  const verificationResult = await client.callTool({
    name: "eu5_verify_action_outcome",
    arguments: { outcomeId: outcome.outcomeId }
  });
  const verification = JSON.parse(verificationResult.content[0].text);
  assert.equal(verification.state, "execution_unknown");
  assert.equal(verification.stopRequired, true);
  assert.equal(verification.automaticRetryAllowed, false);
});

test("default server environment refuses session-unbound action declarations", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-mcp-unbound-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    EU5_CONTROL_DATA_DIR: path.join(root, "control-data")
  };
  delete env.EU5_REHEARSAL_ID;
  delete env.EU5_REHEARSAL_CAMPAIGN_ID;
  delete env.EU5_REHEARSAL_COUNTRY_ID;
  delete env.EU5_EXPECTED_GAME_BUILD;
  delete env.EU5_EXPECTED_MOD_VERSION;
  delete env.EU5_EXPECTED_MOD_MANIFEST_SHA256;
  delete env.EU5_EXPECTED_SEED_SAVE_SHA256;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, "..", "src", "server.js")],
    cwd: path.join(__dirname, ".."),
    env,
    stderr: "pipe"
  });
  const client = new Client({ name: "eu5-unbound-mcp-test", version: "0.1.0" });
  await client.connect(transport);
  t.after(async () => client.close());

  const list = await client.callTool({
    name: "eu5_list_control_procedures",
    arguments: {}
  });
  const policy = JSON.parse(list.content[0].text).actionLifecyclePolicy;
  assert.deepEqual(policy, {
    sessionBound: false,
    declarationsAccepted: false,
    externalExecutionOnly: true
  });

  const result = await client.callTool({
    name: "eu5_declare_action",
    arguments: {
      idempotencyKey: "unbound-server-action",
      campaign: "holland-test",
      version: ACTION_BINDING_SCHEMA,
      action: catalogueAction("economy"),
      preObservation: {
        schemaVersion: "eu5.pre-observation/v1",
        id: "unbound-observation",
        capturedAtUtc: new Date().toISOString(),
        evidenceSha256: OBSERVATION_HASH,
        rehearsalId: "none",
        campaignId: "holland-test",
        countryId: "HOL",
        gameBuild: "1.0.2",
        modVersion: "0.3.1",
        modManifestSha256: MOD_HASH,
        seedSaveSha256: SAVE_HASH
      }
    }
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /requires rehearsal context/);
});
