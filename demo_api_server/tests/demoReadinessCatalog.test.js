'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildDemoReadinessCatalog,
  loadDemoReadinessSources,
  validateDemoReadinessCatalog,
} = require('../services/demoReadinessCatalog');

const EXPECTED_IDS = [
  'UC24', 'UC1', 'UC8', 'UC7', 'UC14b', 'UC14', 'UC12', 'UC6', 'UC2',
  'UC2.5', 'UC2.7', 'UC22', 'UC5', 'UC10', 'UC13', 'UC11', 'UC20', 'UC18',
  'UC30', 'UC31', 'UC32', 'UC40', 'UC38', 'UC-TOOL1', 'UC46', 'UC47',
  'UC-MUSE1', 'UC-MUSE2',
  'UC43', 'UC44', 'UC45', 'UC2.6',
  'UC17', 'UC25', 'UC-PAM-SETUP', 'UC-PAM-SCRIPT', 'UC-LEARN11', 'UC-TOOL3',
  'ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4', 'ADMIN5', 'ADMIN6', 'ADMIN7',
  'ADMIN8', 'ADMIN9', 'ADMIN10', 'ADMIN11', 'ADMIN12',
];

describe('demo readiness catalog', () => {
  test('loads topology files from the resolved repository mount', () => {
    const mountedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-readiness-repo-'));
    const scopeTopology = { source: 'mounted-repository' };
    const gatewayScopeTopology = { source: 'mounted-gateway' };
    fs.mkdirSync(path.join(mountedRoot, 'ping-gateway', 'config'), { recursive: true });
    fs.writeFileSync(path.join(mountedRoot, 'scope-topology.json'), JSON.stringify(scopeTopology));
    fs.writeFileSync(path.join(mountedRoot, 'ping-gateway', 'config', 'scope-topology.json'), JSON.stringify(gatewayScopeTopology));

    try {
      const sources = loadDemoReadinessSources({ repositoryRoot: mountedRoot });
      expect(sources.scopeTopology).toEqual(scopeTopology);
      expect(sources.gatewayScopeTopology).toEqual(gatewayScopeTopology);
    } finally {
      fs.rmSync(mountedRoot, { recursive: true, force: true });
    }
  });

  test('an edition that dropped a use case validates without it and keeps the full-inventory counts', () => {
    const sources = loadDemoReadinessSources();
    const edition = {
      ...sources,
      dropUseCases: ['UC40'],
      useCases: sources.useCases.filter((u) => u.id !== 'UC40'),
    };
    const rows = validateDemoReadinessCatalog(edition);
    expect(rows).toHaveLength(49);
    expect(rows.some((row) => row.id === 'UC40')).toBe(false);
    // no edition: UC40 absent from the backend catalog is still an error
    expect(() => validateDemoReadinessCatalog({ ...edition, dropUseCases: [] })).toThrow(/UC40 is missing from the backend use-case catalog/);
  });

  test('builds the 50 executable Demo Steps entries in lane order', () => {
    const rows = buildDemoReadinessCatalog();

    expect(rows.map((row) => row.id)).toEqual(EXPECTED_IDS);
    expect(rows).toHaveLength(50);
    expect(rows.some((row) => row.id === 'ADMIN13')).toBe(false);
  });

  test('derives the current complete vertical/provider/target matrix without dropping groups', () => {
    const rows = buildDemoReadinessCatalog();
    const runtimeGroups = rows.reduce((total, row) => total + row.runtimeVerticalGroups.length, 0);
    const coreRows = rows.reduce((total, row) => total + row.runtimeVerticalGroups.reduce(
      (rowTotal) => rowTotal + (row.id === 'UC40' ? 2 : 4),
      0,
    ), 0);

    expect(runtimeGroups).toBe(188);
    expect(coreRows).toBe(750);
    expect(rows.find((row) => row.id === 'UC40').runtimeVerticalGroups).toHaveLength(1);
  });

  test('preserves the actual Demo Steps handler for special entries', () => {
    const rows = buildDemoReadinessCatalog();
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get('UC40')).toMatchObject({
      executionMode: 'live-id-jag',
      expectedBehavior: { kind: 'id-jag', provider: 'pingfederate' },
    });
    expect(byId.get('UC2.5').executionMode).toBe('a2a');
    expect(byId.get('UC14b').executionMode).toBe('intent-binding-quick');
    expect(byId.get('UC14b').alternateBehaviors).toEqual([{
      kind: 'page-load',
      path: '/intent-binding-learning#rar',
      pathname: '/intent-binding-learning',
      searchParams: {},
      hash: 'rar',
      variant: 'full-page-live-par',
    }]);
    expect(byId.get('UC38').executionMode).toBe('agent-chip');
    expect(byId.get('UC44').executionMode).toBe('agent-chip');
    expect(byId.get('UC2.7')).toMatchObject({
      executionMode: 'page',
      expectedBehavior: { kind: 'page-load', pathname: '/a2a-protocol-learning' },
    });
    expect(byId.get('UC18')).toMatchObject({
      executionMode: 'attack-sim',
      expectedBehavior: { kind: 'attack-outcome', sim: 'rate-limit-burst' },
    });
    expect(byId.get('UC-PAM-SETUP')).toMatchObject({
      executionMode: 'page',
      expectedBehavior: { kind: 'page-load', pathname: '/privilege-demo' },
    });
    expect(byId.get('UC-PAM-SETUP').expectedBehavior.searchParams).toEqual({ tab: 'setup' });
    expect(byId.get('UC-PAM-SCRIPT').expectedBehavior.searchParams).toEqual({ tab: 'script' });
    expect(byId.get('UC-LEARN11').expectedBehavior).toMatchObject({
      kind: 'page-load',
      pathname: '/llm-gateway',
      searchParams: { attack: 'prompt_injection' },
    });
    expect(byId.get('UC46')).toMatchObject({
      executionMode: 'page',
      auth: 'user',
      expectedBehavior: {
        kind: 'page-load',
        pathname: '/privilege-mcp-client',
        searchParams: { view: 'demo', tab: 'a2a' },
      },
    });
  });

  test('declares provider-specific PF exchange paths and keeps A2A ID-JAG separate from UC40', () => {
    const rows = new Map(buildDemoReadinessCatalog().map((row) => [row.id, row]));

    expect(rows.get('UC1').providerFlows).toEqual({
      pingone: 'pingone-standard',
      pingfederate: 'pingfederate-standard',
    });
    expect(rows.get('UC2').providerFlows.pingfederate).toBe('pingfederate-a2a');
    expect(rows.get('UC2.5').providerFlows.pingfederate).toBe('pingfederate-a2a');
    expect(rows.get('UC38').providerFlows.pingfederate).toBe('pingfederate-workload');
    expect(rows.get('UC44').providerFlows.pingfederate).toBe('pingfederate-workload');
    expect(rows.get('UC40').providerFlows).toEqual({
      pingone: null,
      pingfederate: 'pingfederate-native-id-jag',
    });
    expect(rows.get('UC40').providerNotApplicableReasons.pingone)
      .toMatch(/native PingFederate ID-JAG.*requires a PingFederate-authenticated session/i);
    expect(rows.get('UC1').providerFlows.pingfederate).not.toBe('pingfederate-native-id-jag');
  });

  test('attaches source-backed PF role/key contracts and explicitly blocks unresolved literal PF settings', () => {
    const rows = new Map(buildDemoReadinessCatalog().map((row) => [row.id, row]));
    const ordinary = rows.get('UC1').pfExchangeContract;
    const a2a = rows.get('UC2.5').pfExchangeContract;
    const native = rows.get('UC40').pfExchangeContract;
    const workload = rows.get('UC38').pfExchangeContract;

    expect(ordinary).toMatchObject({
      status: 'blocked',
      issuer: { configurationKey: 'pf_issuer' },
      endpoint: { configurationKey: 'pf_token_endpoint' },
      sourceGap: { code: 'pf_exact_exchange_contract_source_gap' },
    });
    expect(ordinary.credentialRoles.map((role) => role.roleId)).toEqual([
      'standard-agent-exchanger', 'standard-mcp-exchanger', 'ai-agent-actor', 'mcp-service-actor',
    ]);
    expect(a2a.credentialRoles.map((role) => role.roleId)).toEqual([
      'standard-agent-exchanger', 'ai-agent-actor', 'a2a-specialist',
    ]);
    expect(native.credentialRoles.map((role) => role.roleId)).toEqual(['uc40-native-id-jag']);
    expect(workload.credentialRoles.map((role) => role.roleId)).toEqual([
      'standard-agent-exchanger', 'standard-mcp-exchanger', 'ai-agent-actor', 'mcp-service-actor',
    ]);
  });

  test('keeps PF A2A feature probes outside the Demo Steps count', () => {
    const sources = loadDemoReadinessSources();

    expect(sources.featureChecks.countsTowardDemoSteps).toBe(false);
    expect(sources.featureChecks.checks.map((check) => check.id)).toEqual([
      'A2A-FM1', 'A2A-FM2', 'A2A-FM3',
      'PRIV-TOOL-ABUSE', 'PRIV-TOOL-POISONING', 'PRIV-SCHEMA-VIOLATION',
      'PRIV-INTER-AGENT-ABUSE', 'PRIV-MALICIOUS-CONTENT',
      'PINGONE-AGENT-IAM-CORE', 'PF-CIMD-VALID', 'PF-CIMD-REJECTED',
      'PF-THIRD-PARTY-AS-ALLOW', 'PF-THIRD-PARTY-AS-DENY', 'PF-ID-JAG-INVALID',
      'PF-ID-JAG-EXPIRED', 'PF-ID-JAG-WRONG-AUDIENCE', 'PF-RAR-VALID',
      'PF-RAR-INVALID', 'UC2-PASSENGER-INVALID-TARGET', 'UC-LEARN11-PROMPT-INJECTION',
    ]);
    expect(sources.featureChecks.checks.slice(0, 3).every((check) =>
      check.providers.includes('pingone')
      && check.providers.includes('pingfederate')
      && check.configurationDependencies.includes('pingfederate-a2a-runtime')),
    ).toBe(true);
    expect(sources.featureChecks.checks[2].expectedByProvider.pingfederate)
      .toBe('id_jag_exchange1_nested_act_exchange2_permit');
  });

  test('declares a structured family contract and an exact-or-blocked PF exchange contract for every feature probe', () => {
    const featureManifest = loadDemoReadinessSources().featureChecks;
    for (const check of featureManifest.checks) {
      const contract = featureManifest.contracts[check.id];
      expect(contract).toEqual(expect.objectContaining({
        featureFamily: expect.any(String),
        familyContract: expect.any(Object),
      }));
      if (check.providers.includes('pingfederate') && contract.exchangeService === 'token-exchange') {
        expect(contract.pfExchangeContract).toMatchObject({
          status: 'blocked',
          issuer: { configurationKey: 'pf_issuer' },
          endpoint: { configurationKey: 'pf_token_endpoint' },
          sourceGap: { code: 'pf_exact_exchange_contract_source_gap' },
        });
        expect(contract.pfExchangeContract.credentialRoles.length).toBeGreaterThan(0);
      }
      if (check.providers.includes('pingfederate') && contract.exchangeService !== 'token-exchange') {
        expect(contract.pfCredentialContract).toMatchObject({
          status: 'blocked',
          sourceGap: {
            code: expect.any(String),
            reason: expect.any(String),
            remediation: expect.any(String),
          },
        });
        expect(contract.pfCredentialContract.credentialRoles.length).toBeGreaterThan(0);
      }
      if (contract.selectedTool) {
        expect(contract.gateway?.applicable).not.toBe(false);
        expect(contract.authorize?.applicable).not.toBe(false);
      }
    }
  });

  test.each(['PRIV-MALICIOUS-CONTENT', 'UC-LEARN11-PROMPT-INJECTION'])(
    'rejects PF-applicable feature %s when its credential contract is missing',
    (id) => {
      const sources = structuredClone(loadDemoReadinessSources());
      delete sources.featureChecks.contracts[id].pfCredentialContract;

      expect(() => validateDemoReadinessCatalog(sources)).toThrow(
        new RegExp(`${id} PingFederate feature probe lacks an exact credential contract or actionable source gap`),
      );
    },
  );

  test('resolves UC38 and UC44 prompts and tools for each declared vertical', () => {
    const rows = new Map(buildDemoReadinessCatalog().map((row) => [row.id, row]));

    expect(rows.get('UC38').expectedBehaviorByVertical.banking).toMatchObject({
      triggerText: 'transfer $600 from checking to savings',
      primaryTool: 'create_transfer',
    });
    expect(rows.get('UC38').expectedBehaviorByVertical.healthcare).toMatchObject({
      triggerText: 'pay my $600 bill',
      primaryTool: 'pay_bill',
    });
    expect(rows.get('UC44').expectedBehaviorByVertical.retail).toMatchObject({
      triggerText: 'list my orders',
      primaryTool: 'list_orders',
    });
    expect(Object.keys(rows.get('UC44').expectedBehaviorByVertical)).toEqual(
      buildDemoReadinessCatalog().find((row) => row.id === 'UC44').verticals,
    );
  });

  test('maps every vertical behavior to Gateway scopes, resource audiences, and vertical Authorize groups', () => {
    const rows = new Map(buildDemoReadinessCatalog().map((row) => [row.id, row]));
    const uc1 = rows.get('UC1');
    const healthcare = uc1.authorizationContractByVertical.healthcare;

    expect(healthcare).toMatchObject({
      primaryTool: 'view_coverage',
      requiredScopes: ['read'],
      scopeResources: [{
        scope: 'read',
        canonicalScope: 'read',
        resource: 'Super Banking API',
        audience: 'enduser.ping.demo',
      }],
      gatewayTool: { surface: 'gateway', requiredScopes: ['read'] },
    });
    expect(Object.keys(uc1.authorizationContractByVertical)).toEqual(uc1.verticals);

    const uc25 = rows.get('UC2.5');
    const retail = uc25.authorizationContractByVertical.retail;
    const abercrombie = uc25.authorizationContractByVertical['abercrombie-fitch'];
    expect(retail.primaryTool).toBe('sensitive_order_history');
    expect(retail.authorizeToolGroup.groupName).toBe('Retail_PremiumTier');
    expect(abercrombie.authorizeToolGroup.groupName).toBe('AbercrombieFitch_PremiumTier');
    expect(uc25.runtimeVerticalGroups.flatMap((group) => group.verticals)).toEqual(uc25.verticals);
    expect(uc25.runtimeVerticalGroups).toHaveLength(11);
  });

  test('keeps UC2.6 vertical groups separate when their tool or Authorize-group contract differs', () => {
    const uc26 = buildDemoReadinessCatalog().find((row) => row.id === 'UC2.6');
    const groupByVertical = new Map(uc26.runtimeVerticalGroups.flatMap((group) =>
      group.verticals.map((vertical) => [vertical, group]),
    ));

    expect([...groupByVertical.keys()]).toEqual(uc26.verticals);
    for (const vertical of uc26.verticals) {
      const group = groupByVertical.get(vertical);
      expect(group.verticals).toEqual([vertical]);
      expect(group.expectedBehavior).toEqual(uc26.expectedBehaviorByVertical[vertical]);
      expect(group.authorizationContract).toEqual(uc26.authorizationContractByVertical[vertical]);
    }

    expect(uc26.expectedBehaviorByVertical.retail.primaryTool)
      .toBe(uc26.expectedBehaviorByVertical['abercrombie-fitch'].primaryTool);
    expect(groupByVertical.get('retail').authorizationContract.authorizeToolGroup.groupName)
      .toBe('Retail_PremiumTier');
    expect(groupByVertical.get('abercrombie-fitch').authorizationContract.authorizeToolGroup.groupName)
      .toBe('AbercrombieFitch_PremiumTier');
    expect(groupByVertical.get('retail')).not.toBe(groupByVertical.get('abercrombie-fitch'));
  });

  test('keeps required flags, A2A credentials, and PAR prerequisites with each vertical case', () => {
    const rows = new Map(buildDemoReadinessCatalog().map((row) => [row.id, row]));

    expect(rows.get('UC25').runtimePrerequisitesByVertical.banking.requiredFlags).toEqual([
      'ff_enterprise_managed_mcp_auth', 'ff_mcp_gateway_pinggateway',
    ]);
    expect(rows.get('UC2.5').runtimePrerequisitesByVertical.airlines.a2aCredentials).toBe(true);
    expect(rows.get('UC14b').runtimePrerequisitesByVertical.banking).toMatchObject({
      requiredFlags: ['ff_rar', 'ff_mcp_gateway_pinggateway'],
      parConfig: true,
    });
  });

  test('rejects Gateway scope drift for a tool used by a Demo Steps case', () => {
    const changed = structuredClone(loadDemoReadinessSources());
    changed.gatewayScopeTopology.tools.get_account_balance.requiredScopes = ['write'];

    expect(() => validateDemoReadinessCatalog(changed)).toThrow(/UC1 banking tool get_account_balance has different required scopes/);
  });

  test('rejects Gateway resource audience drift for a scope used by a Demo Steps tool', () => {
    const changed = structuredClone(loadDemoReadinessSources());
    changed.gatewayScopeTopology.resources['Super Banking API'].uri = 'gateway-drift.ping.demo';

    expect(() => validateDemoReadinessCatalog(changed)).toThrow(/UC1 banking scope read has different resource audience in Agent Gateway topology/);
  });

  test('maps Admin1–12 to their expected PingOne MCP actions', () => {
    const rows = buildDemoReadinessCatalog().filter((row) => row.kind === 'admin-mcp');

    expect(rows.map((row) => row.expectedBehavior.expectedTool)).toEqual([
      'listApplications', 'listUsers', 'listPopulations', 'getEnvironment',
      'listUsers', 'listApplications', null,
      'listResources', 'getEnvironmentServices', 'listDavinciFlows',
      'listDavinciApplications', 'listDavinciConnectors',
    ]);
    expect(rows[4].expectedBehavior.expectedArguments.filter).toBe('username sw "curt"');
    expect(rows[5].expectedBehavior.expectedArguments.filter).toBe('name sw "Demo"');
    expect(rows[6].expectedBehavior).toMatchObject({
      expectedAction: 'list_pingone_tools',
      expectedFilter: 'user',
    });
  });

  test('rejects an ID duplicated inside one UI lane', () => {
    const sources = loadDemoReadinessSources();
    const changed = structuredClone(sources);
    changed.inventory.primary.push('UC24');

    expect(() => validateDemoReadinessCatalog(changed)).toThrow(/duplicate.*primary|primary.*duplicate/i);
  });

  test('rejects a selected case missing from the backend catalog', () => {
    const sources = loadDemoReadinessSources();
    const changed = structuredClone(sources);
    changed.useCases = changed.useCases.filter((item) => item.id !== 'UC30');

    expect(() => validateDemoReadinessCatalog(changed)).toThrow(/UC30.*backend|backend.*UC30/i);
  });

  test('rejects a selected case marked as needing a build', () => {
    const sources = loadDemoReadinessSources();
    const changed = structuredClone(sources);
    changed.useCases = changed.useCases.map((item) =>
      item.id === 'UC1' ? { ...item, maturity: 'needs-build' } : item,
    );

    expect(() => validateDemoReadinessCatalog(changed)).toThrow(/UC1.*needs-build|needs-build.*UC1/i);
  });

  test('rejects a page step when its destination is absent from the auth route contract', () => {
    const sources = loadDemoReadinessSources();
    const changed = structuredClone(sources);
    delete changed.authRequirements.routes['/a2a-protocol-learning'];

    expect(() => validateDemoReadinessCatalog(changed)).toThrow(/UC2\.7.*route|route.*UC2\.7/i);
  });

  test('rejects an execution mode without a repairability classification', () => {
    const sources = loadDemoReadinessSources();
    const changed = structuredClone(sources);
    delete changed.repairability.executionModes['agent-chip'];

    expect(() => validateDemoReadinessCatalog(changed)).toThrow(/agent-chip.*repairability|repairability.*agent-chip/i);
  });

  test('rejects a provider flow without a configuration-only classification', () => {
    const sources = loadDemoReadinessSources();
    const changed = structuredClone(sources);
    delete changed.repairability.providerFlows['pingfederate-a2a'];

    expect(() => validateDemoReadinessCatalog(changed)).toThrow(/UC2.*pingfederate.*pingfederate-a2a/i);
  });

  test('rejects missing PingFederate A2A feature coverage', () => {
    const sources = loadDemoReadinessSources();
    const changed = structuredClone(sources);
    changed.featureChecks.checks = changed.featureChecks.checks.filter((check) => check.id !== 'A2A-FM3');

    expect(() => validateDemoReadinessCatalog(changed)).toThrow(/FM1, FM2, and FM3/);
  });

  test('requires a declared outcome for every provider when a feature has provider-specific results', () => {
    const sources = loadDemoReadinessSources();
    const changed = structuredClone(sources);
    delete changed.featureChecks.checks.find((check) => check.id === 'A2A-FM3').expectedByProvider.pingfederate;

    expect(() => validateDemoReadinessCatalog(changed)).toThrow(/A2A-FM3 must declare an outcome for every provider/);
  });
});
