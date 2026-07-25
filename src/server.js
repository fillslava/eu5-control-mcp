"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { listSaveCheckpoints } = require("./read/save-inventory");
const { latestSaveCheckpoint } = require("./read/latest-save");
const { validateActionPreview } = require("./control/action-gate");
const { COMMANDS, prepareNavigationCommand } = require("./control/navigation-commands");
const { validateFreshNavigationObservation } = require("./control/command-gate");
const { createWindowsExecutorFromEnvironment } = require("./control/windows-executor");

const server = new McpServer({
  name: "eu5-control-mcp",
  version: "0.1.0"
});
const windowsExecutor = createWindowsExecutorFromEnvironment();

server.registerTool(
  "eu5_list_save_checkpoints",
  {
    title: "List EU5 save checkpoints",
    description: "Read metadata and SHA-256 hashes for .eu5 files. Never parses or changes save contents.",
    inputSchema: {
      saveDirectory: z.string().min(1).optional().describe("Optional absolute directory containing EU5 .eu5 saves. Defaults to this user's standard EU5 save folder."),
      confirmedSaveDirectory: z.string().min(1).optional().describe("Optional explicit confirmation for a non-default directory. Must match saveDirectory."),
      includeSubfolders: z.boolean().optional().default(false)
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  async (input) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(listSaveCheckpoints(input), null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: `Safe save inventory error: ${error.message}` }] };
    }
  }
);

server.registerTool(
  "eu5_observe_checkpoint",
  {
    title: "Observe the latest EU5 save checkpoint",
    description: "Fast metadata-only observation of the newest .eu5 save. Never reads save content or sends game input.",
    inputSchema: {
      saveDirectory: z.string().min(1).optional().describe("Optional absolute save directory. Defaults to EU5_SAVE_DIRECTORY."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  async (input) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(latestSaveCheckpoint(input.saveDirectory), null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: `Fast checkpoint observation error: ${error.message}` }] };
    }
  }
);

server.registerTool(
  "eu5_prepare_navigation_command",
  {
    title: "Prepare a safe EU5 navigation command",
    description: "Return a verified hotkey procedure for Windows MCP. This tool never sends input itself.",
    inputSchema: {
      name: z.enum(Object.keys(COMMANDS))
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  async ({ name }) => ({
    content: [{ type: "text", text: JSON.stringify(prepareNavigationCommand(name), null, 2) }]
  })
);

server.registerTool(
  "eu5_issue_navigation_command",
  {
    title: "Issue a guarded EU5 navigation command",
    description: "Validate a fresh paused UI observation, then return one Windows-MCP hotkey procedure. Never sends input itself.",
    inputSchema: {
      name: z.enum(Object.keys(COMMANDS)),
      observation: z.object({
        id: z.string().min(1),
        capturedAtUtc: z.string().datetime(),
        paused: z.boolean(),
        modalPresent: z.boolean(),
        textEntryFocused: z.boolean()
      })
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  async ({ name, observation }) => {
    const verified = validateFreshNavigationObservation(observation);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ ...prepareNavigationCommand(name), observationId: verified.id }, null, 2)
      }]
    };
  }
);

server.registerTool(
  "eu5_execute_navigation_command",
  {
    title: "Execute one guarded EU5 navigation command",
    description: "Focus EU5 and dispatch one allowlisted navigation hotkey through nested Windows MCP. The result still requires a fresh UI observation.",
    inputSchema: {
      name: z.enum(Object.keys(COMMANDS)),
      observation: z.object({
        id: z.string().min(1),
        capturedAtUtc: z.string().datetime(),
        paused: z.boolean(),
        modalPresent: z.boolean(),
        textEntryFocused: z.boolean()
      })
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  async ({ name, observation }) => {
    try {
      const verified = validateFreshNavigationObservation(observation);
      const command = prepareNavigationCommand(name);
      const result = await windowsExecutor.executeNavigation(command);
      return { content: [{ type: "text", text: JSON.stringify({ ...command, ...result, observationId: verified.id }, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: `Navigation execution blocked: ${error.message}` }] };
    }
  }
);

server.registerTool(
  "eu5_preview_action",
  {
    title: "Preview an EU5 action",
    description: "Validate a proposed action without touching the game or its files.",
    inputSchema: {
      id: z.string().min(1),
      risk: z.enum(["read_only", "reversible", "consequential", "critical"]),
      expectedVisibleResult: z.string().min(1),
      preconditions: z.array(z.string().min(1)).min(1)
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  async (action) => ({
    content: [{ type: "text", text: JSON.stringify(validateActionPreview(action), null, 2) }]
  })
);

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function closeWindowsExecutor() {
  try { await windowsExecutor.close(); } catch (error) { console.error(error); }
}
process.once("SIGINT", closeWindowsExecutor);
process.once("SIGTERM", closeWindowsExecutor);
