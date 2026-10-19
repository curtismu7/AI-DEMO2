// /mcp-gateway-oauth-flow: for each of the 26 steps of the OAuth handshake, the request on the wire, the MOCK token(s) in
// play and the standards behind the hop (published RFCs/specs plus emerging work). Grounded in demo_mcp_gateway
// (GatewayServer.ts, oauth/OAuthBrokerRouter.ts, auth/GatewayIntrospectionClient.ts, auth/McpTokenExchangeClient.ts,
// auth/PingOneAuthorizeClient.ts) and oauth-mcp (TokenIntrospector.ts). Hosts, ids and secrets are placeholders;
// token values are teaching values only. The vocabulary lives in pingStyleStandards.js.
// Shape per step: { form, tokens: [{ note, header?, claims }], refs }. An empty tokens list says why in the form text.
import { AUTH, BEARER, EXCHANGE, MCP, INTROSPECT, RFC, SPEC, DRAFT } from './pingStyleStandards';

const uniq = (refs) => refs.filter((r, i) => refs.findIndex((x) => x.id === r.id) === i);
export const refs = (...lists) => uniq(lists.flat());

const GW = 'https://<gateway host>';
const AS = 'https://auth.pingone.com/<envId>/as';
const HTTP = RFC(9110, 'HTTP semantics');
const JSONRPC = SPEC('JSON-RPC 2.0', 'Message framing MCP uses');
const TRANSPORT = SPEC('MCP transports 2025-11-25', 'Streamable HTTP: one POST per JSON-RPC message, JSON or SSE in reply');
const MCP_AUTH = MCP[0];
const PRM = MCP[1]; // RFC 9728
const RESOURCE = MCP[2]; // RFC 8707
const BEARER_USE = BEARER[0]; // RFC 6750
const DPOP = BEARER[1]; // RFC 9449
const PKCE = AUTH[1];
const OAUTH = AUTH[0];
const BCP = AUTH[2];
const OAUTH21 = AUTH[6];
const EXCH = EXCHANGE[0]; // RFC 8693
const JWT = INTROSPECT[2]; // RFC 7519
const JWK = INTROSPECT[3]; // RFC 7517
const INTRO = INTROSPECT[0]; // RFC 7662
const AS_META = RFC(8414, 'Authorization Server Metadata');
const DCR = RFC(7591, 'Dynamic Client Registration');
const PASSTHROUGH = SPEC('MCP security best practices', 'Token passthrough is forbidden, so the gateway exchanges the token instead of forwarding it');
const XACML = SPEC('XACML 3.0', 'The PEP / PDP split: the gateway enforces, PingOne Authorize decides');
const ZERO_TRUST = SPEC('NIST SP 800-207', 'Zero Trust Architecture: a policy enforcement point in front of every resource (an analogy; PingOne Authorize applies its own policy)');
const DISCOVER_NEXT = DRAFT('MCP 2026-07-28', 'The newer MCP protocol version (server/discover, per-request negotiation) the gateway partly supports; this page draws the initialize handshake');

const HEADER = { alg: 'RS256', typ: 'JWT', kid: 'mock-kid-1' };
const ACCESS = {
  note: 'Access token · issued by PingOne, audience the gateway',
  header: HEADER,
  claims: { iss: AS, sub: '<user id>', aud: 'mcpgateway.ping.demo', client_id: '<broker app client id>', scope: 'openid mcp:invoke', iat: 1790000000, exp: 1790003600 },
};
const ACTOR = {
  note: 'Actor token · the gateway\'s own client_credentials token',
  header: HEADER,
  claims: { iss: AS, sub: '<exchanger client id>', aud: 'mcpgateway.ping.demo', client_id: '<exchanger client id>', scope: 'mcp:invoke', iat: 1790000010, exp: 1790003610 },
};
const EXCHANGED = {
  note: 'Exchanged token · audience the MCP server',
  header: HEADER,
  claims: { iss: AS, sub: '<user id>', aud: '<MCP server resource URI>', client_id: '<exchanger client id>', scope: 'read', act: { sub: '<exchanger client id>' }, iat: 1790000020, exp: 1790000320 },
};
const INTROSPECTION = {
  note: 'Introspection response · RFC 7662 JSON, not a JWT',
  claims: { active: true, sub: '<user id>', scope: 'openid mcp:invoke', aud: 'mcpgateway.ping.demo', client_id: '<broker app client id>', exp: 1790003600 },
};

