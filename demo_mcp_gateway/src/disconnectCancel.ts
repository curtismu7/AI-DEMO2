'use strict';

/**
 * disconnectCancel.ts: when a client drops its connection mid-call, which in-flight
 * calls may the gateway abort?
 *
 * MCP 2026-07-28 treats a closed connection as cancellation of the request in flight on it.
 * Aborting is only safe for a call that cannot half-apply. A transfer, deposit or withdrawal
 * that the backend has already committed must not be cut off because the caller went away:
 * the caller would never learn the outcome, and the abort would not undo it. So the rule
 * is a decision about the tool, not the transport:
 *
 *   - the read-only protocol methods (tools/list, resources/*, prompts/*, completion) may
 *     be cancelled;
 *   - a tools/call may be cancelled only when the scope manifest lists the tool and every
 *     scope it requires is a read scope, and it has no step-up / consent challenge;
 *   - anything else, including a tool the manifest does not know, runs to completion.
 *
 * An explicit notifications/cancelled is a different thing (the caller asked, knowing what
 * it was cancelling) and is not affected by this module.
 */

import { toolRequiredScopes, toolChallengeType } from './auth/scopeTopology';

const READ_ONLY_METHODS = new Set([
  'tools/list',
  'resources/list',
  'resources/read',
  'resources/templates/list',
  'prompts/list',
  'prompts/get',
  'completion/complete',
]);

const isReadScope = (scope: string): boolean => scope === 'read' || scope.endsWith(':read');

/** True when a call to `method` (and `toolName`, for tools/call) is safe to abort on disconnect. */
export function cancelOnDisconnect(method: string | undefined, toolName?: string): boolean {
  if (!method) return false;
  if (READ_ONLY_METHODS.has(method)) return true;
  if (method !== 'tools/call' || !toolName) return false;
  const scopes = toolRequiredScopes(toolName);
  if (!scopes || scopes.length === 0) return false;
  if (toolChallengeType(toolName)) return false;
  return scopes.every(isReadScope);
}

/** One call a connection has in flight. */
export interface InFlightCall {
  controller: AbortController;
  cancelOnDisconnect: boolean;
}

/** Aborts every cancellable call of a closed connection. Returns what it did, for the log. */
export function abortOnDisconnect(calls: Iterable<InFlightCall>): { cancelled: number; kept: number } {
  let cancelled = 0;
  let kept = 0;
  for (const call of calls) {
    if (call.cancelOnDisconnect) {
      call.controller.abort();
      cancelled += 1;
    } else {
      kept += 1;
    }
  }
  return { cancelled, kept };
}
