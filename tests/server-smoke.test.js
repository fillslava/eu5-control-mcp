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
    stderr: "pipe"
  });
  const client = new Client({ name: "eu5-control-mcp-test", version: "0.1.0" });
  await client.connect(transport);
  t.after(async () => client.close());

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "eu5_list_save_checkpoints",
    "eu5_prepare_navigation_command",
    "eu5_preview_action"
  ]);

  const navigation = await client.callTool({
    name: "eu5_prepare_navigation_command",
    arguments: { name: "focus_capital" }
  });
  assert.equal(JSON.parse(navigation.content[0].text).hotkey, "ctrl+alt+c");

  const result = await client.callTool({
    name: "eu5_list_save_checkpoints",
    arguments: { saveDirectory: root, confirmedSaveDirectory: root }
  });
  const snapshot = JSON.parse(result.content[0].text);
  assert.equal(snapshot.fileCount, 1);
  assert.equal(snapshot.files[0].relativePath, "fixture.eu5");
});
