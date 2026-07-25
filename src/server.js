"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { listSaveCheckpoints } = require("./read/save-inventory");
const { validateActionPreview } = require("./control/action-gate");

const server = new McpServer({
  name: "eu5-control-mcp",
  version: "0.1.0"
});

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
