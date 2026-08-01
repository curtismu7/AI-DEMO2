/**
 * Single source of truth for the MCP protocol versions this server speaks.
 *
 * Kept in its own tiny module (rather than on MCPMessageHandler) so consumers —
 * notably HttpMCPTransport, whose tests auto-mock MCPMessageHandler — can import
 * the predicate without it being replaced by a mock.
 *
 * Dual-stack support (2025-11-25 → 2026-07-28 migration):
 * - Clients send MCP-Protocol-Version header to advertise their version
 * - Server detects and routes to appropriate handler (stateful 2025-11-25 or stateless 2026-07-28)
 * - Both versions work simultaneously during transition period
 */

/** The latest protocol version this server speaks (also the negotiation counter-offer). */
export const MCP_LATEST_PROTOCOL_VERSION = '2026-07-28';

/** Earlier supported protocol versions (for dual-stack compatibility during migration). */
export const MCP_SUPPORTED_VERSIONS = ['2026-07-28', '2025-11-25', '2024-11-05'];

/**
 * Does this server speak protocol version V? Matches negotiation acceptance:
 * the latest 2026-07-28 family plus earlier 2025-11-25 and 2024-* revisions.
 * The HTTP transport reuses this to validate the MCP-Protocol-Version header
 * instead of restating the set (which would drift).
 */
export function isSupportedProtocolVersion(version: string): boolean {
  const v = version.trim();
  // Support the full range of versions during dual-stack period
  return v.startsWith('2026-07-28') ||
         v.startsWith('2025-11-25') ||
         v.startsWith('2024-');
}

/**
 * Detect protocol version from request headers (2026-07-28 uses MCP-Protocol-Version header).
 * Returns the detected version or undefined if not present.
 */
export function detectProtocolVersion(headers: Record<string, string | string[] | undefined>): string | undefined {
  const protoHeader = (headers['mcp-protocol-version'] as string | undefined)?.trim();
  return protoHeader && isSupportedProtocolVersion(protoHeader) ? protoHeader : undefined;
}
