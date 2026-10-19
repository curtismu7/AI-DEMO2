// Per-arrow detail for /group-policy (pingStyle). Keyed by EDGES index; all values are MOCK teaching values, no real secrets.
import { RFC, SPEC, BEARER, CREDS, AUTHZ } from './pingStyleStandards';

const WORKER = { note: 'Worker token · BFF to PingOne API (client_credentials)', header: { alg: 'RS256', typ: 'JWT' }, claims: { iss: 'https://auth.pingone.com/ENV_ID/as', aud: 'https://api.pingone.com', client_id: 'WORKER_APP_ID', scope: 'p1:read:user p1:update:user', exp: 1790000900 } };
const DECISION = (decision, codes, user) => ({ note: `Decision · PingOne Authorize ${decision}`, claims: { decision, statements: codes.map((code) => ({ code, payload: code })), subject: user, resource: 'mcp-tool:group_gated', evaluatedAt: '2026-10-18T10:15:00Z' } });

export const GROUP_POLICY_DETAIL = {
  0: { form: 'PATCH /api/admin/feature-flags HTTP/1.1\nCookie: session=SESSION_ID\nContent-Type: application/json\n\n{ "key": "ff_authorize_group_policy", "enabled": true }', refs: [RFC(9110, 'HTTP semantics (PATCH)')] },
  1: { form: 'GET /api/groups/decision-board?verticalId=banking HTTP/1.1\nCookie: session=SESSION_ID', refs: [RFC(9110, 'HTTP semantics'), ...AUTHZ.slice(0, 1)] },
  2: { form: 'GET https://api.pingone.com/v1/environments/ENV_ID/users/USER_ID/memberOfGroups HTTP/1.1\nAuthorization: Bearer WORKER_ACCESS_TOKEN', tokens: [WORKER], refs: [...CREDS.slice(0, 1), ...BEARER.slice(0, 1)] },
  3: { form: 'POST DECISION_ENDPOINT_URL HTTP/1.1\nAuthorization: Bearer WORKER_ACCESS_TOKEN\nContent-Type: application/json\n\n{ "user": "demoUser", "groups": ["banking-tellers"], "tool": "group_gated", "verticalId": "banking" }', refs: [...AUTHZ.slice(0, 2), ...BEARER.slice(0, 1)] },
  4: { form: 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{ "decision": "PERMIT", "statements": [ { "code": "GROUP_MEMBER" } ] }', tokens: [DECISION('PERMIT', ['GROUP_MEMBER'], 'demoUser')], refs: [...AUTHZ.slice(0, 2)] },
  5: { form: 'GET /api/groups/check?username=demoDelegate&verticalId=banking HTTP/1.1\nCookie: session=SESSION_ID', refs: [RFC(9110, 'HTTP semantics'), SPEC('OpenID AuthZEN', 'Subject, resource, action decision request')] },
  6: { form: 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{ "username": "demoDelegate", "decision": "DENY", "statements": [ { "code": "NOT_IN_GROUP" } ] }', tokens: [DECISION('DENY', ['NOT_IN_GROUP'], 'demoDelegate')], refs: [...AUTHZ.slice(0, 2)] },
  7: { form: 'POST /api/groups/check/toggle HTTP/1.1\nCookie: session=SESSION_ID\nContent-Type: application/json\n\n{ "username": "demoDelegate", "verticalId": "banking", "inGroup": true }', refs: [RFC(9110, 'HTTP semantics (POST)')] },
  8: { form: 'POST https://api.pingone.com/v1/environments/ENV_ID/users/USER_ID/memberOfGroups HTTP/1.1\nAuthorization: Bearer WORKER_ACCESS_TOKEN\nContent-Type: application/json\n\n{ "id": "GROUP_ID" }\n\n# then re-read: GET .../memberOfGroups to verify', tokens: [WORKER], refs: [...CREDS.slice(0, 1), ...BEARER.slice(0, 1)] },
};
