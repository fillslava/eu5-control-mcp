"use strict";

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { COMMANDS } = require("./navigation-commands");

const EU5_WINDOW_NAME = "Europa Universalis V";
const SAFE_NAVIGATION_HOTKEYS = new Set(Object.values(COMMANDS).map((command) => command.hotkey));

function toolResultText(result) {
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function assertToolSucceeded(toolName, result) {
  if (!result || result.isError === true) {
    const detail = toolResultText(result);
    throw new Error(`Windows MCP ${toolName} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

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
      if (!SAFE_NAVIGATION_HOTKEYS.has(command?.hotkey)) {
        throw new TypeError("Windows executor only accepts catalogued EU5 navigation hotkeys");
      }
      const client = await this.ensureConnected();
      const focusResult = assertToolSucceeded(
        "App",
        await client.callTool({ name: "App", arguments: { mode: "switch", name: EU5_WINDOW_NAME } })
      );

      let focusVerificationResult;
      try {
        focusVerificationResult = assertToolSucceeded(
          "WaitFor",
          await client.callTool({
            name: "WaitFor",
            arguments: {
              condition: "active_window",
              window_name: EU5_WINDOW_NAME,
              timeout: 5,
              interval: 0.25
            }
          })
        );
      } catch (error) {
        const focusDetail = toolResultText(focusResult);
        throw new Error(
          `Windows MCP could not verify EU5 focus${focusDetail ? ` after App returned: ${focusDetail}` : ""}. ${error.message}`,
          { cause: error }
        );
      }

      const shortcutResult = assertToolSucceeded(
        "Shortcut",
        await client.callTool({ name: "Shortcut", arguments: { shortcut: command.hotkey } })
      );
      return {
        dispatched: true,
        executor: "nested-windows-mcp",
        shortcut: command.hotkey,
        windowsMcpResults: {
          focus: toolResultText(focusResult),
          focusVerification: toolResultText(focusVerificationResult),
          shortcut: toolResultText(shortcutResult)
        },
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
