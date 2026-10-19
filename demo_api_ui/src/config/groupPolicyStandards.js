// Per-arrow detail for /group-policy (pingStyle). Keyed by EDGES index; MOCK teaching values, no real secrets.
// Wire shapes follow routes/groupMembership.js, services/pingOneAuthorizeService.js, services/pingOneGroupMembershipService.js and GroupPolicyBoardPage.jsx.
import { RFC, SPEC, BEARER, CREDS, EXCHANGE, AUTHZ } from './pingStyleStandards';

const HTTP = RFC(9110, 'HTTP semantics');
const COOKIE = RFC(6265, 'HTTP state management (the session cookie)');
const P1_MGMT = SPEC('PingOne Management API', 'Users, Groups and memberOfGroups endpoints');
const P1_WORKER = SPEC('PingOne worker application', 'Client credentials token for Management API calls');
const P1_AZ = SPEC('PingOne Authorize decision endpoints', 'POST decisionEndpoints/{id} with Trust Framework parameters');
const AZEN = { ...AUTHZ[0], title: 'Standard PEP to PDP API; the call here is PingOne Authorize\'s own Trust Framework shape' };

const TOKEN_REQ = 'POST https://auth.pingone.com/ENV_ID/as/token HTTP/1.1\nAuthorization: Basic BASE64(WORKER_CLIENT_ID:WORKER_CLIENT_SECRET)\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=client_credentials';
const WORKER = { note: 'Worker token · client_credentials for the PingOne API', header: { alg: 'RS256', typ: 'JWT' }, claims: { iss: 'https://auth.pingone.com/ENV_ID/as', aud: 'https://api.pingone.com', client_id: 'WORKER_APP_ID', iat: 1790000000, exp: 1790003600 } };

const REQUIRED_GROUP = 'Banking_PremiumTier';
const TOOL = 'get_sensitive_account_details';
const MEMBER_ROW = { verticalId: 'banking', displayName: 'Banking', tool: TOOL, requiredGroup: REQUIRED_GROUP, inRequiredGroup: true, source: 'pingone', decision: 'PERMIT', codes: ['mcp-tool-authorized'], tokenPresented: true };
const DENY_CHECK = { username: 'demoDelegate', verticalId: 'banking', requiredGroup: REQUIRED_GROUP, gatedTool: TOOL, userGroups: ['AI_Demo_Delegates'], inRequiredGroup: false, source: 'pingone', decision: 'DENY', denyReason: 'user_not_in_group', codes: ['mcp-authorization-denied', 'mcp-user-not-in-group'], policyEnabled: true, liveLookupReady: true };

const json = (o) => JSON.stringify(o, null, 2);
const decisionRequest = (userId) => `POST https://api.pingone.com/v1/environments/ENV_ID/decisionEndpoints/MCP_DECISION_ENDPOINT_ID HTTP/1.1\nAuthorization: Bearer AUTHORIZE_WORKER_ACCESS_TOKEN\nContent-Type: application/json\n\n${json({ parameters: { DecisionContext: 'McpFirstTool', McpMethod: 'tools/call', UserId: userId, ToolName: TOOL, Vertical: 'banking', RequiredGroup: REQUIRED_GROUP, InRequiredGroup: true, UserTier: 'PrivateBanking' } })}`;

export const GROUP_POLICY_DETAIL = {
  0: {
    form: `GET /api/admin/feature-flags HTTP/1.1\nCookie: session=SESSION_ID\n\nPATCH /api/admin/feature-flags HTTP/1.1\nCookie: session=SESSION_ID\nContent-Type: application/json\n\n${json({ updates: { ff_authorize_group_policy: true } })}`,
    refs: [HTTP, RFC(5789, 'PATCH method for HTTP'), COOKIE],
  },
  1: {
    form: 'GET /api/groups/decision-board?verticalId=banking HTTP/1.1\nCookie: session=SESSION_ID',
    refs: [HTTP, COOKIE],
  },
  2: {
    form: `${TOKEN_REQ}\n\nGET https://api.pingone.com/v1/environments/ENV_ID/users/USER_ID/memberOfGroups HTTP/1.1\nAuthorization: Bearer WORKER_ACCESS_TOKEN`,
    tokens: [WORKER],
    refs: [P1_MGMT, P1_WORKER, CREDS[0], BEARER[0]],
  },
  3: {
    form: `${TOKEN_REQ}\n\n${decisionRequest('USER_ID')}`,
    tokens: [{ ...WORKER, note: 'Authorize worker token · its own client_credentials grant for the decision endpoint' }],
    refs: [P1_AZ, CREDS[0], BEARER[0], EXCHANGE[0], AZEN],
  },
  4: {
    form: `HTTP/1.1 200 OK (PingOne Authorize to the BFF)\nContent-Type: application/json\n\n${json({ decision: 'PERMIT', statements: [{ code: 'mcp-tool-authorized' }] })}\n\nHTTP/1.1 200 OK (BFF to the board)\nContent-Type: application/json\n\n${json({ username: 'demoUser', liveLookupReady: true, policyEnabled: true, rows: [MEMBER_ROW] })}`,
    refs: [P1_AZ, HTTP],
  },
  5: {
    form: 'GET /api/groups/check?username=demoDelegate&verticalId=banking HTTP/1.1\nCookie: session=SESSION_ID',
    refs: [HTTP, COOKIE],
  },
  6: {
    form: `HTTP/1.1 200 OK (BFF to the panel)\nContent-Type: application/json\n\n${json(DENY_CHECK)}`,
    refs: [P1_AZ, HTTP],
  },
  7: {
    form: `POST /api/groups/check/toggle HTTP/1.1\nCookie: session=SESSION_ID\nContent-Type: application/json\n\n${json({ username: 'demoDelegate', verticalId: 'banking', inGroup: true })}`,
    refs: [HTTP, COOKIE],
  },
  8: {
    form: `GET https://api.pingone.com/v1/environments/ENV_ID/groups?filter=name%20eq%20%22${REQUIRED_GROUP}%22 HTTP/1.1\nAuthorization: Bearer WORKER_ACCESS_TOKEN\n\nPOST https://api.pingone.com/v1/environments/ENV_ID/users/USER_ID/memberOfGroups HTTP/1.1\nAuthorization: Bearer WORKER_ACCESS_TOKEN\nContent-Type: application/json\n\n${json({ id: 'GROUP_ID' })}\n\nGET https://api.pingone.com/v1/environments/ENV_ID/users/USER_ID/memberOfGroups HTTP/1.1\nAuthorization: Bearer WORKER_ACCESS_TOKEN`,
    tokens: [WORKER],
    refs: [P1_MGMT, P1_WORKER, CREDS[0], BEARER[0]],
  },
};
