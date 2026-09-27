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
    successTool: 'get_my_accounts',
    registry: REGISTERED_TOOLS.olb,
    forwardingCall: /httpPostJson\(mcpUrl,\s*rawBody,\s*toolHdrs\)/,
  },
  {
    name: 'Invest',
    file: path.join(ROOT, 'ping-gateway/scripts/groovy/invest-dispatch.groovy'),
    issuerVariable: 'subjectIss',
    successTool: 'get_investment_accounts',
    registry: REGISTERED_TOOLS.invest,
    forwardingCall: /httpPostJson\(investMcpUrl,\s*bodyStr,\s*issuedToken\)/,
  },
];

function expectMatch(text, pattern) {
  expect(pattern.test(text)).toBe(true);
}

function expectNoMatch(text, pattern) {
  expect(pattern.test(text)).toBe(false);
}

function isRegisteredTool(registryFile, toolName) {
  const openapi = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  return Object.values(openapi.paths || {}).some((pathItem) =>
    Object.values(pathItem).some((operation) => operation.operationId === toolName));
}

function groovyCode(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe.each(FILTERS)('PingGateway $name Exchange #3 provider contract', (filter) => {
  const source = () => groovyCode(filter.file);

  test('selects PF from the parsed issuer even when optional PF settings are absent', () => {
    expectMatch(source(), new RegExp(`def isPfSubject\\s*=\\s*pfIssuer\\s*&&\\s*${filter.issuerVariable}\\s*==\\s*pfIssuer`));
    expectMatch(source(), /if\s*\(isPfSubject\s*&&\s*!pfExchangeConfigValid\s*\(\s*\)\s*\)/);
    expectMatch(source(), /pf_exchange_not_configured/);
    expectMatch(source(), /if\s*\(!pfIssuer\s*\|\|\s*!pfTokenEndpoint\s*\|\|\s*!pfTeClientId\s*\|\|\s*!pfTeClientSecret\)/);
    expect(source().indexOf('pf_exchange_not_configured')).toBeLessThan(source().indexOf('httpPostForm(exEndpoint'));
  });

  test('routes PF subjects only with the dedicated PF exchanger credentials', () => {
    expectMatch(source(), /def exEndpoint\s*=\s*isPfSubject\s*\?\s*pfTokenEndpoint\s*:\s*tokenEndpoint/);
    expectMatch(source(), /def exClientId\s*=\s*isPfSubject\s*\?\s*pfTeClientId\s*:\s*teClientId/);
    expectMatch(source(), /def exClientSecret\s*=\s*isPfSubject\s*\?\s*pfTeClientSecret\s*:\s*teClientSecret/);
    expectNoMatch(source(), /pfTeClient(?:Id|Secret)\s*\?:\s*teClient/);
  });

  test('validates HTTPS and equal issuer/endpoint authority without replacing the token path', () => {
    expectMatch(source(), /def pfExchangeConfigValid\s*=\s*\{[\s\S]*?issuerUri\.scheme[\s\S]*?https/i);
    expectMatch(source(), /issuerUri\.authority\s*==\s*endpointUri\.authority/);
    expectMatch(source(), /pfTeAuthMethod\s+in\s+\['basic',\s*'client_secret_basic',\s*'post',\s*'client_secret_post'\]/);
    expectMatch(source(), /def exEndpoint\s*=\s*isPfSubject\s*\?\s*pfTokenEndpoint/);
    expectNoMatch(source(), /pfTokenEndpoint\s*\+\s*['"]\/token/);
  });

  test('uses PF endpoint auth and policy-derived audience contracts', () => {
    expectMatch(source(), /System\.getenv\(['"]PF_TE_AUTH_METHOD['"]\)\s*\?:\s*'basic'/);
    expectMatch(source(), /if\s*\(isPfSubject\s*&&\s*pfTeAuthMethod\s+in\s+\['basic',\s*'client_secret_basic'\]\)/);
    if (filter.name === 'OLB') {
      expectMatch(source(), /if\s*\(!isPfSubject\)\s*params\[['"]resource['"]\]\s*=\s*olbAudience/);
    } else {
      expectMatch(source(), /'resource'\s*:\s*\(isPfSubject\s*\?\s*null\s*:\s*investAudience\)/);
    }
  });

  test('types only exactly id-jag JWTs as id-jag and requests an access token', () => {
    expectMatch(source(), /subjectTyp\s*==\s*['"]oauth-id-jag\+jwt['"]/);
    expectMatch(source(), /subject_token_type[\s\S]{0,180}subjectType/);
    expectMatch(source(), /requested_token_type[\s\S]{0,100}token-type:access_token/);
  });

  test('passes the original subject token through and exercises a registered MCP tool', () => {
    expectMatch(source(), /subject_token[\s\S]{0,100}subjectToken/);
    expectMatch(source(), filter.forwardingCall);
    expect(isRegisteredTool(filter.registry, filter.successTool)).toBe(true);
  });

  test('does not log or return raw exchange, backend, authorization, or MCP session data', () => {
    const text = source();
    expectNoMatch(text, /logger\.(?:info|warn|error)\([^\n]*(?:exchangeResp|initResp|toolResp|beResp)\.body/);
    expectNoMatch(text, /logger\.(?:info|warn|error)\([^\n]*sessionId/);
    expectNoMatch(text, /(?:detail|pingone_error)\s*:\s*(?:initResp|exchangeResp)\.body/);
    expectNoMatch(text, /logger\.(?:info|warn|error)\([^\n]*(?:authHeader|subjectToken)/);
    expectNoMatch(text, /(?:parsedBody|backendEnvelope)\.error\.code/);
    expectMatch(text, /error\s*:\s*['"](?:token_exchange_failed|mcp_initialize_failed|mcp_tool_call_failed)['"]/);
    if (filter.name === 'OLB') {
      expectMatch(text, /catch\s*\(Exception ignored\)\s*\{\s*safeBody\s*=\s*JsonOutput\.toJson\(\[error:\s*'mcp_tool_call_failed'\]\)/);
    } else {
      expectMatch(text, /catch\s*\(Exception ignored\)\s*\{\s*return Promises\.newResultPromise\(rpcError\(rpcId, -32603, 'mcp_tool_call_failed'\)\)/);
    }
  });
});
