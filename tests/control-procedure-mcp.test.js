"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function connect(t) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, "..", "src", "server.js")],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env },
    stderr: "pipe"
  });
  const client = new Client({ name: "control-procedure-mcp-test", version: "0.1.0" });
  await client.connect(transport);
  t.after(async () => client.close());
  return client;
}

function freshObservation(overrides = {}) {
  return {
    id: "observation-1",
    capturedAtUtc: new Date().toISOString(),
    window: {
      visibleEu5WindowCount: 1,
      processName: "eu5.exe",
      title: "Europa Universalis V",
      focused: true
    },
    game: {
      paused: true,
      modalPresent: false,
      textEntryFocused: false
    },
    session: {
      testMarkerMatched: true,
      gameBuildMatched: true,
      modManifestMatched: true
    },
    screenId: "map",
    visibleControls: [],
    ...overrides
  };
}

function parse(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

test("MCP exposes a finite policy catalogue without an input executor", async (t) => {
  const client = await connect(t);
  const result = parse(await client.callTool({
    name: "eu5_list_control_procedures",
    arguments: {}
  }));

  assert.equal(result.catalogId, "eu5.control-procedure-catalog/v1");
  assert.equal(result.serverCanDispatch, false);
  assert.equal(result.coordinatorDispatchRequired, false);
  assert.equal(result.arbitraryInputAccepted, false);
  assert.equal(result.outcomePolicy.missingAcknowledgement, "execution_unknown");
  assert.equal(result.outcomePolicy.automaticRetryAllowed, false);
  assert.equal(result.observationPolicy.maxAgeMs, 45_000);
  assert.equal(result.observationPolicy.configuredBy, "EU5_OBSERVATION_MAX_AGE_MS");
  assert.deepEqual(
    result.procedures.map(({ name }) => name),
    [
      "focus_game",
      "pause",
      "pause_now",
      "confirm_paused",
      "dismiss_information_modal",
      "abort_to_pause",
      "recover_known_screen",
      "open_control_panel",
      "dismiss_debug_console",
      "refresh_state",
      "open_capital",
      "economy",
      "markets",
      "diplomacy",
      "military",
      "alerts",
      "back",
      "close"
    ]
  );

  const { tools } = await client.listTools();
  const preparation = tools.find(({ name }) => name === "eu5_prepare_control_procedure");
  const serializedSchema = JSON.stringify(preparation.inputSchema);
  for (const forbidden of ["shortcut", "coordinate", "macro", "console", "effect"]) {
    assert.equal(serializedSchema.includes(`\"${forbidden}\"`), false);
  }
});

test("MCP rejects unproven routes from a fresh observation without dispatch metadata", async (t) => {
  const client = await connect(t);
  const ready = parse(await client.callTool({
    name: "eu5_prepare_control_procedure",
    arguments: {
      name: "economy",
      observation: freshObservation()
    }
  }));

  assert.equal(ready.executionPerformed, false);
  assert.equal(ready.coordinatorDispatchRequired, false);
  assert.equal(ready.gate.allowed, false);
  assert.equal(ready.gate.code, "non_operational_route");
  assert.equal(ready.gate.dispatch, null);
  assert.equal(ready.gate.automaticRetryAllowed, false);

  const stale = parse(await client.callTool({
    name: "eu5_prepare_control_procedure",
    arguments: {
      name: "economy",
      observation: freshObservation({
        capturedAtUtc: new Date(Date.now() - 46_000).toISOString()
      })
    }
  }));
  assert.equal(stale.gate.allowed, false);
  assert.equal(stale.gate.code, "stale_observation");
  assert.equal(stale.gate.dispatch, null);
});

test("MCP rejects outcome claims for disabled candidates with no retry", async (t) => {
  const client = await connect(t);
  const unknown = parse(await client.callTool({
    name: "eu5_classify_control_procedure_outcome",
    arguments: {
      name: "economy",
      observedAtUtc: new Date().toISOString(),
      evidenceReference: {
        reference: "screenshot:observation-2",
        sha256: "a".repeat(64)
      },
      outcome: {
        acknowledged: false,
        evidenceConclusive: false
      }
    }
  }));

  assert.equal(unknown.executionPerformed, false);
  assert.equal(unknown.persisted, false);
  assert.equal(unknown.classification.state, "rejected");
  assert.equal(unknown.classification.code, "non_operational_route");
  assert.equal(unknown.classification.stopRequired, true);
  assert.equal(unknown.classification.automaticRetryAllowed, false);

  const verified = parse(await client.callTool({
    name: "eu5_classify_control_procedure_outcome",
    arguments: {
      name: "economy",
      observedAtUtc: new Date().toISOString(),
      evidenceReference: {
        reference: "screenshot:observation-3",
        sha256: "b".repeat(64)
      },
      outcome: {
        acknowledged: true,
        evidenceConclusive: true,
        evidence: {
          kind: "screen",
          screenId: "economy",
          visibleTexts: ["Экономика"]
        }
      }
    }
  }));
  assert.equal(verified.classification.state, "rejected");
  assert.equal(verified.classification.code, "non_operational_route");
  assert.equal(verified.classification.verified, false);
  assert.equal(verified.automaticRetryAllowed, false);
});

test("MCP rejects arbitrary procedure names and extra input fields", async (t) => {
  const client = await connect(t);
  const arbitrary = await client.callTool({
    name: "eu5_prepare_control_procedure",
    arguments: {
      name: "execute_effect",
      observation: freshObservation()
    }
  });
  assert.equal(arbitrary.isError, true);

  const injected = await client.callTool({
    name: "eu5_prepare_control_procedure",
    arguments: {
      name: "economy",
      observation: {
        ...freshObservation(),
        macro: "ctrl+alt+delete"
      }
    }
  });
  assert.equal(injected.isError, true);
});
