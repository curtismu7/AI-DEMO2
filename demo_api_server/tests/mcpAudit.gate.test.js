'use strict';

const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

describe('MCP observability audit access', () => {
  test('mounts the read-only audit router behind the signed-in session gate', () => {
    expect(serverSource).toMatch(
      /app\.use\('\/api\/mcp\/audit',\s*requireSession,\s*mcpAuditRouter\);/,
    );
    expect(serverSource).not.toMatch(
      /app\.use\('\/api\/mcp\/audit',\s*\(req,\s*res,\s*next\)\s*=>[\s\S]*?role !== 'admin'/,
    );
  });
});
