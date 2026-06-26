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
  outputSchema?: Record<string, unknown>;
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

// Output schemas (Zod → JSON Schema via toJsonSchema)
const LOG_RESULT_SCHEMA = toJsonSchema(z.object({
  lines: z.array(z.string()),
  count: z.number().int(),
  truncated: z.boolean().optional(),
}));

const STATE_SESSIONS_LIST_SCHEMA = toJsonSchema(z.object({
  count: z.number().int(),
  sessions: z.array(z.object({
    sid: z.string(),
    sub: z.string().optional(),
    scope: z.string().optional(),
    aud: z.string().optional(),
    expiry: z.string().optional(),
  })),
}));

const STATE_CONFIG_SCHEMA = toJsonSchema(z.object({
  key: z.string(),
  value: z.unknown(),
  source: z.enum(['runtimeData', 'env', 'not_found']),
}));

const STATE_KEY_LIST_SCHEMA = toJsonSchema(z.object({
  keys: z.array(z.string()),
  count: z.number().int(),
}));

const STATE_GENERIC_SCHEMA = toJsonSchema(z.object({
  summary: z.string(),
  details: z.record(z.unknown()).optional(),
}));

const TOKEN_DECODE_SCHEMA = toJsonSchema(z.object({
  header: z.record(z.unknown()),
  payload: z.record(z.unknown()),
  summary: z.object({
    aud: z.union([z.string(), z.array(z.string())]).optional(),
    scope: z.string().optional(),
    act: z.record(z.unknown()).optional(),
    may_act: z.record(z.unknown()).optional(),
    exp: z.number().optional(),
    expired: z.boolean(),
  }),
}));

const TOKEN_DIFF_SCHEMA = toJsonSchema(z.object({
  differences: z.array(z.object({
    field: z.string(),
    a: z.unknown(),
    b: z.unknown(),
  })),
  summary: z.string(),
}));

const TOKEN_EXPLAIN_SCHEMA = toJsonSchema(z.object({
  verdict: z.enum(['ok', 'warning', 'fail']),
  reasons: z.array(z.string()),
  payload: z.record(z.unknown()).optional(),
}));

const PINGONE_USERS_SCHEMA = toJsonSchema(z.object({
  count: z.number().int(),
  nextCursor: z.string().optional(),
  users: z.array(z.object({
    id: z.string(),
    username: z.string().optional(),
    email: z.string().optional(),
    enabled: z.boolean().optional(),
  })),
}));

const PINGONE_USER_SCHEMA = toJsonSchema(z.object({
  found: z.boolean(),
  user: z.record(z.unknown()).nullable(),
}));

const PINGONE_APPS_SCHEMA = toJsonSchema(z.object({
  count: z.number().int(),
  nextCursor: z.string().optional(),
  apps: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    type: z.string().optional(),
    enabled: z.boolean().optional(),
  })),
}));

const PINGONE_APP_SCHEMA = toJsonSchema(z.object({
  found: z.boolean(),
  app: z.record(z.unknown()).nullable(),
  grants: z.array(z.record(z.unknown())).optional(),
}));

const PINGONE_RESOURCES_SCHEMA = toJsonSchema(z.object({
  count: z.number().int(),
  resources: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
  })),
}));

const PINGONE_SCOPES_SCHEMA = toJsonSchema(z.object({
  resourceId: z.string(),
  count: z.number().int(),
  scopes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
  })),
}));

