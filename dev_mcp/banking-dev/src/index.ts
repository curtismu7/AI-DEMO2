#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z, ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { loadEnv } from "./shared/env";
import {
  logsCorrelate,
  logsCorrelateSchema,
  logsErrors,
  logsErrorsSchema,
  logsGrep,
  logsGrepSchema,
  logsOauthFlow,
  logsOauthFlowSchema,
  logsTail,
  logsTailSchema,
} from "./tools/logs";
import {
  backupList,
  bootstrapSummary,
  configGet,
  configGetSchema,
  configListKeys,
  configListKeysSchema,
  sampleDataSummary,
  sessionsGet,
  sessionsGetSchema,
  sessionsList,
  sessionsListSchema,
} from "./tools/state";
import {
  tokenchainDecode,
  tokenchainDecodeSchema,
  tokenchainDiff,
  tokenchainDiffSchema,
  tokenchainExplain,
  tokenchainExplainSchema,
  tokenchainIntrospect,
  tokenchainIntrospectSchema,
} from "./tools/tokenchain";
import {
  pingoneGetApp,
  pingoneGetAppSchema,
  pingoneGetResourceScopes,
  pingoneGetResourceScopesSchema,
  pingoneGetUser,
  pingoneGetUserSchema,
  pingoneListApps,
  pingoneListAppsSchema,
  pingoneListResources,
  pingoneListResourcesSchema,
  pingoneListUsers,
  pingoneListUsersSchema,
  pingoneUpdateUserAttribute,
  pingoneUpdateUserAttributeSchema,
} from "./tools/pingone";

