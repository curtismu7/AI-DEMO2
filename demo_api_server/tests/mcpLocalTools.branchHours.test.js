'use strict';
// UC24 public catalog — get_branch_hours must serve the ACTIVE vertical's
// catalog when the request carries one. Regression: the dashboard chip path
// (/api/mcp/tool with body.vertical) rendered Super Banking branches in every
// vertical because the local handler dropped the vertical on the floor.
const { callToolLocal } = require('../services/mcpLocalTools');

describe('get_branch_hours vertical threading (UC24)', () => {
  test('request body vertical selects that vertical catalog — government gets offices, not bank branches', async () => {
    const raw = await callToolLocal('get_branch_hours', {}, 'user-1', { body: { vertical: 'government' } });
    const out = JSON.parse(raw);
    expect(out.message).not.toMatch(/Super Banking/);
    expect(out.message).toMatch(/office/i);
  });

  test('explicit params.vertical wins over request body', async () => {
    const raw = await callToolLocal('get_branch_hours', { vertical: 'healthcare' }, 'user-1', { body: { vertical: 'government' } });
    const out = JSON.parse(raw);
    expect(out.message).not.toMatch(/Super Banking/);
    expect(out.message).toMatch(/clinic/i);
  });

  test('no vertical anywhere (MCP Inspector path) keeps the banking fallback', async () => {
    const raw = await callToolLocal('get_branch_hours', {}, 'user-1', { body: {} });
    const out = JSON.parse(raw);
    expect(out.message).toMatch(/Super Banking/);
  });
});