const tools: ToolEntry[] = [
  // logs_*
  {
    name: "logs_tail",
    description:
      "Tail the last N lines of one Super Banking service log file under /tmp. Read-only.",
    schema: logsTailSchema,
    outputSchema: LOG_RESULT_SCHEMA,
    handler: (a) => logsTail(logsTailSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "logs_grep",
    description:
      "Search across all (or selected) service logs for a literal or /regex/. Returns matches in chronological order, capped at 4KB.",
    schema: logsGrepSchema,
    outputSchema: LOG_RESULT_SCHEMA,
    handler: (a) => logsGrep(logsGrepSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "logs_correlate",
    description:
      "Find every log line containing a specific X-Request-ID across all services. The killer feature for OAuth/MCP debugging.",
    schema: logsCorrelateSchema,
    outputSchema: LOG_RESULT_SCHEMA,
    handler: (a) => logsCorrelate(logsCorrelateSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "logs_errors",
    description:
      "Return error lines from all services in a recent time window, deduped by coarse signature. Shows the noisiest errors first.",
    schema: logsErrorsSchema,
    outputSchema: LOG_RESULT_SCHEMA,
    handler: (a) => logsErrors(logsErrorsSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "logs_oauth_flow",
    description:
      "Curated view of OAuth + token-exchange events across all services (the same surface as the Token Chain UI but as text).",
    schema: logsOauthFlowSchema,
    outputSchema: LOG_RESULT_SCHEMA,
    handler: (a) => logsOauthFlow(logsOauthFlowSchema.parse(a)),
    readOnly: true,
  },

  // state_*
  {
    name: "state_sessions_list",
    description:
      "List sessions from banking_api_server/data/sessions.db. Tokens redacted. Returns sid, expiry, sub, scope, aud.",
    schema: sessionsListSchema,
    outputSchema: STATE_SESSIONS_LIST_SCHEMA,
    handler: (a) => sessionsList(sessionsListSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "state_sessions_get",
    description: "Fetch one session by sid. Tokens redacted.",
    schema: sessionsGetSchema,
    outputSchema: STATE_SESSIONS_LIST_SCHEMA,
    handler: (a) => sessionsGet(sessionsGetSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "state_config_get",
    description:
      "Read one configStore key from banking_api_server/data/runtimeData.json (falls back to env). Secret-shaped keys are redacted.",
    schema: configGetSchema,
    outputSchema: STATE_CONFIG_SCHEMA,
    handler: (a) => configGet(configGetSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "state_config_list_keys",
    description: "Enumerate every key present in runtimeData.json. Optional substring filter.",
    schema: configListKeysSchema,
    outputSchema: STATE_KEY_LIST_SCHEMA,
    handler: (a) => configListKeys(configListKeysSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "state_sample_data_summary",
    description:
      "Coarse counts of users/accounts/transactions in banking_api_server/data/sampleData.js. Does NOT require() the module.",
    schema: z.object({}),
    outputSchema: STATE_GENERIC_SCHEMA,
    handler: () => sampleDataSummary(),
    readOnly: true,
  },
  {
    name: "state_backup_list",
    description: "List files in banking_api_server/data/backups/ sorted by mtime descending.",
    schema: z.object({}),
    outputSchema: STATE_GENERIC_SCHEMA,
    handler: () => backupList(),
    readOnly: true,
  },
  {
    name: "state_bootstrap_summary",
    description:
      "Summary of banking_api_server/data/bootstrapData.json: existence, size, top-level keys.",
    schema: z.object({}),
    outputSchema: STATE_GENERIC_SCHEMA,
    handler: () => bootstrapSummary(),
    readOnly: true,
  },

  // tokenchain_*
  {
    name: "tokenchain_decode",
    description:
      "Decode a JWT WITHOUT signature validation. Returns header, payload, and a demo-aware summary (aud, scope, act, may_act, exp).",
    schema: tokenchainDecodeSchema,
    outputSchema: TOKEN_DECODE_SCHEMA,
    handler: (a) => tokenchainDecode(tokenchainDecodeSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "tokenchain_diff",
    description:
      "Side-by-side diff of two JWTs. Highlights aud mismatch, scope drift, act presence change, exp delta.",
    schema: tokenchainDiffSchema,
    outputSchema: TOKEN_DIFF_SCHEMA,
    handler: (a) => tokenchainDiff(tokenchainDiffSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "tokenchain_explain",
    description:
      "Composite verdict: decode token + check against demo rules (aud matches PINGONE_RESOURCE_MCP_SERVER_URI, has required scopes, has act, not expired). Returns ok/warning/fail with reasons.",
    schema: tokenchainExplainSchema,
    outputSchema: TOKEN_EXPLAIN_SCHEMA,
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
    outputSchema: PINGONE_USERS_SCHEMA,
    handler: (a) => pingoneListUsers(pingoneListUsersSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "pingone_get_user",
    description: "Fetch one PingOne user by ID, including custom attributes (e.g. mayAct).",
    schema: pingoneGetUserSchema,
    outputSchema: PINGONE_USER_SCHEMA,
    handler: (a) => pingoneGetUser(pingoneGetUserSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "pingone_list_apps",
    description: "List applications in the PingOne environment.",
    schema: pingoneListAppsSchema,
    outputSchema: PINGONE_APPS_SCHEMA,
    handler: (a) => pingoneListApps(pingoneListAppsSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "pingone_get_app",
    description: "Fetch one PingOne application by ID, plus its grants.",
    schema: pingoneGetAppSchema,
    outputSchema: PINGONE_APP_SCHEMA,
    handler: (a) => pingoneGetApp(pingoneGetAppSchema.parse(a)),
    readOnly: true,
  },
  {
    name: "pingone_list_resources",
    description: "List resource servers in the PingOne environment.",
    schema: pingoneListResourcesSchema,
    outputSchema: PINGONE_RESOURCES_SCHEMA,
    handler: () => pingoneListResources(),
    readOnly: true,
  },
  {
    name: "pingone_get_resource_scopes",
    description: "List scopes attached to one PingOne resource server.",
    schema: pingoneGetResourceScopesSchema,
    outputSchema: PINGONE_SCOPES_SCHEMA,
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
    ...(t.outputSchema ? { outputSchema: t.outputSchema as Tool["inputSchema"] } : {}),
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
