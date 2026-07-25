"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { WindowsExecutor } = require("../src/control/windows-executor");

function fakeExecutor({ failFocus = false, toolResults = {} } = {}) {
  const calls = [];
  const client = {
    connect: async () => calls.push("connect"),
    callTool: async (request) => {
      calls.push(request);
      if (failFocus && request.name === "App") throw new Error("focus failed");
      return toolResults[request.name] || {
        content: [{ type: "text", text: `${request.name} ok` }]
      };
    },
    close: async () => calls.push("close")
  };
  return {
    calls,
    executor: new WindowsExecutor({
      enabled: true,
      createClient: () => client,
      createTransport: () => ({})
    })
  };
}

test("Windows executor focuses EU5 before dispatching an allowlisted shortcut", async () => {
  const { executor, calls } = fakeExecutor();
  const result = await executor.executeNavigation({ hotkey: "ctrl+f2" });
  assert.equal(result.dispatched, true);
  assert.deepEqual(calls, [
    "connect",
    { name: "App", arguments: { mode: "switch", name: "Europa Universalis V" } },
    {
      name: "WaitFor",
      arguments: {
        condition: "active_window",
        window_name: "Europa Universalis V",
        timeout: 5,
        interval: 0.25
      }
    },
    { name: "Shortcut", arguments: { shortcut: "ctrl+f2" } }
  ]);
  assert.deepEqual(result.windowsMcpResults, {
    focus: "App ok",
    focusVerification: "WaitFor ok",
    shortcut: "Shortcut ok"
  });
});

test("Windows executor stops before shortcut when focusing EU5 fails", async () => {
  const { executor, calls } = fakeExecutor({ failFocus: true });
  await assert.rejects(() => executor.executeNavigation({ hotkey: "ctrl+f2" }));
  assert.equal(calls.some((call) => call.name === "Shortcut"), false);
});

test("Windows executor treats an App tool error as a failure", async () => {
  const { executor, calls } = fakeExecutor({
    toolResults: {
      App: {
        isError: true,
        content: [{ type: "text", text: "Europa Universalis V window not found." }]
      }
    }
  });

  await assert.rejects(
    () => executor.executeNavigation({ hotkey: "ctrl+f2" }),
    /Windows MCP App failed: Europa Universalis V window not found/
  );
  assert.equal(calls.some((call) => call.name === "WaitFor"), false);
  assert.equal(calls.some((call) => call.name === "Shortcut"), false);
});

test("Windows executor requires explicit local enablement", async () => {
  const executor = new WindowsExecutor({ enabled: false, createClient: () => null, createTransport: () => null });
  await assert.rejects(() => executor.executeNavigation({ hotkey: "ctrl+f2" }), /disabled/);
});

test("Windows executor stops before shortcut when active-window verification is a tool error", async () => {
  const { executor, calls } = fakeExecutor({
    toolResults: {
      App: { content: [{ type: "text", text: "Switched to Europa Universalis V window." }] },
      WaitFor: {
        isError: true,
        content: [{ type: "text", text: "Timed out waiting for 'active_window'." }]
      }
    }
  });

  await assert.rejects(
    () => executor.executeNavigation({ hotkey: "ctrl+f2" }),
    /could not verify EU5 focus.*Switched to Europa Universalis V.*Timed out/s
  );
  assert.equal(calls.some((call) => call.name === "Shortcut"), false);
});

test("Windows executor rejects a Shortcut tool error instead of reporting dispatched", async () => {
  const { executor } = fakeExecutor({
    toolResults: {
      Shortcut: {
        isError: true,
        content: [{ type: "text", text: "Unable to send keys." }]
      }
    }
  });

  await assert.rejects(
    () => executor.executeNavigation({ hotkey: "ctrl+f2" }),
    /Windows MCP Shortcut failed: Unable to send keys/
  );
});

test("Windows executor rejects hotkeys outside the finite navigation catalog", async () => {
  const { executor, calls } = fakeExecutor();
  await assert.rejects(
    () => executor.executeNavigation({ hotkey: "alt+f4" }),
    /only accepts catalogued EU5 navigation hotkeys/
  );
  assert.deepEqual(calls, []);
});