interface ToolEntry {
  name: string;
  description: string;
  schema: ZodTypeAny;
  handler: (args: unknown) => Promise<unknown> | unknown;
  readOnly: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _zodToJsonSchema = zodToJsonSchema as unknown as (s: any, o: any) => any;

function toJsonSchema(s: ZodTypeAny): Record<string, unknown> {
  // The library's return type recurses past TS's depth limit under strict mode.
  // Cast at the call site; runtime result is a plain JSON Schema object.
  const out: Record<string, unknown> = _zodToJsonSchema(s, { $refStrategy: "none" });
  delete out.$schema;
  return out;
}

loadEnv();

const tools: ToolEntry[] = [
  // logs_*
  {
    name: "logs_tail",
    description:
      "Tail the last N lines of one Super Banking service log file under /tmp. Read-only.",
    schema: logsTailSchema,
    handler: (a) => logsTail(logsTailSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "logs_grep",
    description:
      "Search across all (or selected) service logs for a literal or /regex/. Returns matches in chronological order, capped at 4KB.",
    schema: logsGrepSchema,
    handler: (a) => logsGrep(logsGrepSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "logs_correlate",
    description:
      "Find every log line containing a specific X-Request-ID across all services. The killer feature for OAuth/MCP debugging.",
    schema: logsCorrelateSchema,
    handler: (a) => logsCorrelate(logsCorrelateSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "logs_errors",
    description:
      "Return error lines from all services in a recent time window, deduped by coarse signature. Shows the noisiest errors first.",
    schema: logsErrorsSchema,
    handler: (a) => logsErrors(logsErrorsSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "logs_oauth_flow",
    description:
      "Curated view of OAuth + token-exchange events across all services (the same surface as the Token Chain UI but as text).",
    schema: logsOauthFlowSchema,
    handler: (a) => logsOauthFlow(logsOauthFlowSchema.parse(a)),
    readOnly: true,
  },

  // state_*
  {
    name: "state_sessions_list",
    description:
      "List sessions from banking_api_server/data/sessions.db. Tokens redacted. Returns sid, expiry, sub, scope, aud.",
    schema: sessionsListSchema,
    handler: (a) => sessionsList(sessionsListSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "state_sessions_get",
    description: "Fetch one session by sid. Tokens redacted.",
    schema: sessionsGetSchema,
    handler: (a) => sessionsGet(sessionsGetSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "state_config_get",
    description:
      "Read one configStore key from banking_api_server/data/runtimeData.json (falls back to env). Secret-shaped keys are redacted.",
    schema: configGetSchema,
    handler: (a) => configGet(configGetSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "state_config_list_keys",
    description: "Enumerate every key present in runtimeData.json. Optional substring filter.",
    schema: configListKeysSchema,
    handler: (a) => configListKeys(configListKeysSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "state_sample_data_summary",
    description:
      "Coarse counts of users/accounts/transactions in banking_api_server/data/sampleData.js. Does NOT require() the module.",
    schema: z.object({}),
    handler: () => sampleDataSummary(),
    readOnly: true,
  },
  {
    name: "state_backup_list",
    description: "List files in banking_api_server/data/backups/ sorted by mtime descending.",
    schema: z.object({}),
    handler: () => backupList(),
    readOnly: true,
  },
  {
    name: "state_bootstrap_summary",
    description:
      "Summary of banking_api_server/data/bootstrapData.json: existence, size, top-level keys.",
    schema: z.object({}),
    handler: () => bootstrapSummary(),
    readOnly: true,
  },

  // tokenchain_*
  {
    name: "tokenchain_decode",
    description:
      "Decode a JWT WITHOUT signature validation. Returns header, payload, and a demo-aware summary (aud, scope, act, may_act, exp).",
    schema: tokenchainDecodeSchema,
    handler: (a) => tokenchainDecode(tokenchainDecodeSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "tokenchain_diff",
    description:
      "Side-by-side diff of two JWTs. Highlights aud mismatch, scope drift, act presence change, exp delta.",
    schema: tokenchainDiffSchema,
    handler: (a) => tokenchainDiff(tokenchainDiffSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "tokenchain_explain",
    description:
      "Composite verdict: decode token + check against demo rules (aud matches PINGONE_RESOURCE_MCP_SERVER_URI, has required scopes, has act, not expired). Returns ok/warning/fail with reasons.",
    schema: tokenchainExplainSchema,
    handler: (a) => tokenchainExplain(tokenchainExplainSchema.parse(a)),
    readOnly: true,
  },
];

// Gated read tool: introspection burns PingOne quota.
if (process.env.DEV_MCP_INTROSPECT === "1") {
  tools.push({
    name: "tokenchain_introspect",
    description:
      "Call PingOne /introspect with the configured worker token. Requires DEV_MCP_INTROSPECT=1 (gated to control quota).",
    schema: tokenchainIntrospectSchema,
    handler: (a) => tokenchainIntrospect(tokenchainIntrospectSchema.parse(a)),
    readOnly: true,
  });
}

// PingOne read tools
tools.push(
  {
    name: "pingone_list_users",
    description:
      "List users from the configured PingOne environment via Management API. Read-only.",
    schema: pingoneListUsersSchema,
    handler: (a) => pingoneListUsers(pingoneListUsersSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "pingone_get_user",
    description: "Fetch one PingOne user by ID, including custom attributes (e.g. mayAct).",
    schema: pingoneGetUserSchema,
    handler: (a) => pingoneGetUser(pingoneGetUserSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "pingone_list_apps",
    description: "List applications in the PingOne environment.",
    schema: pingoneListAppsSchema,
    handler: (a) => pingoneListApps(pingoneListAppsSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "pingone_get_app",
    description: "Fetch one PingOne application by ID, plus its grants.",
    schema: pingoneGetAppSchema,
    handler: (a) => pingoneGetApp(pingoneGetAppSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "pingone_list_resources",
    description: "List resource servers in the PingOne environment.",
    schema: pingoneListResourcesSchema,
    handler: () => pingoneListResources(),
    readOnly: true,
  },
  {
    name: "pingone_get_resource_scopes",
    description: "List scopes attached to one PingOne resource server.",
    schema: pingoneGetResourceScopesSchema,
    handler: (a) => pingoneGetResourceScopes(pingoneGetResourceScopesSchema.parse(a)),
    readOnly: true,
  }
);

// Gated write tool: only registers if DEV_MCP_PINGONE_WRITE=1
if (process.env.DEV_MCP_PINGONE_WRITE === "1") {
  tools.push({
    name: "pingone_update_user_attribute",
    description:
      "PATCH one attribute on a PingOne user (e.g. set mayAct). Requires DEV_MCP_PINGONE_WRITE=1.",
    schema: pingoneUpdateUserAttributeSchema,
    handler: (a) =>
      pingoneUpdateUserAttribute(pingoneUpdateUserAttributeSchema.parse(a)),
    readOnly: false,
  });
}

const server = new Server(
  { name: "banking-dev-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const exposed: Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toJsonSchema(t.schema) as Tool["inputSchema"],
    annotations: {
      readOnlyHint: t.readOnly,
      destructiveHint: !t.readOnly,
      idempotentHint: t.readOnly,
      openWorldHint: t.name.startsWith("pingone_") || t.name === "tokenchain_introspect",
    },
  }));
  return { tools: exposed };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const entry = tools.find((t) => t.name === req.params.name);
  if (!entry) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Unknown tool: ${req.params.name}. Available: ${tools.map((t) => t.name).join(", ")}`,
        },
      ],
    };
  }
  try {
    const result = await entry.handler(req.params.arguments ?? {});
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `${entry.name} failed: ${message}` }],
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stdio: keep process alive; SDK handles signaling.
}

main().catch((err) => {
  // stderr is safe — MCP stdio is on stdin/stdout only.
  // eslint-disable-next-line no-console
  console.error("banking-dev-mcp fatal:", err);
  process.exit(1);
});
