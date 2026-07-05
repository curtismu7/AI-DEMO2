import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RunCtx {
  bffToolUrl: string;
  bffInternalSecret: string;
  sessionId: string;
  // Optional: aborts an in-flight tool fetch when the client disconnects.
  abortSignal?: AbortSignal;
}

export type EmitFn = (event: Record<string, unknown>) => Promise<void>;

// Hosts the shared internal secret (BFF_INTERNAL_SECRET) may be sent to. The BFF
// supplies the tool-callback URL in the run payload (its cert is for
// api.ping.demo, not the agent's own BFF_BASE_URL host), so we must accept a
// request-supplied URL — but only to a trusted host. Extend via
// BFF_ALLOWED_TOOL_HOSTS (comma-separated) for non-default deployments.
const DEFAULT_ALLOWED_BFF_HOSTS = ['api.ping.demo', 'demo-api-server', 'localhost', '127.0.0.1'];

/**
 * Return a BFF tool URL that is safe to attach the internal secret to. A
 * request-supplied URL is honored only when its host is allowlisted; otherwise
 * we fall back to the server-configured URL, so a caller cannot point the agent
 * at an attacker host and exfiltrate the shared internal gateway secret.
 */
export function resolveBffToolUrl(requestUrl: string | undefined, configUrl: string): string {
  if (!requestUrl) return configUrl;
  const allowed = new Set(DEFAULT_ALLOWED_BFF_HOSTS);
  for (const h of (process.env.BFF_ALLOWED_TOOL_HOSTS ?? '').split(',')) {
    const t = h.trim();
    if (t) allowed.add(t);
  }
  let requestHost: string | undefined;
  let configHost: string | undefined;
  try {
    requestHost = new URL(requestUrl).hostname;
  } catch {
    requestHost = undefined;
  }
  try {
    configHost = new URL(configUrl).hostname;
  } catch {
    configHost = undefined;
  }
  if (configHost) allowed.add(configHost);
  if (requestHost && allowed.has(requestHost)) return requestUrl;
  console.warn(`[security] ignoring untrusted bffToolUrl host=${requestHost ?? '(unparseable)'}; using configured BFF URL`);
  return configUrl;
}

export class BffToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BffToolError';
  }
}

interface JsonSchemaProperty {
  type?: string;
  enum?: unknown[];
  items?: JsonSchemaProperty;
}

interface JsonSchemaObject {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

// Map a JSON-Schema property to its zod equivalent, preserving type fidelity so
// required banking fields (e.g. transfer_funds amount / to_account_id) are
// actually validated instead of collapsing to an optional string.
function jsonSchemaPropToZod(prop: JsonSchemaProperty): z.ZodTypeAny {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    const strVals = prop.enum.filter((v): v is string => typeof v === 'string');
    if (strVals.length === prop.enum.length) {
      return z.enum(strVals as [string, ...string[]]);
    }
  }
  switch (prop.type) {
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(prop.items ? jsonSchemaPropToZod(prop.items) : z.unknown());
    case 'object':
      return z.record(z.unknown());
    case 'string':
      return z.string();
    default:
      return z.unknown();
  }
}

export function buildBffTools(schemas: ToolSchema[], runCtx: RunCtx, emitFn?: EmitFn) {
  return schemas.map((schema) => _makeTool(schema, runCtx, emitFn));
}

async function emitTokenEvents(emitFn: EmitFn | undefined, tokenEvents: unknown[]): Promise<void> {
  if (!emitFn || tokenEvents.length === 0) return;
  // One batched STATE_DELTA (one add op per event); the client's applyJsonPatch
  // applies the whole delta array in one pass, so N frames would be wasted.
  try {
    await emitFn({
      type: 'STATE_DELTA',
      delta: tokenEvents.map((te) => ({ op: 'add', path: '/tokenEvents/-', value: te })),
    });
  } catch {
    // Non-fatal — a failed emit must not abort the tool call.
  }
}

function _makeTool(schema: ToolSchema, runCtx: RunCtx, emitFn?: EmitFn) {
  const schemaObj = schema.inputSchema as JsonSchemaObject;
  const props = schemaObj.properties ?? {};
  const required = new Set(schemaObj.required ?? []);
  const zodShape: Record<string, z.ZodTypeAny> = {};
  for (const [key, val] of Object.entries(props)) {
    const base = jsonSchemaPropToZod(val);
    zodShape[key] = required.has(key) ? base : base.optional();
  }

  const executeImpl = async (args: Record<string, unknown>) => {
    // Bound the BFF round-trip so a hung BFF can't pin the SSE stream open
    // forever. Abort on timeout (BFF_TOOL_TIMEOUT_MS, default 30s) or when the
    // client disconnects (runCtx.abortSignal).
    const timeoutMs = Number(process.env.BFF_TOOL_TIMEOUT_MS) || 30000;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = runCtx.abortSignal
      ? AbortSignal.any([timeoutController.signal, runCtx.abortSignal])
      : timeoutController.signal;
    let resp: Awaited<ReturnType<typeof fetch>>;
    try {
      resp = await fetch(runCtx.bffToolUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-gateway-secret': runCtx.bffInternalSecret,
          'x-session-id': runCtx.sessionId,
        },
        body: JSON.stringify({ tool: schema.name, args, sessionId: runCtx.sessionId }),
        signal,
      });
    } catch (err) {
      if (timeoutController.signal.aborted) {
        throw new BffToolError(`BFF tool call timed out after ${timeoutMs}ms`);
      }
      if (runCtx.abortSignal?.aborted) {
        throw new BffToolError('BFF tool call aborted (client disconnected)');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      const text = await resp.text();
      // Error bodies (e.g. 502 token-exchange-failed) carry tokenEvents showing
      // where the chain broke — surface them before throwing so the Token Chain
      // panel isn't blank on exactly the failure it exists to visualize.
      try {
        const errBody = JSON.parse(text) as Record<string, unknown>;
        await emitTokenEvents(emitFn, (errBody.tokenEvents as unknown[] | undefined) ?? []);
      } catch {
        // Body wasn't JSON — nothing to surface.
      }
      throw new BffToolError(`BFF returned HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = (await resp.json()) as Record<string, unknown>;
    await emitTokenEvents(emitFn, (data.tokenEvents as unknown[] | undefined) ?? []);
    return (data.result as Record<string, unknown> | undefined) ?? data;
  };

  return createTool({
    id: schema.name,
    description: schema.description,
    inputSchema: z.object(zodShape),
    execute: async (inputData: Record<string, unknown>) => executeImpl(inputData),
  });
}
