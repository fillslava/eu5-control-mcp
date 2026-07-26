"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

test("MCP server lists and runs its read-only tools", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-mcp-server-"));
  fs.writeFileSync(path.join(root, "fixture.eu5"), "test-save");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, "..", "src", "server.js")],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, EU5_USER_DIRECTORY: root, EU5_CONTROL_DATA_DIR: path.join(root, "control-data") },
    stderr: "pipe"
  });
  const client = new Client({ name: "eu5-control-mcp-test", version: "0.1.0" });
  await client.connect(transport);
  t.after(async () => client.close());

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "eu5_authorize_action",
    "eu5_declare_action",
    "eu5_dispatch_action",
    "eu5_issue_navigation_command",
    "eu5_list_debug_exports",
    "eu5_list_save_checkpoints",
    "eu5_observe_checkpoint",
    "eu5_prepare_click_navigation",
    "eu5_prepare_navigation_command",
    "eu5_preview_action",
    "eu5_record_action_outcome",
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
  assert.deepEqual(preparedClick.candidateComputerUseProcedure, {
    action: "click",
    coordinate: [256, 120]
  });
  assert.deepEqual(preparedClick.viewport, { width: 1538, height: 895 });
  assert.equal(preparedClick.status, "provisional_non_operational");
  assert.equal(preparedClick.operational, false);
  assert.equal(preparedClick.risk, "read_only");
  assert.equal(preparedClick.targetVerificationRequired, true);
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
  assert.equal(preparedNavigation.hotkey, "ctrl+f11");
  assert.deepEqual(preparedNavigation.directWindowsMcpProcedure, {
    tool: "Shortcut",
    arguments: { shortcut: "ctrl+f11" }
  });
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
});
