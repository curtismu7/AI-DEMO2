/**
 * JWT Verifier MCP Server
 * Provides tools for JWT verification, decoding, claims validation, and JWKS analysis
 */

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./services/logger.js";
import { errorToMcpResponse } from "./services/mcpErrors.js";

// Import tool handlers
import {
  handleJwtDecode,
  jwtDecodeToolDefinition,
} from "./actions/jwtDecode.js";
import {
  handleJwtVerifySignature,
  jwtVerifySignatureToolDefinition,
  handleJwtValidateClaims,
  jwtValidateClaimsToolDefinition,
} from "./actions/jwtVerify.js";
import {
  handleJwtFetchJwks,
  jwtFetchJwksToolDefinition,
  handleJwtInspectKey,
  jwtInspectKeyToolDefinition,
} from "./actions/jwksTools.js";

// ============================================================================
// Initialize Server
// ============================================================================

const server = new Server({
  name: "jwt-verifier-mcp-server",
  version: "1.0.0",
});

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS: Tool[] = [
  {
    name: jwtDecodeToolDefinition.name,
    description: jwtDecodeToolDefinition.description,
    inputSchema: jwtDecodeToolDefinition.inputSchema as any,
  },
  {
    name: jwtVerifySignatureToolDefinition.name,
    description: jwtVerifySignatureToolDefinition.description,
    inputSchema: jwtVerifySignatureToolDefinition.inputSchema as any,
  },
  {
    name: jwtValidateClaimsToolDefinition.name,
    description: jwtValidateClaimsToolDefinition.description,
    inputSchema: jwtValidateClaimsToolDefinition.inputSchema as any,
  },
  {
    name: jwtFetchJwksToolDefinition.name,
    description: jwtFetchJwksToolDefinition.description,
    inputSchema: jwtFetchJwksToolDefinition.inputSchema as any,
  },
  {
    name: jwtInspectKeyToolDefinition.name,
    description: jwtInspectKeyToolDefinition.description,
    inputSchema: jwtInspectKeyToolDefinition.inputSchema as any,
  },
];

// ============================================================================
// Request Handlers
// ============================================================================

/**
 * List available tools
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  logger.debug("Tool call received", {
    toolName: request.params.name,
    hasInput: !!request.params.arguments,
  });

  try {
    const result = await routeToolCall(
      request.params.name,
      request.params.arguments
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorResponse = errorToMcpResponse(error);
    logger.error("Tool call failed", error as Error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorResponse, null, 2),
        },
      ],
      isError: true,
    };
  }
});

server.setRequestHandler("tools/list" as any, async () => {
  return {
    tools: TOOLS,
  };
});

// ============================================================================
// Tool Router
// ============================================================================

/**
 * Route tool calls to appropriate handlers
 */
async function routeToolCall(toolName: string, input: unknown): Promise<unknown> {
  switch (toolName) {
    case "jwt_decode_full":
      return await handleJwtDecode(input);

    case "jwt_verify_signature":
      return await handleJwtVerifySignature(input);

    case "jwt_validate_claims":
      return await handleJwtValidateClaims(input);

    case "jwt_fetch_jwks":
      return await handleJwtFetchJwks(input);

    case "jwt_inspect_key":
      return await handleJwtInspectKey(input);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ============================================================================
// Startup
// ============================================================================

async function main(): Promise<void> {
  logger.info("JWT Verifier MCP Server starting", {
    version: "1.0.0",
    tools: TOOLS.length,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("JWT Verifier MCP Server connected and ready", {
    transport: "stdio",
  });
}

main().catch((error) => {
  logger.error("Failed to start server", error);
  process.exit(1);
});
