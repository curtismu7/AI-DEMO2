'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const REGISTERED_TOOLS = {
  olb: path.join(ROOT, 'oauth-mcp/openapi/mcp-olb.openapi.json'),
  invest: path.join(ROOT, 'demo_mcp_resource_server/openapi/mcp-resource-server.openapi.json'),
};
const FILTERS = [
  {
    name: 'OLB',
    file: path.join(ROOT, 'ping-gateway/scripts/groovy/olb-token-exchange.groovy'),
    issuerVariable: 'tokenIss',
    subjectTypVariable: 'tokenTyp',
    subjectTypeVariable: 'subjectTokenType',
    successTool: 'get_my_accounts',
    registry: REGISTERED_TOOLS.olb,
    forwardingCall: /httpPostJson\(mcpUrl,\s*rawBody,\s*toolHdrs\)/,
  },
  {
    name: 'Invest',
    file: path.join(ROOT, 'ping-gateway/scripts/groovy/invest-dispatch.groovy'),
    issuerVariable: 'subjectIss',
    subjectTypVariable: 'subjectTyp',
    subjectTypeVariable: 'subjectType',
    successTool: 'get_investment_accounts',
    registry: REGISTERED_TOOLS.invest,
    forwardingCall: /httpPostJson\(investMcpUrl,\s*bodyStr,\s*issuedToken\)/,
  },
];