const MCP_CALL = (id, body) => `POST ${GW}/mcp HTTP/1.1\nAuthorization: Bearer <access token>\nContent-Type: application/json\nAccept: application/json, text/event-stream\n\n{ "jsonrpc": "2.0", "id": ${id}, ${body} }`;
const INIT_BODY = '"method": "initialize",\n  "params": { "protocolVersion": "<version>", "capabilities": {}, "clientInfo": { "name": "<client name>", "version": "<version>" } }';
const INIT_RESULT = '{ "jsonrpc": "2.0", "id": 1, "result": { "protocolVersion": "<version>", "capabilities": { "tools": {} }, "serverInfo": { "name": "AI Demo MCP Server", "version": "<version>" } } }';
const NO_TOKEN = (why) => `No token is involved: ${why}`;

// Index = the edge index of the sequence figure (step n = index + 1).
export const SEQ_DETAIL = [
  {
    form: `(user action, no HTTP yet)\nThe user adds the MCP server to the client: url = ${GW}/mcp\n\n${NO_TOKEN('the user has only given the client an address')}`,
    tokens: [],
    refs: refs([MCP_AUTH, TRANSPORT]),
  },
  {
    form: `POST ${GW}/mcp HTTP/1.1\nContent-Type: application/json\nAccept: application/json, text/event-stream\n(no Authorization header)\n\n{ "jsonrpc": "2.0", "id": 1, ${INIT_BODY} }\n\n${NO_TOKEN('this first request is sent on purpose without one, to learn how to authenticate')}`,
    tokens: [],
    refs: refs([MCP_AUTH, TRANSPORT, JSONRPC, HTTP]),
  },
  {
    form: `HTTP/1.1 401 Unauthorized\nContent-Type: application/json\nWWW-Authenticate: Bearer realm="banking-mcp-gateway", scope="mcp:invoke",\n  resource_metadata="${GW}/.well-known/oauth-protected-resource",\n  error="invalid_token", error_description="Bearer token required"\n\n{ "error": "invalid_token", "message": "Bearer token required" }\n\n${NO_TOKEN('this is the challenge that tells the client where to look')}`,
    tokens: [],
    refs: refs([PRM, BEARER_USE, MCP_AUTH, HTTP]),
  },
  {
    form: `GET ${GW}/.well-known/oauth-protected-resource HTTP/1.1\nAccept: application/json\n\n${NO_TOKEN('the metadata is public (Cache-Control: public, CORS open), so the client fetches it before it has a token')}`,
    tokens: [],
    refs: refs([PRM, MCP_AUTH, HTTP]),
  },
  {
    form: `HTTP/1.1 200 OK   Content-Type: application/json\n{ "resource": "mcpgateway.ping.demo",\n  "authorization_servers": ["${GW}"],\n  "scopes_supported": ["read", "write", "transfer", "mcp:invoke", "..."],\n  "bearer_methods_supported": ["header"],\n  "resource_name": "Demo MCP Gateway" }\n\nauthorization_servers names the gateway's OWN OAuth broker, not PingOne: PingOne has no open dynamic registration.\nThe client then reads the broker's own metadata:\nGET ${GW}/.well-known/oauth-authorization-server\n-> { "issuer": "${GW}", "authorization_endpoint": "${GW}/oauth/authorize",\n     "token_endpoint": "${GW}/oauth/token", "registration_endpoint": "${GW}/oauth/register",\n     "response_types_supported": ["code"], "grant_types_supported": ["authorization_code"],\n     "token_endpoint_auth_methods_supported": ["none"], "code_challenge_methods_supported": ["S256"] }\n\n${NO_TOKEN('discovery documents carry no credentials')}`,
    tokens: [],
    refs: refs([PRM, AS_META, RESOURCE, MCP_AUTH]),
  },
  {
    form: `Register (the broker accepts only loopback redirect URIs):\nPOST ${GW}/oauth/register\n{ "client_name": "<client name>", "redirect_uris": ["http://127.0.0.1:<port>/callback"],\n  "grant_types": ["authorization_code"], "scope": "mcp:invoke" }\n-> 201 { "client_id": "<new client id>", "token_endpoint_auth_method": "none", "scope": "mcp:invoke", ... }\n\nAuthorize, with PKCE (S256), in the user's browser:\nGET ${GW}/oauth/authorize?response_type=code&client_id=<new client id>\n  &redirect_uri=http://127.0.0.1:<port>/callback&code_challenge=<S256 hash>&code_challenge_method=S256\n  &state=<client state>&scope=mcp:invoke&resource=mcpgateway.ping.demo\n-> the broker answers with a redirect to PingOne (step 7)\n\nThe client talks to the gateway's own broker here, not to PingOne. The broker has no Client ID Metadata Document support: registration is RFC 7591 only.\n${NO_TOKEN('the user is still signing in; the PKCE verifier is a one-time secret, not a token')}`,
    tokens: [],
    refs: refs([OAUTH, PKCE, DCR, AS_META, RESOURCE, BCP, MCP_AUTH], [OAUTH21]),
  },
  {
    form: `302 Location: ${AS}/authorize?client_id=<broker app client id>\n  &redirect_uri=${GW}/oauth/callback&response_type=code&state=<relay state>\n  &code_challenge=<the broker's own S256 hash>&code_challenge_method=S256\n  &resource=mcpgateway.ping.demo&scope=openid mcp:invoke\n\nThe user's browser follows it to PingOne and signs in (password, then whatever MFA the PingOne policy asks for). Two PKCE pairs are in flight: the client's (against the broker) and the broker's (against PingOne).\n${NO_TOKEN('the user is still signing in at PingOne')}`,
    tokens: [],
    refs: refs([OAUTH, PKCE, AUTH[3], RESOURCE, BCP]),
  },
  {
    form: `PingOne redirects the browser to the broker:\nGET ${GW}/oauth/callback?code=<PingOne code>&state=<relay state>\n\nThe broker redeems it at PingOne (a public client: no secret, the PKCE verifier proves it):\nPOST ${AS}/token HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code&code=<PingOne code>&redirect_uri=${GW}/oauth/callback\n&client_id=<broker app client id>&code_verifier=<broker PKCE secret>&resource=mcpgateway.ping.demo\n\n-> 200 { "access_token": "<access token>", "token_type": "Bearer", "expires_in": 3600, "id_token": "<id token>" }`,
    tokens: [ACCESS],
    refs: refs([OAUTH, PKCE, RESOURCE, BCP]),
  },
  {
    form: `The broker redirects the browser to the client with its own one-time code:\n302 http://127.0.0.1:<port>/callback?code=<broker code>&state=<client state>\n\nPOST ${GW}/oauth/token HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code&code=<broker code>&redirect_uri=http://127.0.0.1:<port>/callback\n&client_id=<new client id>&code_verifier=<PKCE secret>\n\n-> 200 { "access_token": "<access token>", "token_type": "Bearer", "expires_in": 3600, "scope": "mcp:invoke" }\n\nThe broker verifies the client's PKCE, then returns the exact access token PingOne issued (a pass-through).`,
    tokens: [ACCESS],
    refs: refs([OAUTH, PKCE, BEARER_USE, BCP, MCP_AUTH], [OAUTH21]),
  },
  {
    form: `(no HTTP: the client keeps the token)\naccess_token = <access token>   expires_in = 3600\n\nThe token is bound to the gateway audience. The client keeps it in its own secure storage and sends it only to this gateway.`,
    tokens: [ACCESS],
    refs: refs([MCP_AUTH, OAUTH, BCP]),
  },
  {
    form: `${MCP_CALL(2, INIT_BODY)}\n\n(a gateway that requires DPoP also expects a DPoP proof header; a token that is not bound gets 401 error="invalid_dpop_proof")`,
    tokens: [ACCESS],
    refs: refs([MCP_AUTH, BEARER_USE, DPOP, TRANSPORT, JSONRPC]),
  },
  {
    form: `(no network call to PingOne here)\nWith PINGONE_JWKS_ENDPOINT set, the gateway verifies the signature against that JWKS and fails closed; with it unset (the stock demo stack) it only decodes the JWT.\n- aud must be one of MCP_GW_RESOURCE_URI (mcpgateway.ping.demo), exp not passed\n- GatewayTokenPolicy: sub non-empty; act.sub non-empty when an act claim is present\n- anti-bypass: a backend MCP server audience must never appear in the token's aud\nfailure -> 401 WWW-Authenticate: Bearer realm="banking-mcp-gateway", error="invalid_token"\n\nThis is a cheap pre-filter. Steps 11-12 are the authoritative check.`,
    tokens: [ACCESS],
    refs: refs([JWT, RESOURCE]),
  },
  {
    form: `POST ${AS}/introspect HTTP/1.1\nAuthorization: Basic <client id:client secret>   (or client_id + client_secret in the body)\nContent-Type: application/x-www-form-urlencoded\n\ntoken=<access token>&token_type_hint=access_token`,
    tokens: [ACCESS],
    refs: refs([INTRO, OAUTH, JWT]),
  },
  {
    form: `HTTP/1.1 200 OK\n{ "active": true, "sub": "<user id>", "scope": "openid mcp:invoke", "aud": "mcpgateway.ping.demo",\n  "client_id": "<broker app client id>", "exp": 1790003600 }\n\nactive: false (or an unreachable endpoint) fails closed with 401. The result is cached per token: 30 s in dev, 5 s in production, which is also the longest a revoked token keeps working.`,
    tokens: [INTROSPECTION],
    refs: refs([INTRO]),
  },
  {
    form: `POST <PingOne Authorize endpoint>/governance/pap/alpha/policy/<worker id>/decision\n{ "parameters": { "DecisionContext": "McpRequest", "McpMethod": "initialize", "ToolName": "",\n    "UserId": "<user id>", "ClientId": "<user id>", "TokenScopes": "openid mcp:invoke",\n    "McpResourceUri": "mcpgateway.ping.demo", "TokenIss": "${AS}", "TokenExp": "1790003600" } }\n-> { "decision": "PERMIT" }   (shape illustrative; the demo stack answers the same path from its mock PDP)\n\nDENY (or PingOne Authorize unreachable) -> 403, fail closed. For tools/call the same call carries ToolName and the arguments.`,
    tokens: [ACCESS],
    refs: refs([XACML, ZERO_TRUST]),
  },
  {
    form: `POST ${AS}/token HTTP/1.1\nAuthorization: Basic <client id:client secret>\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<access token>&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=<actor token>&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n&requested_token_type=urn:ietf:params:oauth:token-type:access_token\n&resource=<MCP server resource URI>&scope=<subject scopes the backend accepts>\n\nresource= (not audience=) narrows the new token to one resource server: PingOne ignores audience=. The actor token is the gateway's own client_credentials token, so the delegation chain survives into the last hop.`,
    tokens: [ACCESS, ACTOR],
    refs: refs([EXCH, RESOURCE, PASSTHROUGH, OAUTH, MCP_AUTH]),
  },
  {
    form: `HTTP/1.1 200 OK\n{ "access_token": "<exchanged token>", "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",\n  "token_type": "Bearer", "expires_in": 300 }\n\nThe gateway caches it per (subject token, audience, scopes) until about 5 s before it expires. A rejected exchange (invalid_scope, no overlap between the caller's scopes and the backend's) fails the request.`,
    tokens: [EXCHANGED],
    refs: refs([EXCH, PASSTHROUGH]),
  },
  {
    form: `POST <MCP server url> HTTP/1.1\nAuthorization: Bearer <exchanged token>\nContent-Type: application/json\n\n{ "jsonrpc": "2.0", "id": 2, ${INIT_BODY} }\n\nThe client's original token never leaves the gateway.`,
    tokens: [EXCHANGED],
    refs: refs([MCP_AUTH, BEARER_USE, PASSTHROUGH, TRANSPORT, JSONRPC]),
  },
  {
    form: `(no network call to the client; one cached key fetch)\nGET ${AS}/jwks   (cached)\nverify: signature against the JWKS key named by the header kid, iss, exp, and aud is one of MCP_SERVER_RESOURCE_URI\nfailure -> 401; the MCP server does not simply trust the gateway's decision.`,
    tokens: [EXCHANGED],
    refs: refs([JWT, JWK, RESOURCE, MCP_AUTH]),
  },
  {
    form: `HTTP/1.1 200 OK\n${INIT_RESULT}\n\n${NO_TOKEN('the answer carries no credential')}`,
    tokens: [],
    refs: refs([MCP_AUTH, TRANSPORT, JSONRPC], [DISCOVER_NEXT]),
  },
  {
    form: `HTTP/1.1 200 OK\n${INIT_RESULT}\n\nThe gateway relays the MCP server's answer.\n${NO_TOKEN('the response carries no credential')}`,
    tokens: [],
    refs: refs([MCP_AUTH, TRANSPORT, JSONRPC]),
  },
  {
    form: `${MCP_CALL(3, '"method": "tools/list"')}`,
    tokens: [ACCESS],
    refs: refs([MCP_AUTH, BEARER_USE, TRANSPORT, JSONRPC]),
  },
  {
    form: `(same checks, answered from caches where possible)\n- local pre-filter (decode, aud, claim policy)\n- introspection: cached 30 s (dev) / 5 s (production)\n- PingOne Authorize decision for McpMethod "tools/list"\n- token exchange: cached per (subject, audience, scopes) until about 5 s before expiry\nNo session-scoped trust: every call is checked again.`,
    tokens: [ACCESS, EXCHANGED],
    refs: refs([INTRO, EXCH, XACML, ZERO_TRUST]),
  },
  {
    form: `POST <MCP server url> HTTP/1.1\nAuthorization: Bearer <exchanged token>\nContent-Type: application/json\n\n{ "jsonrpc": "2.0", "id": 3, "method": "tools/list" }`,
    tokens: [EXCHANGED],
    refs: refs([MCP_AUTH, BEARER_USE, PASSTHROUGH, JSONRPC]),
  },
  {
    form: `HTTP/1.1 200 OK\n{ "jsonrpc": "2.0", "id": 3, "result": { "tools": [ { "name": "<tool name>", "description": "<text>", "inputSchema": { "type": "object" } }, ... ] } }\n\nThe full catalog comes back unfiltered; scope filtering is left to the gateway and the policy decision.\n${NO_TOKEN('the response carries no credential')}`,
    tokens: [],
    refs: refs([MCP_AUTH, TRANSPORT, JSONRPC]),
  },
  {
    form: `HTTP/1.1 200 OK\n{ "jsonrpc": "2.0", "id": 3, "result": { "tools": [ { "name": "<tool name>" }, ... ] } }\n\nThe gateway relays the tool list (JSON, or SSE frames).\n${NO_TOKEN('the response carries no credential')}`,
    tokens: [],
    refs: refs([MCP_AUTH, TRANSPORT, JSONRPC]),
  },
];

// The architecture figure draws 13 arrows; each is one or two sequence steps, so its detail is those steps merged.
const merge = (...idx) => {
  const parts = idx.map((i) => SEQ_DETAIL[i]);
  return {
    form: parts.map((p) => p.form).join('\n\n----\n\n'),
    tokens: parts.flatMap((p) => p.tokens).filter((t, i, all) => all.findIndex((x) => x.note === t.note) === i),
    refs: refs(...parts.map((p) => p.refs)),
  };
};
export const ARCH_DETAIL = [
  merge(0, 1), // connect + initialize without a token
  SEQ_DETAIL[2],
  merge(3, 4), // discovery
  SEQ_DETAIL[5], // client to the broker
  SEQ_DETAIL[6], // broker to PingOne
  SEQ_DETAIL[7], // PingOne back to the broker
  SEQ_DETAIL[8], // broker to the client
  merge(10, 11, 14), // Bearer initialize, then the gateway's own local and PingOne Authorize checks
  merge(12, 13),
  merge(15, 16),
  SEQ_DETAIL[17],
  merge(18, 19),
  SEQ_DETAIL[20],
];
