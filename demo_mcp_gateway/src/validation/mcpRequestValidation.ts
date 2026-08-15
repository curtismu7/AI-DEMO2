'use strict';

/**
 * mcpRequestValidation — gateway-side MCP request validation (spec §2).
 * Shared by the WS handler (index.ts) and HTTP middleware
 * (authorizeMcpRequest.ts). Validators are compiled once at module load from
 * the repo-root mcp-tool-schemas.json artifact (drift-tested against the
 * backend tool definitions). Unknown tools fail closed.
 */

import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import artifact from '../../../mcp-tool-schemas.json';

export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'initialize',
  'notifications/initialized',
  'tools/list',
  'tools/call',
  'notifications/cancelled',
]);

export interface ValidationFailure {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new Map<string, ValidateFunction>();
for (const [name, entry] of Object.entries(
  (artifact as { tools: Record<string, { inputSchema: Record<string, unknown> }> }).tools,
)) {
  validators.set(name, ajv.compile(entry.inputSchema));
}

export function validateMethodAndShape(method: unknown, params: unknown): ValidationFailure | null {
  if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
    return { code: -32601, message: `Method not found: ${String(method)}` };
  }
  if (method !== 'tools/call') return null;
  const p = params as { name?: unknown; arguments?: unknown } | undefined;
  if (!p || typeof p.name !== 'string' || p.name.length === 0) {
    return { code: -32602, message: 'Invalid params: tools/call requires a non-empty string params.name' };
  }
  if (p.arguments !== undefined
      && (typeof p.arguments !== 'object' || p.arguments === null || Array.isArray(p.arguments))) {
    return { code: -32602, message: 'Invalid params: params.arguments must be an object' };
  }
  return null;
}

export function validateToolArgs(toolName: string, args: Record<string, unknown>): ValidationFailure | null {
  const validate = validators.get(toolName);
  if (!validate) {
    // Fail closed — the drift test guarantees the artifact covers every real tool.
    return { code: -32602, message: `Unknown tool: ${toolName}`, data: { unknownTool: true } };
  }
  if (validate(args)) return null;
  const validationErrors = (validate.errors || []).map((e) => ({
    path: e.instancePath || '/',
    message: e.message || 'invalid',
  }));
  return {
    code: -32602,
    message: `Invalid arguments for tool ${toolName}`,
    data: { validationErrors },
  };
}
