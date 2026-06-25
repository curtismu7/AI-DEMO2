import type { HandlerFn } from './types';
import { createSuccessResult, createErrorResult } from './results';
import { GENERATED_VERTICAL_TOOLS, type VerticalToolDef } from './verticalTools.generated';

/**
 * Generic vertical-tool handlers. Every vertical action tool shares one handler
 * body — it relays the call to the BFF (/api/path/vertical-tool), which runs the
 * active vertical's tool logic (single source of truth in
 * config/verticals/<id>/tools.js) and returns { ok, result, render }. The render
 * hint is included in the JSON so the BFF can rebuild the UI verticalResult.
 *
 * See docs/specs/SPEC-vertical-tools-through-mcp.md.
 */
function makeVerticalHandler(toolName: string): HandlerFn {
  return async (deps, token, params) => {
    deps.logger.debug(`[VerticalTool] Calling BFF vertical-tool: ${toolName}`);
    const out = await deps.apiClient.callVerticalTool(token, toolName, params || {});
    if (!out || out.ok === false) {
      const msg = (out && (out.result as { error?: string })?.error) || `${toolName} failed`;
      return createErrorResult(msg);
    }
    return createSuccessResult(JSON.stringify({ success: true, render: out.render, data: out.result }, null, 2));
  };
}

/**
 * Every vertical action tool across all verticals — GENERATED from each vertical
 * plugin's config/verticals/<id>/tools.js (the runtime SoT) by
 * scripts/gen-vertical-tools.js. `scope` is coarse read/write — PingAuthorize
 * makes the fine-grained decision (spec §7 decision 2/3). Do not hand-edit the
 * list; add a tool to its vertical's tools.js and run `npm run verticals:gen`.
 *
 * Parameterized tools carry their inputSchema (with additionalProperties:false);
 * the registry otherwise defaults to an empty schema that silently REJECTS every
 * argument — the generator copies each tool's inputSchema so this can't drift.
 */
export const VERTICAL_TOOLS: VerticalToolDef[] = GENERATED_VERTICAL_TOOLS;

/** handler-name → HandlerFn, for every vertical tool (e.g. executeViewBenefits). */
function handlerNameFor(toolName: string): string {
  // view_benefits -> executeViewBenefits
  const camel = toolName.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
  return `execute${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

export const verticalHandlerMap: Record<string, HandlerFn> = VERTICAL_TOOLS.reduce(
  (acc, t) => {
    acc[handlerNameFor(t.name)] = makeVerticalHandler(t.name);
    return acc;
  },
  {} as Record<string, HandlerFn>,
);

/** Tool name → handler name, used by the registry to set tool.handler. */
export const verticalHandlerName = handlerNameFor;

// Back-compat single export (Slice 1).
export const executeViewBenefits: HandlerFn = verticalHandlerMap['executeViewBenefits'];
