import { useCallback } from 'react';
import { callMcpTool as callMcpToolDirect } from '../services/demoAgentService';
import { callMcpToolViaPrivilege } from '../services/privilegeMcpService';

/**
 * Returns a callMcpTool-signature-compatible dispatcher that routes through
 * the standalone Privilege AI Gateway instead of the direct BFF pipeline
 * when transport is "privilege". Designed to shadow the module-level
 * `callMcpTool` import inside a component body via a same-named local
 * const, so existing call sites need no changes.
 * @param {"direct"|"privilege"} transport
 * @returns {(tool: string, params?: object, opts?: object) => Promise<{result: any, tokenEvents: Array}>}
 */
export function useMcpToolTransport(transport) {
  return useCallback(
    (tool, params = {}, opts = {}) =>
      transport === 'privilege'
        ? callMcpToolViaPrivilege(tool, params, opts)
        : callMcpToolDirect(tool, params, opts),
    [transport],
  );
}
