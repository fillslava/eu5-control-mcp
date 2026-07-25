"use strict";

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { COMMANDS } = require("./navigation-commands");

const EU5_WINDOW_NAME = "Europa Universalis V";
const MAX_ABSOLUTE_FOCUS_COORDINATE = 32767;
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

function parseSafeFocusPoint(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new TypeError("EU5_WINDOWS_SAFE_FOCUS_POINT must be an x,y string");
  }

  const match = value.trim().match(/^(-?\d+)\s*,\s*(-?\d+)$/);
  if (!match) {
    throw new TypeError("EU5_WINDOWS_SAFE_FOCUS_POINT must contain exactly two integer coordinates in x,y form");
  }

  const point = match.slice(1).map(Number);
  if (
    point.some(
      (coordinate) =>
        !Number.isSafeInteger(coordinate) || Math.abs(coordinate) > MAX_ABSOLUTE_FOCUS_COORDINATE
    )
  ) {
    throw new RangeError(
      `EU5_WINDOWS_SAFE_FOCUS_POINT coordinates must be between -${MAX_ABSOLUTE_FOCUS_COORDINATE} and ${MAX_ABSOLUTE_FOCUS_COORDINATE}`
    );
  }
  return Object.freeze(point);
}

class WindowsExecutor {
  constructor({ enabled, safeFocusPoint, createClient, createTransport }) {
    this.enabled = enabled;
    this.safeFocusPoint = parseSafeFocusPoint(safeFocusPoint);
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

  async focusEu5(client) {
    try {
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

      return {
        method: "app-switch",
        focusResult,
        focusVerificationResult,
        primaryFocusError: null
      };
    } catch (primaryFocusError) {
      if (!this.safeFocusPoint) throw primaryFocusError;

      let focusResult;
      try {
        focusResult = assertToolSucceeded(
          "Click",
          await client.callTool({
            name: "Click",
            arguments: { loc: this.safeFocusPoint, button: "left", clicks: 1 }
          })
        );
      } catch (safePointError) {
        throw new Error(
          `Windows MCP could not focus EU5 by window name or configured safe point. Window-name path: ${primaryFocusError.message}. Safe-point path: ${safePointError.message}`,
          { cause: safePointError }
        );
      }

      return {
        method: "safe-point-click",
        focusResult,
        focusVerificationResult: null,
        primaryFocusError: primaryFocusError.message
      };
    }
  }

  executeNavigation(command) {
    const run = async () => {
      if (!this.enabled) throw new Error("Windows execution is disabled; set EU5_ENABLE_WINDOWS_EXECUTION=true locally");
      if (!SAFE_NAVIGATION_HOTKEYS.has(command?.hotkey)) {
        throw new TypeError("Windows executor only accepts catalogued EU5 navigation hotkeys");
      }
      const client = await this.ensureConnected();
      const focus = await this.focusEu5(client);

      const shortcutResult = assertToolSucceeded(
        "Shortcut",
        await client.callTool({ name: "Shortcut", arguments: { shortcut: command.hotkey } })
      );
      return {
        dispatched: true,
        executor: "nested-windows-mcp",
        shortcut: command.hotkey,
        windowsMcpResults: {
          focusMethod: focus.method,
          focus: toolResultText(focus.focusResult),
          focusVerification: focus.focusVerificationResult
            ? toolResultText(focus.focusVerificationResult)
            : null,
          primaryFocusError: focus.primaryFocusError,
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

function createWindowsExecutorFromEnvironment(environment = process.env) {
  const command = environment.EU5_WINDOWS_MCP_COMMAND || "uvx";
  return new WindowsExecutor({
    enabled: environment.EU5_ENABLE_WINDOWS_EXECUTION === "true",
    safeFocusPoint: environment.EU5_WINDOWS_SAFE_FOCUS_POINT,
    createClient: () => new Client({ name: "eu5-control-windows-proxy", version: "0.1.0" }),
    createTransport: () => new StdioClientTransport({ command, args: ["windows-mcp", "serve"], stderr: "pipe" })
  });
}

module.exports = { WindowsExecutor, createWindowsExecutorFromEnvironment, parseSafeFocusPoint };
