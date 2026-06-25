/**
 * MCP Scope Validator Middleware
 * 
 * Validates that token has required scopes for MCP tool access.
 * Requires 'mcp:execute' scope (or wildcard 'mcp:*').
 * 
 * Usage:
 *   router.post('/tools/call', mcpScopeValidator(), (req, res) => { ... })
 */

import McpErrorFormatter from '../services/mcpErrorFormatter.js';

/**
 * Create middleware that validates scopes for MCP server
 * @param {string|string[]} requiredScopes - Scopes required (default: ['mcp:execute'])
 * @returns {function} Express middleware
 */
export default function mcpScopeValidator(requiredScopes = ['mcp:execute']) {
  // Normalize to array
  const scopesArray = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];

  return (req, res, next) => {
    const tokenScopes = req.user?.token?.scopes || [];

    // If no token, let other middleware handle it (auth)
    if (!req.user || !req.user.token) {
      return next();
    }

    // Check for wildcard scope 'mcp:*' (grants all MCP scopes)
    const hasWildcard = tokenScopes.includes('mcp:*') || tokenScopes.includes('*');

    // Check if token has all required scopes
    const hasAllScopes = scopesArray.every(requiredScope =>
      tokenScopes.includes(requiredScope)
    );

    if (!hasWildcard && !hasAllScopes) {
      const missingScopes = scopesArray.filter(scope => !tokenScopes.includes(scope));

      return McpErrorFormatter.formatMcpError(
        res,
        'SCOPE_VIOLATION',
        `Missing required scope(s): ${missingScopes.join(', ')}`,
        {
          required_scopes: scopesArray,
          actual_scopes: tokenScopes,
          missing_scopes: missingScopes,
        }
      );
    }

    // Scope validation passed, proceed
    next();
  };
}
