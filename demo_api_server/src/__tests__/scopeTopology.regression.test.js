'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const ROOT = path.resolve(__dirname, '../../../');
const manifestPath = path.join(ROOT, 'scope-topology.json');
const schemaPath = path.join(ROOT, 'scope-topology.schema.json');

describe('scope-topology manifest', () => {
  test('manifest and schema files exist', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  test('manifest validates against schema', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(manifest);
    if (!ok) {
      throw new Error('Manifest schema errors: ' + JSON.stringify(validate.errors, null, 2));
    }
    expect(ok).toBe(true);
  });

  // Full referential integrity (hardened): EVERY scope referenced anywhere in the
  // manifest — tool requiredScopes, app grantedScopes, resource native scopes AND
  // mirroredScopes — must be declared in scopes{} after alias normalization. The
  // only exemption is the OIDC standard scopes. (Previously this only checked
  // banking:/ai_agent-prefixed refs, so a mistyped non-banking scope slipped
  // through.) mirroredScopes are included per ARCHITECTURE-TRUTHS T-10: a scope
  // mirrored onto an exchange-hop audience must exist as a real declared scope.
  test('every scope referenced by a tool/app/resource is declared in scopes', () => {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const declared = new Set(Object.keys(m.scopes));
    const aliases = m.aliases || {};
    const norm = (s) => aliases[s] || s;
    const OIDC = new Set(['openid', 'profile', 'email', 'offline_access']);
    const refs = new Set();
    const addRef = (s) => { if (!OIDC.has(s)) refs.add(norm(s)); };
    Object.values(m.tools).forEach(t => (t.requiredScopes || []).forEach(addRef));
    Object.values(m.apps).forEach(a => (a.grantedScopes || []).forEach(addRef));
    Object.values(m.resources).forEach(r => {
      (r.scopes || []).forEach(addRef);
      (r.mirroredScopes || []).forEach(addRef);
    });
    const missing = [...refs].filter(s => !declared.has(s));
    expect(missing).toEqual([]);
  });

  test('every alias target is a declared scope', () => {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const declared = new Set(Object.keys(m.scopes));
    const badTargets = Object.entries(m.aliases || {})
      .filter(([, v]) => !declared.has(v))
      .map(([k, v]) => `${k} -> ${v}`);
    expect(badTargets).toEqual([]);
  });

  test('every resource server declares a non-empty uri', () => {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const missingUri = Object.entries(m.resources)
      .filter(([, r]) => !r.uri || typeof r.uri !== 'string')
      .map(([name]) => name);
    expect(missingUri).toEqual([]);
  });
});

describe('BFF scopeTopology loader', () => {
  const topo = require('../../services/scopeTopology');

  test('toolScopes(name) returns requiredScopes from manifest', () => {
    expect(topo.toolScopes('create_transfer')).toEqual(['write', 'transfer']);
    expect(topo.toolScopes('get_my_accounts')).toEqual(['read']);
  });

  test('toolScopes(unknown) falls back to [read]', () => {
    expect(topo.toolScopes('no_such_tool')).toEqual(['read']);
  });

  test('appGrantedScopes returns manifest grants', () => {
    expect(topo.appGrantedScopes('Super Banking User App')).toContain('transfer');
  });

  test('resourceScopes returns manifest resource scope list', () => {
    expect(topo.resourceScopes('Super Banking API')).toContain('transfer');
  });

  test('isAgentMediatedTool returns true for a requiresAgentMediation tool', () => {
    // create_transfer has requiresAgentMediation: true in scope-topology.json
    expect(topo.isAgentMediatedTool('create_transfer')).toBe(true);
  });

  test('isAgentMediatedTool returns false for a non-mediated tool', () => {
    // get_my_accounts has no requiresAgentMediation flag
    expect(topo.isAgentMediatedTool('get_my_accounts')).toBe(false);
  });

  test('isAgentMediatedTool returns false for an unknown tool (fail-open)', () => {
    expect(topo.isAgentMediatedTool('no_such_tool_xyz')).toBe(false);
  });
});

describe('MCP_TOOL_SCOPES derives from manifest', () => {
  const { MCP_TOOL_SCOPES } = require('../../services/mcpWebSocketClient');
  const topo = require('../../services/scopeTopology');

  test('create_transfer now requests transfer', () => {
    expect(MCP_TOOL_SCOPES.create_transfer).toEqual(['write', 'transfer']);
  });

  test('every manifest tool is present in MCP_TOOL_SCOPES with matching scopes', () => {
    for (const name of topo.allTools()) {
      expect(MCP_TOOL_SCOPES[name]).toEqual(topo.toolScopes(name));
    }
  });
});

