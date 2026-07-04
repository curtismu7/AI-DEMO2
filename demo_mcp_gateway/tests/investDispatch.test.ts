'use strict';

import { routeTool, backendHttpUrl } from '../src/router';
import { getScopesForGatewayTool } from '../src/auth/toolScopes';

const cfg: any = { mortgageServiceBaseUrl: 'http://mortgage-service:8082' };

describe('show_investment api-key disposition', () => {
  test('routes to the apikey disposition', () => {
    expect(routeTool('show_investment')).toBe('apikey');
  });
  test('backend URL targets the /invest route', () => {
    expect(backendHttpUrl('apikey', 'show_investment', cfg)).toBe('http://mortgage-service:8082/invest');
  });
  test('requires invest:read scope', () => {
    expect(getScopesForGatewayTool('show_investment')).toContain('invest:read');
  });
});
