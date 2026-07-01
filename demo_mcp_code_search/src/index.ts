import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "code-search",
    version: "1.0.0",
  },
  {
    // Must declare the tools capability or the SDK throws
    // "Server does not support tools" when registering tools/list handlers.
    capabilities: { tools: {} },
  },
);

const tools: Tool[] = [
  {
    name: "index_codebase",
    description: "Index a codebase into the vector database",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "string",
          description: "Base64-encoded ZIP of source files",
        },
        codebase_id: {
          type: "string",
          description: "Unique identifier for the codebase",
        },
        codebase_name: {
          type: "string",
          description: "Human-readable name for the codebase",
        },
        chunk_strategy: {
          type: "string",
          enum: ["simple", "ast_aware"],
          description: "Chunking strategy (default: simple)",
        },
      },
      required: ["files", "codebase_id", "codebase_name"],
    },
  },
  {
    name: "search_code",
    description: "Search indexed code by semantic query",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language or code query",
        },
        codebase_id: {
          type: "string",
          description: "Which codebase to search",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10)",
        },
        file_filter: {
          type: "string",
          description: "Glob pattern to filter files",
        },
      },
      required: ["query", "codebase_id"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "index_codebase") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              codebase_id: (args as any).codebase_id,
              files_indexed: 0,
              chunks_created: 0,
              errors: ["MCP server is running but services not fully initialized. Run with Docker for full functionality."],
            }),
          },
        ],
      };
    } else if (name === "search_code") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              results: [],
              query_time_ms: 0,
              query: (args as any).query,
            }),
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : error}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  console.error("[MCP Code Search] Initializing server...");
  console.error("[MCP Code Search] For full functionality, run with Docker:");
  console.error("  docker-compose up");
  console.error("[MCP Code Search] Listening on stdio transport");

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