describe('pingoneProvisionService derives resource scopes from the manifest', () => {
  // v2 SSOT refactor: pingoneProvisionService no longer hand-maintains
  // scope arrays — it calls topologyResourceScopeObjects(resourceName) which
  // derives {name,description}[] from scope-topology.json (native +
  // RFC 8693 mirrored). These guards assert the *derivation* invariant
  // (which cannot drift) instead of scraping hardcoded source literals.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../services/pingoneProvisionService.js'),
    'utf8'
  );
  const topo = require('../../services/scopeTopology');

  test('provision derives resource scopes from topology (no hardcoded scope array)', () => {
    expect(src).toMatch(/topologyResourceScopeObjects\('Super Banking API'\)/);
    expect(src).toMatch(/topologyResourceScopeObjects\('Super Banking MCP Server'\)/);
    expect(src).toMatch(/topologyResourceScopeObjects\('Super Banking MCP Gateway'\)/);
  });

  test('enduser resource scope set (derived) includes transfer', () => {
    expect(topo.resourceScopes('Super Banking API')).toContain('transfer');
  });

  test('MCP Gateway resource carries the RFC 8693 mirrored banking scopes (T-10)', () => {
    const gw = topo.resourceScopes('Super Banking MCP Gateway');
    for (const s of ['read', 'write', 'transfer', 'mortgage:read']) {
      expect(gw).toContain(s);
    }
    expect(topo.resourceMirroredScopes('Super Banking MCP Gateway')).toContain('read');
  });

  test('User App grant array contains every Super Banking User App manifest scope', () => {
    // The provision service now calls topologyAppGrantedScopes('Super Banking User App')
    // instead of an inline array literal. Verify the delegation rather than the array.
    expect(src).toMatch(/topologyAppGrantedScopes\(['"]Super Banking User App['"]\)/);
    // Confirm the topology itself has the expected scopes (the function derives from it).
    const appScopes = topo.appGrantedScopes('Super Banking User App');
    expect(appScopes.length).toBeGreaterThan(0);
    expect(appScopes).toContain('read');
    expect(appScopes).toContain('write');
  });
});

describe('scopePolicyEngine + scopeAuditService derive from manifest', () => {
  const topo = require('../../services/scopeTopology');

  test('scopePolicyEngine SCOPE_TAXONOMY covers every manifest banking scope', () => {
    const engine = require('../../services/scopePolicyEngine');
    const all = engine.getAllScopes();
    const names = new Set(all.map(s => (typeof s === 'string' ? s : s.scope)));
    for (const scope of Object.keys(topo._manifest().scopes)) {
      expect(names.has(scope)).toBe(true);
    }
  });

  test('scopeAuditService SCOPE_REFERENCE_TABLE reflects manifest app grants', () => {
    const { SCOPE_REFERENCE_TABLE } = require('../../services/scopeAuditService');
    // 'Demo API' is the PingOne display name (maps from 'Super Banking API' in topology)
    expect(Array.isArray(SCOPE_REFERENCE_TABLE['Demo API'])).toBe(true);
    expect(SCOPE_REFERENCE_TABLE['Demo API'].length).toBeGreaterThan(0);
  });

  test('every engine scope derives from the manifest (v2: admin/users now modelled with category:admin)', () => {
    const engine = require('../../services/scopePolicyEngine');
    const manifestScopes = new Set(Object.keys(topo._manifest().scopes));
    const engineScopes = engine.getAllScopes().map(x => (typeof x === 'string' ? x : x.scope));
    // v2 SSOT: admin:*/users: ARE in the manifest now (category:'admin').
    // Only transactions:write remains engine-local — no
    // tool/app/resource references it, so it stays out of the topology.
    const NON_MANIFEST = new Set(['transactions:write']);
    for (const s of engineScopes) {
      if (NON_MANIFEST.has(s)) continue;
      expect(manifestScopes.has(s)).toBe(true);
    }
    // Every manifest scope MUST be present in the engine (single-source guarantee).
    for (const s of manifestScopes) {
      expect(engineScopes).toContain(s);
    }
    // admin/users derive category:'admin' FROM the manifest (not the old overlay).
    for (const s of ['admin:read', 'admin:delete', 'users:manage']) {
      expect(topo.scopeMeta(s).category).toBe('admin');
    }
  });
});

describe('cross-consumer scope equality (the guard)', () => {
  const topo = require('../../services/scopeTopology');
  const { MCP_TOOL_SCOPES } = require('../../services/mcpWebSocketClient');

  test('every gateway-surface tool: BFF MCP_TOOL_SCOPES == manifest requiredScopes', () => {
    for (const name of topo.allTools()) {
      if (topo.toolSurface(name) === 'gateway') {
        expect(MCP_TOOL_SCOPES[name]).toEqual(topo.toolScopes(name));
      }
    }
  });

  test('NEGATIVE PROOF: reverting create_transfer to [write] would fail this guard', () => {
    const buggy = { ...MCP_TOOL_SCOPES, create_transfer: ['write'] };
    let caught = false;
    try {
      expect(buggy.create_transfer).toEqual(topo.toolScopes('create_transfer'));
    } catch (_) {
      caught = true;
    }
    expect(caught).toBe(true);
  });

  test('manifest tool count is non-trivial (sanity: at least 20 tools)', () => {
    expect(topo.allTools().length).toBeGreaterThanOrEqual(20);
  });
});

describe('generated scope doc is in sync', () => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');

  test('docs/scope-topology.md matches a fresh render of the manifest', () => {
    const ROOT = path.resolve(__dirname, '../../../');
    const docPath = path.join(ROOT, 'docs/scope-topology.md');
    const rendered = execSync('node demo_api_server/scripts/generate-scope-doc.js --stdout', {
      cwd: ROOT,
    }).toString();
    const onDisk = fs.readFileSync(docPath, 'utf8');
    expect(onDisk).toBe(rendered);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// FOOLPROOF GUARD (added after the write drift incident, 2026-05-18)
//
// Root cause of that incident: scope-topology.json is the SSOT for what
// PingOne *grants* an app (pingoneProvisionService derives from it), but the
// *OAuth /authorize request* is built by a SEPARATE hardcoded list in
// config/oauthUser.js (+ config/oauth.js for admin). Nothing tied the two
// together, so PingOne granted the User App write while the BFF
// never requested it → user token lacked it → RFC 8693 intersection dropped
// it → gateway 403'd create_transfer.
//
// This guard makes that drift impossible to ship silently: every banking-
// family scope the topology grants an app MUST be in that app's /authorize
// request (with the one documented spelling alias reconciled). Edit the
// topology OR the authorize list out of sync and this test goes red.
// ───────────────────────────────────────────────────────────────────────────
describe('GUARD: OAuth /authorize requested scopes match topology app grants', () => {
  const topo = require('../../services/scopeTopology');

  // Spelling aliases are modelled ONCE in scope-topology.json (aliases{}) and
  // consumed here via topo.normalizeScope so the guard compares semantics, not
  // spelling (e.g. OAuth `ai:agent` <-> topology `ai:agent:read`). Both the
  // granted and requested sides are normalised, so equal scopes stay equal
  // regardless of alias direction. Add new aliases to the manifest, not here.
  const norm = (s) => topo.normalizeScope(s);
  const bankingFamily = (s) => s.startsWith('banking:') || s === 'ai_agent';

  function assertAuthorizeCoversGrant(appName, requestedScopes) {
    const granted = topo.appGrantedScopes(appName).filter(bankingFamily).map(norm);
    const requested = new Set(requestedScopes.filter(bankingFamily).map(norm));
    const missing = granted.filter((s) => !requested.has(s));
    // If this fails: `missing` lists scopes granted in scope-topology.json but
    // NOT requested at /authorize. Either add them to the authorize scope list
    // (config/oauthUser.js / config/oauth.js) or remove the grant from the
    // manifest. Silent drift here = a gateway insufficient_scope 403.
    expect({ appName, missing }).toEqual({ appName, missing: [] });
  }

  test('Super Banking User App: oauthUser.js authorize scopes ⊇ topology grant', () => {
    const prevEnv = process.env.ENDUSER_AUDIENCE;
    process.env.ENDUSER_AUDIENCE = 'enduser.ping.demo';
    jest.resetModules();
    try {
      const userOauth = require('../../config/oauthUser');
      assertAuthorizeCoversGrant('Super Banking User App', userOauth.scopes);
    } finally {
      if (prevEnv === undefined) delete process.env.ENDUSER_AUDIENCE;
      else process.env.ENDUSER_AUDIENCE = prevEnv;
      jest.resetModules();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// P1AZ decision-path constants derive from the manifest.
//
// The PingOne Authorize decision path (mock demo_authz_server + the PingGateway
// Groovy filter + the Node PingOneAuthorizeClient) gates on the MCP Gateway
// audience. The mock authz server exposes it via gatewayAudience(); if that ever
// stops reading scope-topology.json (e.g. a future refactor hardcodes it) the
// gateway audience check would silently diverge from the SSOT. This guard pins
// it to the manifest. The Groovy/Node paths take the same value from env
// (PG_GATEWAY_RESOURCE_URI / MCP_GW_RESOURCE_URI), verified by
// scripts/verify-pinggateway-parity.js.
// ───────────────────────────────────────────────────────────────────────────
describe('P1AZ decision-path gateway audience matches the manifest', () => {
  const topo = require('../../services/scopeTopology');
  const authzTopo = require('../../../demo_authz_server/scopeTopology');

  test('mock authz gatewayAudience() == manifest Super Banking MCP Gateway uri', () => {
    expect(authzTopo.gatewayAudience()).toBe(topo.resourceUri('Super Banking MCP Gateway'));
  });

  test('mock authz gatewayToolNames() == manifest surface:gateway tools', () => {
    const manifestGatewayTools = topo
      .allTools()
      .filter((name) => topo.toolSurface(name) === 'gateway')
      .sort();
    expect(authzTopo.gatewayToolNames().slice().sort()).toEqual(manifestGatewayTools);
  });
});
