/**
 * MCP Token Validator Middleware
 * 
 * Validates token type and basic claims before MCP tool calls.
 * Token must be agent type and not expired.
 * 
 * Usage:
 *   router.post('/tools/call', mcpTokenValidator(), (req, res) => { ... })
 */

import McpErrorFormatter from '../services/mcpErrorFormatter.js';
import { validateTokenAtGateway } from './validateTokenAtGateway.js';

/**
 * Create middleware that validates token for MCP server
 * @returns {function} Express middleware
 */
export default function mcpTokenValidator() {
  return (req, res, next) => {
    const token = req.user?.token;

    // Check if token exists
    if (!token) {
      return McpErrorFormatter.formatMcpError(
        res,
        'NO_TOKEN',
        'Token required for MCP tool access',
        { endpoint: req.path }
      );
    }

    // Check token type is 'agent' (not 'user' or 'system')
    const tokenType = token.token_type || token.typ;
    if (tokenType && tokenType !== 'agent') {
      return McpErrorFormatter.formatMcpError(
        res,
        'TOKEN_TYPE_MISMATCH',
        'This endpoint requires an agent token, not a user token',
        {
          actual_type: tokenType,
          required_type: 'agent',
          token_subject: token.sub,
        }
      );
    }

    // Check token expiration
    if (token.exp) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (token.exp < nowSeconds) {
        return McpErrorFormatter.formatMcpError(
          res,
          'TOKEN_EXPIRED',
          `Token expired at ${new Date(token.exp * 1000).toISOString()}`,
          {
            expires_at: new Date(token.exp * 1000).toISOString(),
            expired_seconds_ago: nowSeconds - token.exp,
          }
        );
      }
    }

    // RFC 8693 §3.2 structural validation (Phase 188)
    const mcpAudience = process.env.MCP_AUDIENCE || process.env.PINGONE_RESOURCE_MCP_URI;
    const rfc8693 = validateTokenAtGateway(token, { expectedAudience: mcpAudience });
    if (!rfc8693.valid) {
      console.warn('[mcpTokenValidator] RFC 8693 validation failed:', rfc8693.errors);
      return McpErrorFormatter.formatMcpError(
        res,
        'RFC8693_VALIDATION_FAILED',
        `Token does not meet RFC 8693 requirements: ${rfc8693.errors[0]}`,
        { errors: rfc8693.errors, warnings: rfc8693.warnings }
      );
    }
    if (rfc8693.warnings.length > 0) {
      console.log('[mcpTokenValidator] RFC 8693 warnings:', rfc8693.warnings);
    }

    // Token validation passed, proceed
    next();
  };
}
