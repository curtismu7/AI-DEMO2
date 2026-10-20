// Shared building blocks for the four delegation diagrams drawn in the Ping style (Delegated Access Proof, Invest
// Dual-Auth, Delegated Commerce, Delegation Chain Value). A step detail is { form, tokens, noToken?, refs }, the shape
// StaticFlowDiagram's reel reads (see utils/diagramReel.js withStepDetail). Every value is a MOCK teaching value.
import { RFC, SPEC, EXCHANGE, AUTHZ, BEARER, INTROSPECT, MCP, STEPUP } from './pingStyleStandards';

// Ping palette: dark = apps and agents, red = Ping product, grey = infrastructure that is not a Ping product.
export const APP = '#151a24';
export const PING = '#b5231a';
export const INFRA = '#5a5f69';

export const ISS = 'https://auth.pingone.com/MOCK-ENV-ID/as';
export const HTTP = RFC(9110, 'HTTP semantics');
export const COOKIE = RFC(6265, 'HTTP state management (the session cookie)');
export const JSONRPC = SPEC('JSON-RPC 2.0', 'Request and response envelope MCP uses');
export const EXCHANGE_RFC = { ...EXCHANGE[0] };
export const ACT = { ...EXCHANGE[0], title: 'OAuth 2.0 Token Exchange: subject_token, actor_token and the act claim (nested for a second agent)' };
export const AUTHZEN = AUTHZ[0];
export { RFC, SPEC, BEARER, INTROSPECT, MCP, STEPUP, EXCHANGE, AUTHZ };

export const GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const JWT_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
export const TOKEN_URL = `${ISS}/token`;
export const json = (o) => JSON.stringify(o, null, 2);

const HEADER = { alg: 'RS256', kid: 'mock-key-1' };
export const tok = (note, claims) => ({ note, header: HEADER, claims });

// A step with no token in play says why; the reason is also the last line of the form, which the detail panel shows.
export const D = (form, refs, tokens = [], noToken) => ({
  form: tokens.length || !noToken ? form : `${form}\n\nToken: none. ${noToken}`,
  tokens,
  ...(tokens.length ? {} : { noToken }),
  refs: refs.filter((r, i) => refs.findIndex((x) => x.id === r.id) === i),
});

export const USER_TOKEN = tok('User access token · the SUBJECT of the exchange; it stays in the BFF session', {
  iss: ISS, sub: 'user-1aee74ae', aud: ['enduser.ping.demo'], scope: 'ai:agent:read read transfer openid profile', exp: 1790003600,
});
export const post = (path, body, bearer = false) =>
  `POST ${path} HTTP/1.1\nHost: api.ping.demo:3001\n${bearer ? 'Authorization: Bearer <access token>\n' : 'Cookie: session=<opaque session id>\n'}Content-Type: application/json\n\n${json(body)}`;