function groovyCode(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function isRegisteredTool(registryFile, toolName) {
  const openapi = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  return Object.values(openapi.paths || {}).some((pathItem) =>
    Object.values(pathItem).some((operation) => operation.operationId === toolName));
}

describe.each(FILTERS)('PingGateway $name Exchange #3 provider contract', (filter) => {
  const source = () => groovyCode(filter.file);

  test('selects PF from the signed issuer and fails closed when its configuration is incomplete', () => {
    const text = source();
    expect(text).toMatch(new RegExp(`def isPfSubject\\s*=\\s*pfIssuer\\s*&&\\s*${filter.issuerVariable}\\s*==\\s*pfIssuer`));
    expect(text).toMatch(/def pfExchangeConfigValid\s*=\s*\{/);
    expect(text).toMatch(/if\s*\(isPfSubject\s*&&\s*\(?\s*!pfExchangeConfigValid\s*\(/);
    if (filter.name === 'OLB') {
      expect(text).toContain('{"error":"pf_exchange_not_configured"}');
    } else {
      expect(text).toContain("rpcError(rpcId, -32603, 'pf_exchange_not_configured')");
    }
    expect(text.indexOf('pf_exchange_not_configured')).toBeLessThan(text.indexOf('httpPostForm(exEndpoint'));
  });

  test('routes PF subjects only with the dedicated PF exchanger credentials', () => {
    expect(source()).toMatch(/def exEndpoint\s*=\s*isPfSubject\s*\?\s*pfTokenEndpoint\s*:\s*tokenEndpoint/);
    expect(source()).toMatch(/def exClientId\s*=\s*isPfSubject\s*\?\s*pfTeClientId\s*:\s*teClientId/);
    expect(source()).toMatch(/def exClientSecret\s*=\s*isPfSubject\s*\?\s*pfTeClientSecret\s*:\s*teClientSecret/);
    expect(source()).not.toMatch(/pfTeClient(?:Id|Secret)\s*\?:\s*teClient/);
  });

  test('validates HTTPS, issuer authority, and configured PF token endpoint authentication', () => {
    const text = source();
    expect(text).toMatch(/issuerUri\.scheme\?\.equalsIgnoreCase\('https'\)/);
    expect(text).toMatch(/endpointUri\.scheme\?\.equalsIgnoreCase\('https'\)/);
    expect(text).toMatch(/issuerUri\.authority\s*==\s*endpointUri\.authority/);
    expect(text).toMatch(/pfTeAuthMethod\s+in\s+\['basic',\s*'client_secret_basic',\s*'post',\s*'client_secret_post'\]/);
    expect(text).toMatch(/if\s*\(isPfSubject\s*&&\s*pfTeAuthMethod\s+in\s+\['basic',\s*'client_secret_basic'\]\)/);
    expect(text).not.toMatch(/pfTokenEndpoint\s*\+\s*['"]\/token/);
  });

  test('uses PF policy scopes and preserves PingOne RFC 8707 resource targeting', () => {
    const text = source();
    if (filter.name === 'OLB') {
      expect(text).toMatch(/def pfOlbScope\s*=\s*System\.getenv\('PG_OLB_SCOPE_PF'\)\s*\?:\s*''/);
      expect(text).toMatch(/def requestedOlbScope\s*=\s*isPfSubject\s*\?\s*pfOlbScope\s*:\s*olbScope/);
      expect(text).toMatch(/if\s*\(requestedOlbScope\?\.trim\(\)\)\s*\{\s*params\['scope'\]\s*=\s*requestedOlbScope\.trim\(\)/);
      expect(text).toMatch(/if\s*\(!isPfSubject\)\s*\{\s*params\['resource'\]\s*=\s*olbAudience/);
      // Narrowed to the tool's scopes, only ever to a subset of the configured list.
      expect(text).toMatch(/def narrowed\s*=\s*requestedOlbScope\.trim\(\)\.split\([^)]*\)\.findAll\s*\{\s*it\s*&&\s*toolScopes\.contains\(it\)\s*\}/);
      expect(text).toMatch(/if\s*\(narrowed\)\s*requestedOlbScope\s*=\s*narrowed\.join\(' '\)/);
      expect(text.indexOf('def narrowed')).toBeLessThan(text.indexOf("params['scope']"));
    } else {
      expect(text).toMatch(/def wantScope\s*=\s*SCOPE_FOR_TOOL\[toolName\]/);
      expect(text).toMatch(/if\s*\(wantScope\)\s*params\['scope'\]\s*=\s*wantScope/);
      expect(text).toMatch(/'resource'\s*:\s*\(isPfSubject\s*\?\s*null\s*:\s*investAudience\)/);
    }
  });

  test('preserves sanitized insufficient-scope recovery without forwarding backend errors', () => {
    const text = source();
    expect(text).toMatch(/err\.code\s*==\s*-32005/);
    expect(text).toMatch(/safeScopeList/);
    expect(text).toMatch(/requiredScopes/);
    expect(text).toMatch(/missingScopes/);
    expect(text).toMatch(/availableScopes/);
    expect(text).toMatch(/code\s*:\s*-32005/);
    expect(text).toMatch(/message\s*:\s*['"]insufficient_scope['"]/);
    expect(text).not.toMatch(/error\.code\s*\?:\s*-32603/);
    if (filter.name === 'OLB') {
      expect(text).toMatch(/sanitizeMcpResponse\(toolResp\.body\)\.body/);
      expect(text).toMatch(/if\s*\(safeResult\.scopeDenied\)\s*\{\s*finalResp\.entity\.setString\(safeResult\.body\)/);
    } else {
      expect(text).toMatch(/def safeBackend\s*=\s*sanitizeMcpResponse\(beResp\.body\s*\?:\s*['"]['"]\)/);
      expect(text).toMatch(/if\s*\(safeBackend\.scopeDenied\s*\|\|\s*safeBackend\.isError\)/);
    }
  });

  test('types only native PF ID-JAGs as id-jag and requests an access token', () => {
    const text = source();
    const typVariable = filter.subjectTypVariable;
    const typeVariable = filter.subjectTypeVariable;
    expect(text).toMatch(new RegExp(`def ${typeVariable}\\s*=\\s*\\(isPfSubject\\s*&&\\s*${typVariable}\\s*==\\s*'oauth-id-jag\\+jwt'\\)`));
    expect(text).toMatch(new RegExp(`'subject_token_type'\\s*:\\s*${typeVariable}`));
    expect(text).toMatch(/'requested_token_type'\s*:\s*'urn:ietf:params:oauth:token-type:access_token'/);
  });

  test('passes the original subject token through and calls a registered MCP tool', () => {
    expect(source()).toMatch(/'subject_token'\s*:\s*subjectToken/);
    expect(source()).toMatch(filter.forwardingCall);
    expect(isRegisteredTool(filter.registry, filter.successTool)).toBe(true);
  });

  if (filter.name === 'OLB') {
    test('uses a validated PF MCP actor token only on PF Exchange #3', () => {
      const text = source();
      expect(text).toMatch(/System\.getenv\('PF_MCP_ACTOR_CLIENT_ID'\)/);
      expect(text).toMatch(/System\.getenv\('PF_MCP_ACTOR_CLIENT_SECRET'\)/);
      expect(text).toMatch(/System\.getenv\('PF_MCP_ACTOR_SCOPE'\)/);
      expect(text).toMatch(/def actorParams\s*=\s*\[\s*'grant_type'\s*:\s*'client_credentials'/);
      expect(text).toMatch(/if\s*\(pfMcpActorAuthMethod\s*==\s*'post'\)[\s\S]*?actorParams\['client_id'\][\s\S]*?actorParams\['client_secret'\][\s\S]*?actorHeaders\['Authorization'\]\s*=\s*'Basic '/);
      expect(text).toMatch(/httpPostForm\(pfTokenEndpoint,\s*actorFormBody,\s*actorHeaders\)/);
      expect(text).toMatch(/params\['actor_token'\]\s*=\s*pfActorToken/);
      expect(text).toMatch(/params\['actor_token_type'\]\s*=\s*'urn:ietf:params:oauth:token-type:access_token'/);
      expect(text).toMatch(/actorJwtParts\.length\s*!=\s*3/);
      expect(text).toMatch(/actorHeader\?\.typ[\s\S]*?id-jag/);
      expect(text).toMatch(/actorIdentity\?\.toString\(\)\s*!=\s*pfMcpActorClientId/);
      expect(text).toMatch(/expectedActorScopes\.every\s*\{\s*actorScopes\.contains\(it\)\s*\}/);
      expect(text).not.toMatch(/logger\.(?:info|warn|error)\([^\n]*actorResp\.body/);
    });
  }

  test('does not log or return raw exchange, backend, authorization, or session data', () => {
    const text = source();
    expect(text).not.toMatch(/logger\.(?:info|warn|error)\([^\n]*(?:exchangeResp|initResp|toolResp|beResp)\.body/);
    expect(text).not.toMatch(/logger\.(?:info|warn|error)\([^\n]*sessionId/);
    expect(text).not.toMatch(/(?:detail|pingone_error)\s*:\s*(?:initResp|exchangeResp)\.body/);
    expect(text).not.toMatch(/logger\.(?:info|warn|error)\([^\n]*(?:authHeader|subjectToken)/);
    expect(text).not.toMatch(/(?:parsedBody|backendEnvelope)\.error\.message\s*[,}]/);
    expect(text).toMatch(/error\s*:\s*['"](?:token_exchange_failed|mcp_initialize_failed|mcp_tool_call_failed)['"]/);
    expect(text).not.toMatch(/logger\.(?:info|warn|error)\([^\n]*e\.message/);
    expect(text).not.toMatch(/logger\.(?:info|warn|error)\([^\n]*(?:exEndpoint|mcpUrl|investMcpUrl|olbAudience|investAudience)/);
  });
});
