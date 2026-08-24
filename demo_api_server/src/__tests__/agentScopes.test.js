/**
 * resolveAgentScopes(vertical, allowWrite) — the write-toggle scope resolver.
 * Always grants the vertical's READ scopes (derived from scope-topology.json ×
 * the vertical's tools); adds the vertical's write-ish scopes only when the
 * write toggle is on. This is why greying is correct across verticals whose
 * read tools use different read scopes (healthcare records:read, banking read).
 */
const { resolveAgentScopes, isWriteIsh } = require('../../services/agentScopes');
const { verticalManifest } = require('../../services/verticalManifest');

// Chip-tool collection reads the static manifest via the loader, which the BFF
// initializes at boot. Load it here so resolveAgentScopes sees the chips.
beforeAll(() => { verticalManifest.init(); });

describe('isWriteIsh — derived from SoT riskLevel', () => {
  it('classifies high/critical scopes as write-gated', () => {
    expect(isWriteIsh('write')).toBe(true);
    expect(isWriteIsh('transfer')).toBe(true);
    expect(isWriteIsh('users:manage')).toBe(true);   // high — was MISSED by the old name heuristic
    expect(isWriteIsh('admin:delete')).toBe(true);    // critical
  });
  it('does NOT gate read/invoke scopes (low/medium)', () => {
    expect(isWriteIsh('read')).toBe(false);
    expect(isWriteIsh('records:read')).toBe(false);
    expect(isWriteIsh('mcp:invoke')).toBe(false);
    expect(isWriteIsh('admin:read')).toBe(false);     // medium — was WRONGLY gated by startsWith('admin')
  });
  it('falls back to the name heuristic for a scope with no SoT metadata', () => {
    expect(isWriteIsh('write')).toBe(true);
    expect(isWriteIsh('some:unknown:read')).toBe(false);
  });
});

describe('resolveAgentScopes', () => {
  it('healthcare read-only grants records:read but not write', () => {
    const scopes = resolveAgentScopes('healthcare', false);
    expect(scopes).toContain('records:read');
    expect(scopes).not.toContain('write');
  });

  it('healthcare with write adds write on top of records:read', () => {
    const scopes = resolveAgentScopes('healthcare', true);
    expect(scopes).toContain('records:read');
    expect(scopes).toContain('write');
  });

  it('banking with write grants read, write and transfer', () => {
    const scopes = resolveAgentScopes('banking', true);
    expect(scopes).toEqual(expect.arrayContaining(['read', 'write', 'transfer']));
  });

  it('banking read-only excludes write and transfer', () => {
    const scopes = resolveAgentScopes('banking', false);
    expect(scopes).toContain('read');
    expect(scopes).not.toContain('write');
    expect(scopes).not.toContain('transfer');
  });

  it('grants mortgage:read from the show_mortgage chip (read scope, both modes)', () => {
    // bk7 "My mortgage" declares tool: show_mortgage, which is not in the core
    // MCP registry (api_key disposition) — its mortgage:read scope must still be
    // requested via chip-tool collection, or the chip is permanently denied.
    expect(resolveAgentScopes('banking', false)).toContain('mortgage:read');
    expect(resolveAgentScopes('banking', true)).toContain('mortgage:read');
  });

  it('always includes mcp:invoke so the agent can reach the gateway', () => {
    expect(resolveAgentScopes('retail', false)).toContain('mcp:invoke');
    expect(resolveAgentScopes('banking', true)).toContain('mcp:invoke');
  });

  it('unknown vertical falls back to base read scope without throwing', () => {
    const scopes = resolveAgentScopes('nonexistent', false);
    expect(scopes).toContain('read');
    expect(scopes).toContain('mcp:invoke');
  });

  it('finding #55: loads the scope-topology manifest once per call, not once per tool', () => {
    const fs = require('fs');
    // Warm up so any first-load-only work has already happened before we count.
    resolveAgentScopes('banking', true);
    const statSpy = jest.spyOn(fs, 'statSync');
    resolveAgentScopes('banking', true); // banking has many tools/chips — would be many stats pre-fix
    expect(statSpy.mock.calls.length).toBeLessThanOrEqual(1);
    statSpy.mockRestore();
  });
});
