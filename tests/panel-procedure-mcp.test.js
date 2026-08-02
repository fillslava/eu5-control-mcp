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
    env: {
      ...process.env,
      EU5_OBSERVATION_MAX_AGE_MS: "45000"
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "panel-procedure-mcp-test", version: "0.1.0" });
  await client.connect(transport);
  t.after(async () => client.close());
  return client;
}

function panelObservation(overrides = {}) {
  return {
    id: "panel-observation-1",
    capturedAtUtc: new Date().toISOString(),
    screenshot: {
      reference: "computer-use:panel-screenshot-1"
    },
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
    screenId: "control_panel",
    consoleVisible: false,
    consoleClosed: true,
    visibleControls: [{
      role: "button",
      label: "Emit state snapshot",
      visible: true,
      enabled: true
    }],
    ...overrides
  };
}

function parse(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

test("MCP exposes finite semantic panel and Backquote preparations", async (t) => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  const panelTool = tools.find(({ name }) => name === "eu5_prepare_panel_interaction");
  const dismissTool = tools.find(({ name }) => name === "eu5_prepare_console_dismiss");
  assert.ok(panelTool);
  assert.ok(dismissTool);

  const serialized = JSON.stringify([panelTool.inputSchema, dismissTool.inputSchema]);
  for (const forbidden of ["coordinate", "\"x\"", "\"y\"", "macro", "command"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.doesNotMatch(serialized, /"text"\s*:/);

  const panel = parse(await client.callTool({
    name: "eu5_prepare_panel_interaction",
    arguments: {
      name: "refresh_state",
      observation: panelObservation()
    }
  }));
  assert.equal(panel.executionPerformed, false);
  assert.equal(panel.externalExecutionRequired, true);
  assert.equal(panel.preparation.name, "refresh_state");
  assert.equal(panel.preparation.dispatch.operation, "click_visible_control");
  assert.deepEqual(
    panel.preparation.dispatch.locator.exactLabels,
    ["Emit state snapshot"]
  );
  assert.equal(panel.preparation.dispatch.storedCoordinates, false);
  assert.deepEqual(panel.preparation.expectedEvidence, {
    kind: "fresh_debug_record",
    recordType: "state_snapshot",
    procedure: "emit_state_snapshot"
  });

  const dismiss = parse(await client.callTool({
    name: "eu5_prepare_console_dismiss",
    arguments: {
      observation: panelObservation({
        id: "console-observation-1",
        screenId: "debug_console",
        consoleVisible: true,
        consoleClosed: false,
        visibleControls: []
      })
    }
  }));
  assert.equal(dismiss.executionPerformed, false);
  assert.equal(dismiss.preparation.name, "dismiss_debug_console");
  assert.equal(dismiss.preparation.dispatch.key, "Backquote");
  assert.equal(dismiss.preparation.dispatch.keyPressCount, 1);
  assert.equal("text" in dismiss.preparation.dispatch, false);
  assert.equal("command" in dismiss.preparation.dispatch, false);
});

test("MCP panel preparation rejects stale evidence and an open console", async (t) => {
  const client = await connect(t);
  const stale = await client.callTool({
    name: "eu5_prepare_panel_interaction",
    arguments: {
      name: "refresh_state",
      observation: panelObservation({
        capturedAtUtc: new Date(Date.now() - 45_001).toISOString()
      })
    }
  });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /stale or from the future/);

  const openConsole = await client.callTool({
    name: "eu5_prepare_panel_interaction",
    arguments: {
      name: "refresh_state",
      observation: panelObservation({
        consoleVisible: true,
        consoleClosed: false
      })
    }
  });
  assert.equal(openConsole.isError, true);
  assert.match(openConsole.content[0].text, /positively observed as closed/);
});

test("MCP semantic preparations reject unsafe control observations", async (t) => {
  const client = await connect(t);
  const cases = [
    {
      name: "wrong focus",
      override: { window: { ...panelObservation().window, focused: false } }
    },
    {
      name: "ambiguous window count",
      override: {
        window: { ...panelObservation().window, visibleEu5WindowCount: 2 }
      }
    },
    {
      name: "modal present",
      override: { game: { ...panelObservation().game, modalPresent: true } }
    },
    {
      name: "text focus",
      override: {
        game: { ...panelObservation().game, textEntryFocused: true }
      }
    },
    {
      name: "test session mismatch",
      override: {
        session: { ...panelObservation().session, testMarkerMatched: false }
      }
    },
    {
      name: "reviewed build mismatch",
      override: {
        session: { ...panelObservation().session, gameBuildMatched: false }
      }
    },
    {
      name: "reviewed manifest mismatch",
      override: {
        session: { ...panelObservation().session, modManifestMatched: false }
      }
    }
  ];

  for (const item of cases) {
    const panel = await client.callTool({
      name: "eu5_prepare_panel_interaction",
      arguments: {
        name: "refresh_state",
        observation: panelObservation(item.override)
      }
    });
    assert.equal(panel.isError, true, `panel must reject ${item.name}`);

    const dismiss = await client.callTool({
      name: "eu5_prepare_console_dismiss",
      arguments: {
        observation: panelObservation({
          ...item.override,
          screenId: "debug_console",
          consoleVisible: true,
          consoleClosed: false,
          visibleControls: []
        })
      }
    });
    assert.equal(dismiss.isError, true, `dismiss must reject ${item.name}`);
  }
});

test("MCP schemas reject arbitrary coordinates, keys, labels, and console state claims", async (t) => {
  const client = await connect(t);
  const coordinate = await client.callTool({
    name: "eu5_prepare_panel_interaction",
    arguments: {
      name: "refresh_state",
      observation: {
        ...panelObservation(),
        x: 300,
        y: 400
      }
    }
  });
  assert.equal(coordinate.isError, true);

  const unknownLabel = await client.callTool({
    name: "eu5_prepare_panel_interaction",
    arguments: {
      name: "refresh_state",
      observation: panelObservation({
        visibleControls: [{
          role: "button",
          label: "Execute arbitrary command",
          visible: true,
          enabled: true
        }]
      })
    }
  });
  assert.equal(unknownLabel.isError, true);

  const closedConsole = await client.callTool({
    name: "eu5_prepare_console_dismiss",
    arguments: {
      observation: panelObservation({
        screenId: "debug_console",
        consoleVisible: false,
        consoleClosed: true,
        visibleControls: []
      })
    }
  });
  assert.equal(closedConsole.isError, true);

  const arbitraryKey = await client.callTool({
    name: "eu5_prepare_console_dismiss",
    arguments: {
      key: "Enter",
      observation: panelObservation({
        screenId: "debug_console",
        consoleVisible: true,
        consoleClosed: false,
        visibleControls: []
      })
    }
  });
  assert.equal(arbitraryKey.isError, true);
});

test("MCP prepares the exact v0.5.0 market label and evidence mapping", async (t) => {
  const client = await connect(t);
  const result = parse(await client.callTool({
    name: "eu5_prepare_panel_interaction",
    arguments: {
      name: "export_markets",
      observation: panelObservation({
        id: "market-panel-observation",
        visibleControls: [{
          role: "button",
          label: "Export capital market",
          visible: true,
          enabled: true
        }]
      })
    }
  }));
  assert.deepEqual(
    result.preparation.dispatch.locator.exactLabels,
    ["Export capital market"]
  );
  assert.deepEqual(result.preparation.expectedEvidence, {
    kind: "fresh_debug_record",
    recordType: "markets_snapshot",
    procedure: "emit_markets_snapshot"
  });
});
