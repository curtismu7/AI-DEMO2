// Truthfulness guard for the inspector vertical catalog: every tool must be a
// real topology tool, every scenario must use its own vertical's tools, every
// argument shape must match the MCP server's real schema (mcp-tool-schemas.json,
// generated from oauth-mcp + demo_mcp_resource_server), and every MCP tool must
// have an owner or be global, so a new tool cannot leak into every vertical.
// The in-process seed-id check lives server side:
// demo_api_server/tests/inspectorVerticalsCatalog.test.js.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { INSPECTOR_VERTICALS, GLOBAL_TOOLS, UNCOVERED_VERTICAL_TOOLS, argsFor, belongsElsewhere } from './inspectorVerticals';
import { TOOL_ATTACKS } from './toolAttackCatalog';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const repoJson = (name) => JSON.parse(readFileSync(join(REPO_ROOT, name), 'utf8'));
const topology = repoJson('scope-topology.json');
const schemas = repoJson('mcp-tool-schemas.json').tools;
const allTools = Object.keys(topology.tools);
const { highValueConsentThresholdUsd, amountLimitsByTier } = topology.policy.authorization;

const entries = Object.entries(INSPECTOR_VERTICALS);
const callsOf = (s) => s.steps ?? [s];
// Every "tool" / "mcpTool" a vertical manifest names (chips, feature page).
const manifestTools = (id) => [...readFileSync(join(REPO_ROOT, `demo_api_server/config/verticals/${id}/manifest.json`), 'utf8')
  .matchAll(/"(?:mcpTool|tool)":\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
// Names two plugins really both define; the BFF picks by the caller's active vertical.
const SHARED = ['cancel_appointment', 'cancel_order', 'close_support_ticket', 'view_billing', 'view_documents'];

describe('inspector vertical catalog', () => {
  it('every catalog tool exists in scope-topology.json (scopeTopology.allTools())', () => {
    for (const [id, v] of entries) {
      for (const t of v.tools) expect(allTools, `${id}: ${t}`).toContain(t);
    }
  });

  it("every scenario's tools belong to that vertical's tool list", () => {
    for (const [id, v] of entries) {
      for (const s of v.scenarios) {
        for (const c of callsOf(s)) expect(v.tools, `${id}/${s.id}: ${c.tool}`).toContain(c.tool);
      }
    }
  });

  // Banking's 'transfer' is the frozen baseline (a legacy alias in the topology).
  it("non-banking Authorize presets use the vertical's approval tool, amount and the transfer type", () => {
    for (const [id, v] of entries.filter(([k]) => k !== 'banking')) {
      const approval = v.scenarios.find((s) => s.expect === 'APPROVAL');
      expect(v.authorize.toolName, id).toBe(approval.tool);
      expect(v.authorize.amount, id).toBe(approval.args.amount);
      expect(v.authorize.txTypes, id).toEqual(['transfer']);
    }
  });

  it('banking scenarios are exactly the gateway page baseline', () => {
    expect(INSPECTOR_VERTICALS.banking.scenarios).toEqual([
      { id: 'read', label: 'Read accounts (expect PERMIT)', expect: 'PERMIT', tool: 'get_my_accounts', args: {} },
      { id: 'sensitive', label: 'Sensitive read (expect DENY)', expect: 'DENY', tool: 'get_sensitive_account_details', args: { account_id: '' } },
      // R11: from_account_id, the key create_withdrawal's schema takes (it rejected account_id).
      { id: 'withdrawal', label: 'Withdrawal (expect approval)', expect: 'APPROVAL', tool: 'create_withdrawal', args: { from_account_id: '', amount: 500 } },
      {
        id: 'chain',
        label: 'Run chain: accounts → balance → sensitive',
        steps: [
          { tool: 'get_my_accounts', args: {} },
          { tool: 'get_account_balance', args: { account_id: '' } },
          { tool: 'get_sensitive_account_details', args: { account_id: '' } },
        ],
      },
    ]);
    expect(INSPECTOR_VERTICALS.banking.capture).toEqual({ tool: 'get_my_accounts', family: 'account', arg: 'account_id', hint: 'Run "Read accounts" first to fill account_id.' });
    expect(INSPECTOR_VERTICALS.banking.authorize).toEqual({ toolName: 'transfer', txTypes: ['transfer', 'withdrawal', 'deposit'], amount: 5000 });
  });

  it('banking keeps both attack-library entries', () => {
    for (const a of TOOL_ATTACKS) expect(INSPECTOR_VERTICALS.banking.tools).toContain(a.tool);
  });

  it('arguments match the MCP server input schema', () => {
    for (const [id, v] of entries) {
      for (const s of v.scenarios) {
        for (const c of callsOf(s)) {
          const schema = schemas[c.tool]?.inputSchema;
          expect(schema, `${id}/${s.id}: ${c.tool} schema`).toBeTruthy();
          const props = Object.keys(schema.properties ?? {});
          for (const k of Object.keys(c.args)) expect(props, `${id}/${s.id}: ${c.tool}.${k}`).toContain(k);
          for (const k of schema.required ?? []) expect(Object.keys(c.args), `${id}/${s.id}: ${c.tool} requires ${k}`).toContain(k);
        }
      }
    }
  });

  // Expectations follow the cloud policy generator (snapshots/gen-authorize-snapshot.js)
  // and demo_authz_server: a2aDelegated tools DENY without a two-hop act chain, a
  // consent/step_up tool with an amount in the hold band pauses, plain reads permit.
  it('non-banking expectations agree with scope-topology.json', () => {
    for (const [id, v] of entries.filter(([k]) => k !== 'banking')) {
      for (const s of v.scenarios.filter((x) => x.expect)) {
        const t = topology.tools[s.tool];
        const where = `${id}/${s.id}: ${s.tool}`;
        if (s.expect === 'DENY') expect(t.a2aDelegated, where).toBe(true);
        if (s.expect === 'PERMIT') expect(!t.challengeType && !t.a2aDelegated, where).toBe(true);
        if (s.expect === 'APPROVAL') {
          expect(t.challengeType, where).toBeTruthy();
          expect(s.args.amount, where).toBeGreaterThanOrEqual(highValueConsentThresholdUsd);
          expect(s.args.amount, where).toBeLessThanOrEqual(amountLimitsByTier.standard);
        }
      }
    }
  });

  it('every vertical has a read, a sensitive read, an approval and a 3-step chain', () => {
    for (const [id, v] of entries) {
      expect(v.scenarios.map((s) => s.expect ?? 'chain'), id).toEqual(['PERMIT', 'DENY', 'APPROVAL', 'chain']);
      const chain = v.scenarios[3];
      expect(chain.steps, id).toHaveLength(3);
      if (v.capture) {
        expect(chain.steps[0].tool, id).toBe(v.capture.tool);
        expect(chain.steps.slice(1).some((c) => c.args[v.capture.arg] === ''), id).toBe(true);
      }
      // An empty arg is only ever the captured id (from_/to_ prefixes as the Tester strips them).
      for (const s of v.scenarios) {
        for (const c of callsOf(s)) {
          for (const [k, val] of Object.entries(c.args)) if (val === '') expect(k.replace(/^(from|to)_/, ''), `${id}/${s.id}`).toBe(v.capture?.arg);
        }
      }
    }
  });

  it('argsFor returns complete sample args only', () => {
    expect(argsFor(INSPECTOR_VERTICALS.healthcare, 'pay_bill')).toEqual({ billId: '404', amount: 500 });
    expect(argsFor(INSPECTOR_VERTICALS.banking, 'create_withdrawal')).toEqual({});
    expect(argsFor(INSPECTOR_VERTICALS.airlines, 'get_flight_status')).toEqual({ flight_number: 'UA328' });
    expect(argsFor(INSPECTOR_VERTICALS.healthcare, 'not_a_tool')).toEqual({});
  });

  it('belongsElsewhere hides other verticals\' tools but keeps shared and unowned ones', () => {
    expect(belongsElsewhere('banking', 'view_records')).toBe(true);
    expect(belongsElsewhere('healthcare', 'view_records')).toBe(false);
    expect(belongsElsewhere('banking', 'sequential_think')).toBe(false);
    expect(belongsElsewhere('university', 'view_billing')).toBe(false);
    expect(belongsElsewhere('healthcare', 'view_billing')).toBe(false);
    expect(belongsElsewhere('banking', 'constructor')).toBe(false);
    expect(belongsElsewhere('healthcare', 'show_mortgage')).toBe(true);
    expect(belongsElsewhere('banking', 'show_health_record')).toBe(true);
    expect(belongsElsewhere('retail', 'list_anf_orders')).toBe(true);
    expect(belongsElsewhere('retail', 'sequential_think')).toBe(false);
  });

  // A new MCP tool with no owner would otherwise show in every vertical.
  it('every MCP tool is owned by a vertical or listed as global, never both', () => {
    const owners = {};
    for (const [id, v] of entries) for (const t of [...v.tools, ...v.extraTools]) (owners[t] ||= []).push(id);
    for (const [id, ts] of Object.entries(UNCOVERED_VERTICAL_TOOLS)) for (const t of ts) (owners[t] ||= []).push(id);
    for (const t of Object.keys(schemas)) {
      const owned = Object.hasOwn(owners, t);
      expect(owned !== GLOBAL_TOOLS.includes(t) ? t : `${t}: ${owned ? 'owned and global' : 'no owner, not global'}`).toBe(t);
    }
    expect(Object.keys(owners).filter((t) => owners[t].length > 1).sort()).toEqual(SHARED);
  });

  it("extra tools are real MCP tools; a non-banking vertical's come from its own manifest", () => {
    for (const [id, v] of entries) {
      for (const t of v.extraTools) {
        expect(schemas[t], `${id}: ${t}`).toBeTruthy();
        if (id !== 'banking') expect(manifestTools(id), `${id}: ${t}`).toContain(t);
      }
    }
  });

  it('global tools are real tools', () => {
    for (const t of GLOBAL_TOOLS) expect(Boolean(topology.tools[t] || schemas[t]), t).toBe(true);
  });
});
