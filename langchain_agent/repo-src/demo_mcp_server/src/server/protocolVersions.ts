/**
 * Single source of truth for the MCP protocol versions this server speaks.
 *
 * Kept in its own tiny module (rather than on MCPMessageHandler) so consumers —
 * notably HttpMCPTransport, whose tests auto-mock MCPMessageHandler — can import
 * the predicate without it being replaced by a mock.
 */

/** The latest protocol version this server speaks (also the negotiation counter-offer). */
export const MCP_LATEST_PROTOCOL_VERSION = '2025-11-25';

/**
 * Does this server speak protocol version V? Matches negotiation acceptance:
 * the latest 2025-11-25 family plus any 2024-* dated revision (negotiated down
 * to 2024-11-05). The HTTP transport reuses this to validate the
 * MCP-Protocol-Version header instead of restating the set (which would drift).
 */
export function isSupportedProtocolVersion(version: string): boolean {
  const v = version.trim();
  return v.startsWith('2025-11-25') || v.startsWith('2024-');
}
