"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { WindowsExecutor } = require("../src/control/windows-executor");

function fakeExecutor({ failFocus = false } = {}) {
  const calls = [];
  const client = {
    connect: async () => calls.push("connect"),
    callTool: async (request) => {
      calls.push(request);
      if (failFocus && request.name === "App") throw new Error("focus failed");
      return { content: [] };
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
    { name: "Shortcut", arguments: { shortcut: "ctrl+f2" } }
  ]);
});

test("Windows executor stops before shortcut when focusing EU5 fails", async () => {
  const { executor, calls } = fakeExecutor({ failFocus: true });
  await assert.rejects(() => executor.executeNavigation({ hotkey: "ctrl+f2" }));
  assert.equal(calls.some((call) => call.name === "Shortcut"), false);
});

test("Windows executor requires explicit local enablement", async () => {
  const executor = new WindowsExecutor({ enabled: false, createClient: () => null, createTransport: () => null });
  await assert.rejects(() => executor.executeNavigation({ hotkey: "ctrl+f2" }), /disabled/);
});
