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

/** The latest protocol version this server speaks. */
export const MCP_LATEST_PROTOCOL_VERSION = '2026-07-28';

/** Earlier supported protocol versions (for dual-stack compatibility during migration). */
export const MCP_SUPPORTED_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/**
 * The version actually ADVERTISED to clients — the counter-offer when a client
 * asks for something this server does not speak.
 *
 * Overridable because "latest the server speaks" and "latest the deployment can
 * deliver" are different questions once something sits in front of it. The
 * public MCP door is proxied by PingGateway, whose own MCP filter
 * (org.forgerock.openig.mcp.McpValidationFilter in openig-mcp-2026.6.0) speaks
 * ONLY 2025-06-18 and 2025-11-25 — verified by extracting McpVersion.class from
 * the shipped jar, which carries those two constants and their two schemas and
 * nothing newer.
 *
 * Counter-offering 2026-07-28 through that gateway produces the worst failure
 * shape there is: `initialize` succeeds (the filter does not police the
 * handshake), then every later call is rejected 400 by the PROXY, so the client
 * shows a connected server with an empty tool catalog and the error names a
 * header the client set correctly. This module's own comment below already
 * records that exact symptom from a previous round — same shape, different
 * layer.
 *
 * Set MCP_ADVERTISED_PROTOCOL_VERSION=2025-11-25 for any deployment behind
 * PingGateway. Invalid values throw AT STARTUP rather than at request time:
 * advertising a version the server cannot honour is the bug this exists to
 * prevent, so it must not be possible to typo it into production silently.
 */
export const MCP_ADVERTISED_PROTOCOL_VERSION: string = (() => {
  const raw = (process.env.MCP_ADVERTISED_PROTOCOL_VERSION || '').trim();
  if (!raw) return MCP_LATEST_PROTOCOL_VERSION;
  if (!MCP_SUPPORTED_VERSIONS.includes(raw)) {
    throw new Error(
      `MCP_ADVERTISED_PROTOCOL_VERSION="${raw}" is not a version this server speaks. ` +
      `Valid values: ${MCP_SUPPORTED_VERSIONS.join(', ')}.`,
    );
  }
  return raw;
})();


/**
 * Does this server speak protocol version V? Matches negotiation acceptance:
 * the latest 2026-07-28 family plus the earlier 2025-* and 2024-* revisions.
 * The HTTP transport reuses this to validate the MCP-Protocol-Version header
 * instead of restating the set (which would drift).
 *
 * 2025-06-18 and 2025-03-26 are what most third-party clients still send —
 * omitting them made `initialize` succeed and every later call 400, which reads
 * as a working handshake with an empty tool catalog.
 */
export function isSupportedProtocolVersion(version: string): boolean {
  const v = version.trim();
  // Support the full range of versions during dual-stack period
  return v.startsWith('2026-07-28') ||
         v.startsWith('2025-') ||
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
