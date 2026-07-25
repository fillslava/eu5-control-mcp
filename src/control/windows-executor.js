"use strict";

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

class WindowsExecutor {
  constructor({ enabled, createClient, createTransport }) {
    this.enabled = enabled;
    this.createClient = createClient;
    this.createTransport = createTransport;
    this.client = null;
    this.transport = null;
    this.connecting = null;
    this.tail = Promise.resolve();
  }

  async ensureConnected() {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        const client = this.createClient();
        const transport = this.createTransport();
        await client.connect(transport);
        this.client = client;
        this.transport = transport;
        return client;
      })();
    }
    return this.connecting;
  }

  executeNavigation(command) {
    const run = async () => {
      if (!this.enabled) throw new Error("Windows execution is disabled; set EU5_ENABLE_WINDOWS_EXECUTION=true locally");
      const client = await this.ensureConnected();
      await client.callTool({ name: "App", arguments: { mode: "switch", name: "Europa Universalis V" } });
      await client.callTool({ name: "Shortcut", arguments: { shortcut: command.hotkey } });
      return {
        dispatched: true,
        executor: "nested-windows-mcp",
        shortcut: command.hotkey,
        verification: "Input was dispatched. Capture a fresh UI observation before treating the expected panel as open."
      };
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  async close() {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    this.transport = null;
    this.connecting = null;
    await client.close();
  }
}

function createWindowsExecutorFromEnvironment() {
  const command = process.env.EU5_WINDOWS_MCP_COMMAND || "uvx";
  return new WindowsExecutor({
    enabled: process.env.EU5_ENABLE_WINDOWS_EXECUTION === "true",
    createClient: () => new Client({ name: "eu5-control-windows-proxy", version: "0.1.0" }),
    createTransport: () => new StdioClientTransport({ command, args: ["windows-mcp", "serve"], stderr: "pipe" })
  });
}

module.exports = { WindowsExecutor, createWindowsExecutorFromEnvironment };
