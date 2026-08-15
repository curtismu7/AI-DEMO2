'use strict';

/**
 * Case-tolerant prefix retry ("so we do not fail on case, for demo").
 *
 * PingOne SCIM `sw` is case-sensitive and rejects `or` filters (400, probed
 * live 2026-08-10), so when the exact-case filter finds nothing the tool
 * retries ONCE with the first letter's case flipped and says so in the
 * summary. A non-empty exact match must never trigger the retry.
 */

const APPS = (names) => ({
  content: [{ type: 'text', text: JSON.stringify({ applications: names.map((n) => ({ name: n, type: 'WEB_APP', enabled: true })) }) }],
});

function load(callToolImpl) {
  jest.resetModules();
  const callTool = jest.fn(callToolImpl);
  jest.doMock('../services/mcpPingOneHttpAdapter', () => ({
    callTool,
    listTools: jest.fn().mockResolvedValue([]),
  }));
  const { execute } = require('../config/verticals/pingone-admin/tools');
  return { execute, callTool };
}

test('empty exact-case result retries with the first letter flipped and reports it', async () => {
  const { execute, callTool } = load(async (_name, args) => {
    if (args.filter === 'name sw "demo"') return APPS([]);
    if (args.filter === 'name sw "Demo"') return APPS(['Demo Store', 'Demo Bank']);
    throw new Error(`unexpected filter: ${args.filter}`);
  });

  const { result } = await execute(
    'call_pingone_tool',
    { name: 'listApplications', arguments: { filter: 'name sw "demo"' } },
    {},
  );

  expect(callTool).toHaveBeenCalledTimes(2);
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0].name).toBe('Demo Store');
  expect(result.responseSummary).toContain('2 applications found');
  expect(result.responseSummary).toContain('matched with name sw "Demo"');
});

test('a non-empty exact-case match is never second-guessed', async () => {
  const { execute, callTool } = load(async () => APPS(['demo-lowercase-app']));

  const { result } = await execute(
    'call_pingone_tool',
    { name: 'listApplications', arguments: { filter: 'name sw "demo"' } },
    {},
  );

  expect(callTool).toHaveBeenCalledTimes(1);
  expect(result.responseSummary).not.toContain('matched with');
});

test('both cases empty: reply stays an honest zero with the original filter', async () => {
  const { execute, callTool } = load(async () => APPS([]));

  const { result } = await execute(
    'call_pingone_tool',
    { name: 'listApplications', arguments: { filter: 'name sw "zzz"' } },
    {},
  );

  expect(callTool).toHaveBeenCalledTimes(2);
  expect(result.responseSummary).toContain('0 applications found');
  expect(result.responseSummary).not.toContain('matched with');
});
