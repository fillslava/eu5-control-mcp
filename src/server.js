"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { listSaveCheckpoints } = require("./read/save-inventory");
const { latestSaveCheckpoint } = require("./read/latest-save");
const { listDebugExports } = require("./read/debug-export-inventory");
const { validateActionPreview } = require("./control/action-gate");
const { COMMANDS, prepareNavigationCommand } = require("./control/navigation-commands");
const {
  CLICK_PROCEDURES,
  prepareClickNavigation
} = require("./control/click-navigation-procedures");
const { validateFreshNavigationObservation } = require("./control/command-gate");
const { ControlProtocol } = require("./control/control-protocol");

// This protocol only records the coordinator's lifecycle claims. It never has
// access to a UI-input primitive, so dispatch cannot send clicks or keys.
const controlProtocol = new ControlProtocol();

const server = new McpServer({
  name: "eu5-control-mcp",
  version: "0.1.0"
});

server.registerTool(
  "eu5_list_debug_exports",
  {
    title: "List EU5 debug exports",
    description:
      "Return metadata-only inventory for console.txt, docs/*.log, and logs/data_types/*.txt under EU5_USER_DIRECTORY or the standard EU5 user folder. Never reads file contents or executes console commands.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  async () => {
    try {
      return {
        content: [{
          type: "text",
          text: JSON.stringify(listDebugExports(), null, 2)
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Safe debug-export inventory error: ${error.message}`
        }]
      };
    }
  }
);

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
  "eu5_prepare_click_navigation",
  {
    title: "Prepare a provisional EU5 click-navigation candidate",
    description:
      "Return one non-operational click candidate scaled from the 1536x900 EU5 catalog baseline for a closely matching viewport. Fresh visual target verification is required before use. This tool never sends input.",
    inputSchema: {
      name: z.enum(Object.keys(CLICK_PROCEDURES)),
      viewport: z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive()
      })
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  async ({ name, viewport }) => ({
    content: [{
      type: "text",
      text: JSON.stringify(prepareClickNavigation(name, viewport), null, 2)
    }]
  })
);

server.registerTool(
  "eu5_issue_navigation_command",
  {
    title: "Validate a guarded EU5 navigation command",
    description: "Validate a fresh paused UI observation, then return one direct Windows MCP hotkey procedure. This tool never sends input.",
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

function protocolResult(operation) {
  try {
    return { content: [{ type: "text", text: JSON.stringify(operation(), null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Control protocol rejected: ${error.message}` }] };
  }
}

server.registerTool("eu5_declare_action", {
  title: "Declare one EU5 action for controlled execution",
  description: "Append a declared action to the local audit ledger. Idempotency keys prevent accidental duplicate declarations; this never sends UI input.",
  inputSchema: {
    idempotencyKey: z.string().min(1), campaign: z.string().min(1), version: z.string().min(1),
    action: z.object({ id: z.string().min(1), risk: z.enum(["read_only", "reversible", "consequential", "critical"]), expectedVisibleResult: z.string().min(1), preconditions: z.array(z.string().min(1)).min(1) })
  }, annotations: { readOnlyHint: false, destructiveHint: false }
}, async (input) => protocolResult(() => controlProtocol.declare(input)));

server.registerTool("eu5_authorize_action", {
  title: "Authorize one declared EU5 action",
  description: "Validate a one-use externally signed approval artifact. MCP never creates approvals or exposes the signing secret.",
  inputSchema: { declarationId: z.string().uuid(), approval: z.object({ approvalId: z.string().uuid(), declarationId: z.string().uuid(), actionDigest: z.string().regex(/^[a-f0-9]{64}$/), campaign: z.string().min(1), version: z.string().min(1), expiresAtUtc: z.string().datetime(), signature: z.string().regex(/^[a-f0-9]{64}$/) }) }, annotations: { readOnlyHint: false, destructiveHint: false }
}, async (input) => protocolResult(() => controlProtocol.authorize(input)));

server.registerTool("eu5_dispatch_action", {
  title: "Prepare an authorized EU5 action dispatch",
  description: "Consume one unexpired authorization and append a dispatch-prepared record. No UI input is executed; an external supervised executor is required.",
  inputSchema: { authorizationId: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: false }
}, async (input) => protocolResult(() => controlProtocol.dispatch(input)));

server.registerTool("eu5_record_action_outcome", {
  title: "Record a visible EU5 action outcome",
  description: "Append the external executor's observed visible result. It cannot execute or repeat any action.",
  inputSchema: { dispatchId: z.string().uuid(), actualVisibleResult: z.string().min(1), observedAtUtc: z.string().datetime(), evidence: z.object({ reference: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), adapterId: z.string().min(1).optional(), adapterVersion: z.string().min(1).optional() }) }, annotations: { readOnlyHint: false, destructiveHint: false }
}, async (input) => protocolResult(() => controlProtocol.outcome(input)));

server.registerTool("eu5_verify_action_outcome", {
  title: "Verify a recorded EU5 action outcome",
  description: "Close the lifecycle by recording whether the external visible observation matched expectations. A mismatch requires stopping.",
  inputSchema: { outcomeId: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: false }
}, async (input) => protocolResult(() => controlProtocol.verify(input)));

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
