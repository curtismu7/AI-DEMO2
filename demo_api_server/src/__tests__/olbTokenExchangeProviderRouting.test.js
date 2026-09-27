'use strict';

const fs = require('fs');
const path = require('path');

// PingGateway filters have no Groovy unit-test harness in this repo. Keep the
// issuer boundary, incomplete-config behavior, and token-type contract pinned;
// the live local MCP call exercises the actual filter after deployment.
const GROOVY = path.join(__dirname, '..', '..', '..', 'ping-gateway', 'scripts', 'groovy', 'olb-token-exchange.groovy');
const SOURCE = fs.readFileSync(GROOVY, 'utf8');

describe('PingGateway Exchange #3 provider routing', () => {
  test('selects PF from the signed issuer, independent of optional PF endpoint config', () => {
    expect(SOURCE).toMatch(/def isPfSubject = pfIssuer && tokenIss == pfIssuer/);
    expect(SOURCE).toMatch(/def exEndpoint\s+= isPfSubject \? pfTokenEndpoint : tokenEndpoint/);
    expect(SOURCE).toMatch(/def exClientId\s+= isPfSubject \? pfTeClientId : teClientId/);
    expect(SOURCE).toMatch(/def exClientSecret\s*= isPfSubject \? pfTeClientSecret : teClientSecret/);
  });

  test('fails closed for PF subjects when endpoint or PF exchanger credentials are missing', () => {
    expect(SOURCE).toMatch(/if \(isPfSubject && \([\s\S]*?!pfTokenEndpoint[\s\S]*?!pfTeClientId[\s\S]*?!pfTeClientSecret[\s\S]*?!pfMcpActorClientId[\s\S]*?!pfMcpActorClientSecret[\s\S]*?!pfMcpActorScope[\s\S]*?pfMcpActorAuthMethod in \['basic', 'post'\]/);
    expect(SOURCE).toContain('{"error":"pf_exchange_not_configured"}');
    expect(SOURCE).not.toMatch(/pfTeClientId\s*\?:\s*teClientId/);
    expect(SOURCE).not.toMatch(/pfTeClientSecret\s*\?:\s*teClientSecret/);
  });

  test('uses id-jag typing only for PF ID-JAG JWTs and preserves access-token typing otherwise', () => {
    expect(SOURCE).toMatch(/tokenTyp == 'oauth-id-jag\+jwt'[\s\S]{0,100}\?\s*'urn:ietf:params:oauth:token-type:id-jag'[\s\S]{0,100}:\s*'urn:ietf:params:oauth:token-type:access_token'/);
    expect(SOURCE).toMatch(/isPfSubject && tokenTyp == 'oauth-id-jag\+jwt'/);
    expect(SOURCE).toContain("'subject_token_type'   : subjectTokenType");
  });

  test('uses PF default ATM for PF subjects while retaining PingOne resource targeting', () => {
    const paramsBlock = SOURCE.slice(
      SOURCE.indexOf('def params = ['),
      SOURCE.indexOf('if (requestedOlbScope?.trim())'),
    );

    expect(paramsBlock).toMatch(/if \(!isPfSubject\) \{[\s\S]*params\['resource'\]\s*=\s*olbAudience/);
    expect(paramsBlock).not.toMatch(/'resource'\s*:\s*olbAudience/);
  });

  test('uses PF-registered banking scopes for PF and preserves the PingOne scope list', () => {
    expect(SOURCE).toMatch(/def pfOlbScope\s*=\s*System\.getenv\('PG_OLB_SCOPE_PF'\)\s*\?:\s*''/);
    expect(SOURCE).toMatch(/def requestedOlbScope\s*=\s*isPfSubject\s*\?\s*pfOlbScope\s*:\s*olbScope/);
    expect(SOURCE).toMatch(/if \(requestedOlbScope\?\.trim\(\)\)\s*\{\s*params\['scope'\]\s*=\s*requestedOlbScope\.trim\(\)/);
    expect(SOURCE).toMatch(/PG_OLB_SCOPE setting is PingOne-specific/);
  });

  test('uses the PF MCP service actor token for PF Exchange #3 only', () => {
    expect(SOURCE).toMatch(/def pfMcpActorClientId\s*=\s*System\.getenv\('PF_MCP_ACTOR_CLIENT_ID'\)\s*\?:\s*''/);
    expect(SOURCE).toMatch(/def pfMcpActorClientSecret\s*=\s*System\.getenv\('PF_MCP_ACTOR_CLIENT_SECRET'\)\s*\?:\s*''/);
    expect(SOURCE).toMatch(/def pfMcpActorScope\s*=\s*System\.getenv\('PF_MCP_ACTOR_SCOPE'\)\s*\?:\s*''/);
    expect(SOURCE).toMatch(/def actorParams\s*=\s*\[[\s\S]*?'grant_type'\s*:\s*'client_credentials'/);
    expect(SOURCE).toMatch(/if \(pfMcpActorAuthMethod == 'post'\)[\s\S]*?actorParams\['client_id'\][\s\S]*?actorParams\['client_secret'\][\s\S]*?Authorization.*Basic/);
    expect(SOURCE).toMatch(/httpPostForm\(pfTokenEndpoint, actorFormBody, actorHeaders\)/);
    expect(SOURCE).toMatch(/if \(isPfSubject\) \{\s*params\['actor_token'\]\s*=\s*pfActorToken[\s\S]*?params\['actor_token_type'\]\s*=\s*'urn:ietf:params:oauth:token-type:access_token'/);
    expect(SOURCE).toMatch(/if \(actorResp\.code != 200\)[\s\S]*?pf_actor_token_failed/);
    expect(SOURCE).toMatch(/actorJwtParts\.length != 3/);
    expect(SOURCE).toMatch(/actorIdentity\s*=\s*actorClaims\.client_id\s*\?:\s*actorClaims\.sub/);
    expect(SOURCE).toMatch(/actorIdentity\?\.toString\(\) != pfMcpActorClientId/);
    expect(SOURCE).toMatch(/expectedActorScopes\.every\s*\{\s*actorScopes\.contains\(it\)\s*\}/);
    expect(SOURCE).toMatch(/actorHeader\?\.typ[\s\S]*?id-jag/);
    expect(SOURCE).not.toMatch(/logger\.(?:info|warn|error)\([^\n]*actorResp\.body/);
  });
});
