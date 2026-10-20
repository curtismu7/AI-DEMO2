// Per-step detail for the batch-3 use-case diagrams (UC-AIC-TX, UC-LOGIN-AIC, UC-LOGIN, UC-MUSE1, UC-MUSE2,
// UC-NHI1, UC-OBO, UC-PRIVB, UC-PRIVC, UC-PRIVD). Shape: see config/useCaseDiagrams/stepDetail.js.
// Every token is a decoded MOCK value (never a compact JWT); forms use placeholders only.
import { RFC, DRAFT, SPEC } from "./pingStyleStandards";

const ISS_P1 = "https://auth.pingone.com/<env-id>/as";
const ISS_AIC = "https://<tenant>.forgeblocks.com/am/oauth2/alpha";
const MCP_SPEC = SPEC("MCP authorization 2025-11-25", "Model Context Protocol authorization");
const MCP_TOOLS = SPEC("MCP tools (2025-11-25)", "tools/list and tools/call");
const OIDC = SPEC("OIDC Core 1.0", "OpenID Connect sign-in");
const PKCE = RFC(7636, "PKCE");
const CODE = RFC(6749, "OAuth 2.0 Authorization Framework");
const TX = RFC(8693, "OAuth 2.0 Token Exchange");
const RI = RFC(8707, "Resource Indicators");
const ATJWT = RFC(9068, "JWT profile for OAuth 2.0 access tokens");
const BCP = RFC(9700, "OAuth 2.0 Security BCP");

const mockNote = (s) => `MOCK decoded ${s}`;

/* ---------------- UC-AIC-TX ---------------- */
export const UC_AIC_TX = [
  {
    beats: [0],
    detail: {
      form: "GET /api/aic-demo/login/start\nCookie: <app session cookie>\n\n302 Location: https://<tenant>.forgeblocks.com/am/oauth2/alpha/authorize\n  ?response_type=code&client_id=<public client id>\n  &redirect_uri=<bff callback>&scope=openid profile email <scope>\n  &state=<state>&code_challenge=<S256 challenge>&code_challenge_method=S256",
      tokens: [],
      refs: [CODE, PKCE, OIDC, BCP],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /access_token  (AIC, realm alpha)\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code&code=<authorization code>\n&redirect_uri=<bff callback>&client_id=<public client id>\n&code_verifier=<code verifier>",
      tokens: [{
        note: mockNote("subject token (user) · may_act added by the subject client's May Act script"),
        header: { alg: "RS256", typ: "JWT" },
        claims: { iss: ISS_AIC, sub: "<alice user id>", aud: "<public client id>", scope: "openid profile email <scope>", may_act: { client_id: "<agent client id>" }, exp: 1790000000 },
      }],
      refs: [CODE, PKCE, OIDC, TX],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST /access_token  (AIC, realm alpha)\nAuthorization: Basic <agent client id:secret>\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=client_credentials&scope=<scope>",
      tokens: [{
        note: mockNote("actor token (the agent client itself)"),
        header: { alg: "RS256", typ: "JWT" },
        claims: { iss: ISS_AIC, sub: "<agent client id>", aud: "<agent client id>", scope: "<scope>", exp: 1790000000 },
      }],
      refs: [RFC(6749, "Client credentials grant (section 4.4)"), ATJWT],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /access_token  (AIC, realm alpha)\nAuthorization: Basic <agent client id:secret>\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<user access token>\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=<agent access token>\n&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n&scope=<scope>",
      tokens: [
        {
          note: mockNote("input 1 · subject token (Alice)"),
          claims: { iss: ISS_AIC, sub: "<alice user id>", may_act: { client_id: "<agent client id>" }, scope: "openid profile email <scope>", exp: 1790000000 },
        },
        {
          note: mockNote("input 2 · actor token (agent client)"),
          claims: { iss: ISS_AIC, sub: "<agent client id>", scope: "<scope>", exp: 1790000000 },
        },
        {
          note: mockNote("output · delegated token (sub = Alice, act = agent)"),
          claims: { iss: ISS_AIC, sub: "<alice user id>", act: { sub: "<agent client id>" }, scope: "<scope>", exp: 1790000000 },
        },
      ],
      refs: [TX, RI, ATJWT, RFC(7662, "Token Introspection (how the claims are shown)"), DRAFT("draft-ietf-oauth-identity-chaining", "Identity chaining across trust domains")],
    },
  },
];

/* ---------------- UC-LOGIN-AIC ---------------- */
export const UC_LOGIN_AIC = [
  {
    beats: [0],
    detail: {
      form: "GET /api/auth/oauth/user/login?force=true\nCookie: <old app session cookie>\n\n(session destroyed; verifier, state and nonce stored server-side)",
      tokens: [],
      refs: [CODE, PKCE, OIDC, BCP],
    },
  },
  {
    beats: [1],
    detail: {
      form: "302 Location: https://auth.pingone.com/<env-id>/as/authorize\n  ?response_type=code&client_id=<user login app id>\n  &redirect_uri=<bff callback>&scope=openid profile email\n  &acr_values=AIC_Login&prompt=login\n  &state=<state>&nonce=<nonce>\n  &code_challenge=<S256 challenge>&code_challenge_method=S256",
      tokens: [],
      refs: [CODE, PKCE, OIDC, BCP],
    },
  },
  {
    beats: [2],
    detail: {
      form: "302 Location: https://<tenant>.forgeblocks.com/am/oauth2/alpha/authorize\n  ?response_type=code&client_id=<PingOne as AIC client>\n  &redirect_uri=https://auth.pingone.com/<env-id>/rp/callback/openid_connect\n  &scope=openid profile email&state=<state>&nonce=<nonce>\n\n(person signs in at AIC, then)\n302 Location: https://auth.pingone.com/<env-id>/rp/callback/openid_connect?code=<AIC code>&state=<state>",
      tokens: [{
        note: mockNote("AIC id_token redeemed by PingOne (stops at PingOne)"),
        header: { alg: "RS256", typ: "JWT" },
        claims: { iss: ISS_AIC, sub: "<aic user id>", aud: "<PingOne as AIC client>", email: "alice@example.com", nonce: "<nonce>", exp: 1790000000 },
      }],
      refs: [CODE, OIDC, PKCE, BCP],
    },
  },
  {
    beats: [3],
    detail: {
      form: "GET /api/auth/oauth/user/callback?code=<PingOne code>&state=<state>\n\nPOST https://auth.pingone.com/<env-id>/as/token\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code&code=<PingOne code>\n&redirect_uri=<bff callback>&code_verifier=<code verifier>\n(client authentication as the User Login app)",
      tokens: [{
        note: mockNote("PingOne id_token for the linked or created user"),
        header: { alg: "RS256", typ: "JWT" },
        claims: { iss: ISS_P1, sub: "<pingone user id>", aud: "<user login app id>", acr: "AIC_Login", nonce: "<nonce>", exp: 1790000000 },
      }],
      refs: [CODE, PKCE, OIDC],
    },
  },
  {
    beats: [4],
    detail: {
      form: "GET /resource-server\nCookie: <app session cookie>\n\n(server side) Authorization: Bearer <PingOne login access token>",
      tokens: [{
        note: mockNote("PingOne login access token used directly (no exchange)"),
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS_P1, sub: "<pingone user id>", aud: "<enduser audience>", scope: "openid profile email", exp: 1790000000 },
      }],
      refs: [RFC(6750, "Bearer token usage"), ATJWT],
    },
  },
];

/* ---------------- UC-LOGIN ---------------- */
export const UC_LOGIN = [
  {
    beats: [0],
    detail: {
      form: "GET /api/auth/oauth/user/login?force=true\nCookie: <old app session cookie>\n\n(session destroyed; prompt=login will be sent)",
      tokens: [],
      refs: [CODE, OIDC, BCP],
    },
  },
  {
    beats: [1],
    detail: {
      form: "302 Location: https://auth.pingone.com/<env-id>/as/authorize\n  ?response_type=code&client_id=<user login app id>\n  &redirect_uri=<bff callback>&scope=openid profile email\n  &prompt=login&state=<state>&nonce=<nonce>\n  &code_challenge=<S256 challenge>&code_challenge_method=S256",
      tokens: [],
      refs: [CODE, PKCE, OIDC, BCP, RFC(9126, "Pushed Authorization Requests (PAR)")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "GET /api/auth/oauth/user/callback?code=<authorization code>&state=<state>\n\nPOST https://auth.pingone.com/<env-id>/as/token\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code&code=<authorization code>\n&redirect_uri=<bff callback>&code_verifier=<code verifier>\n(client authentication as the User Login app)",
      tokens: [
        {
          note: mockNote("id_token"),
          header: { alg: "RS256", typ: "JWT" },
          claims: { iss: ISS_P1, sub: "<pingone user id>", aud: "<user login app id>", nonce: "<nonce>", exp: 1790000000 },
        },
        {
          note: mockNote("access_token (aud = BFF)"),
          header: { alg: "RS256", typ: "at+jwt" },
          claims: { iss: ISS_P1, sub: "<pingone user id>", aud: "<bff audience>", scope: "openid profile email", exp: 1790000000 },
        },
      ],
      refs: [CODE, PKCE, OIDC, ATJWT],
    },
  },
  {
    beats: [3],
    detail: {
      form: "GET /resource-server\nCookie: <app session cookie>\n\n(server side) Authorization: Bearer <login access token>",
      tokens: [{
        note: mockNote("login access token (aud = end-user audience) used directly"),
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS_P1, sub: "<pingone user id>", aud: "<enduser audience>", scope: "openid profile email", exp: 1790000000 },
      }],
      refs: [RFC(6750, "Bearer token usage"), ATJWT, RFC(7519, "JSON Web Token")],
    },
  },
];

/* ---------------- UC-MUSE1 ---------------- */
export const UC_MUSE1 = [
  {
    beats: [0],
    detail: {
      form: "POST /mcp\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_my_accounts\", \"arguments\": {} } }\n\n401 WWW-Authenticate: Bearer resource_metadata=\"<door>/.well-known/oauth-protected-resource/mcp\"",
      tokens: [],
      refs: [MCP_SPEC, MCP_TOOLS, RFC(9728, "Protected Resource Metadata"), RFC(6750, "Bearer token usage")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "GET /.well-known/oauth-protected-resource/mcp\n  -> { \"resource\": \"<door>/mcp\", \"authorization_servers\": [\"<issuer>\"] }\n\nPOST /register\nContent-Type: application/json\n\n{ \"client_name\": \"Muse\", \"redirect_uris\": [\"<loopback redirect>\"],\n  \"grant_types\": [\"authorization_code\"], \"token_endpoint_auth_method\": \"none\" }\n  -> { \"client_id\": \"<issued client id>\" }\n\nthen authorization code + PKCE in Alice's browser",
      tokens: [],
      refs: [MCP_SPEC, RFC(9728, "Protected Resource Metadata"), RFC(7591, "Dynamic Client Registration"), PKCE, RFC(8252, "OAuth 2.0 for Native Apps"), DRAFT("draft-ietf-oauth-client-id-metadata-document", "Client ID Metadata Documents (no pre-registration)")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST /as/token  (PingOne)\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<Alice access token from the PKCE login>\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=<Muse client token>\n&resource=<gateway mcp resource>\n\nthen PingOne Authorize (P1AZ) decision for scope accounts:read -> PERMIT",
      tokens: [
        { note: mockNote("input · subject token (Alice)"), claims: { iss: ISS_P1, sub: "<alice user id>", aud: "<door>", scope: "accounts:read", exp: 1790000000 } },
        { note: mockNote("output · delegated token (sub = Alice, act = Muse client)"), claims: { iss: ISS_P1, sub: "<alice user id>", act: { sub: "<muse client id>" }, aud: "<gateway mcp resource>", scope: "accounts:read", exp: 1790000000 } },
      ],
      refs: [TX, RI, SPEC("OpenID AuthZEN", "Standard authorization API between PEP and PDP"), ATJWT],
    },
  },
  {
    beats: [3],
    detail: {
      form: "(gateway -> tool)\nPOST /mcp\nAuthorization: Bearer <delegated access token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_my_accounts\", \"arguments\": {} } }",
      tokens: [{
        note: mockNote("delegated token stamped on the dispatch (aud = mcp-gw)"),
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS_P1, sub: "<alice user id>", act: { sub: "<muse client id>" }, aud: "mcp-gw", scope: "accounts:read", exp: 1790000000 },
      }],
      refs: [MCP_TOOLS, RFC(6750, "Bearer token usage"), ATJWT],
    },
  },
  {
    beats: [4],
    detail: {
      form: "200 OK\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1,\n  \"result\": { \"content\": [ { \"type\": \"text\", \"text\": \"<balance summary>\" } ] } }\n\naudit: sub=<alice> act=<muse> tool=get_my_accounts decision=PERMIT",
      tokens: [],
      refs: [MCP_TOOLS, TX],
    },
  },
];

/* ---------------- UC-MUSE2 ---------------- */
export const UC_MUSE2 = [
  {
    beats: [0],
    detail: {
      form: "POST /mcp-facade/privilege-gateway/mcp\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_my_accounts\", \"arguments\": {} } }\n\n401 WWW-Authenticate: Bearer resource_metadata=\"<facade>/.well-known/oauth-protected-resource/...\"",
      tokens: [],
      refs: [MCP_SPEC, MCP_TOOLS, RFC(9728, "Protected Resource Metadata")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /oauth/register\nContent-Type: application/json\n\n{ \"client_name\": \"Muse\", \"redirect_uris\": [\"<loopback redirect>\"],\n  \"grant_types\": [\"authorization_code\"], \"token_endpoint_auth_method\": \"none\" }\n  -> { \"client_id\": \"<durable client id>\" }\n\nauthorization code + PKCE sign-in; the same sign-in establishes the server-side gateway session",
      tokens: [{
        note: mockNote("access token issued by the demo broker to Muse"),
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "<facade broker issuer>", sub: "<alice user id>", aud: "<facade>/privilege-gateway/mcp", exp: 1790000000 },
      }],
      refs: [MCP_SPEC, RFC(7591, "Dynamic Client Registration"), PKCE, RFC(9728, "Protected Resource Metadata"), RFC(8414, "Authorization Server Metadata")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "(facade -> Agent Privilege, upstream hop only)\nPOST <privilege gateway>/mcp\nAuthorization: Bearer <operator gateway token>\n\n(the caller's bearer is dropped; ownsUpstreamAuth supplies the upstream credential)",
      tokens: [
        { note: mockNote("dropped · caller bearer (broker token)"), claims: { iss: "<facade broker issuer>", sub: "<alice user id>", exp: 1790000000 } },
        { note: mockNote("upstream · operator gateway token"), claims: { iss: ISS_P1, sub: "<operator identity>", aud: "<privilege gateway>", exp: 1790000000 } },
      ],
      refs: [RFC(6750, "Bearer token usage"), MCP_SPEC, BCP],
    },
  },
  {
    beats: [3],
    detail: {
      form: "(Agent Privilege evaluates the signed-in human's policy)\npolicy grants: [ <tool names> ]  ->  PERMIT / DENY\n\ndispatch to the registered Agentic App\nPOST <app mcp endpoint>\n{ \"jsonrpc\": \"2.0\", \"method\": \"tools/call\", \"params\": { \"name\": \"<tool>\" } }",
      tokens: [],
      refs: [MCP_TOOLS, SPEC("OpenID AuthZEN", "Standard authorization API between PEP and PDP"), SPEC("XACML 3.0", "Policy decision model")],
    },
  },
  {
    beats: [4],
    detail: {
      form: "200 OK\n{ \"jsonrpc\": \"2.0\", \"id\": 1,\n  \"result\": { \"content\": [ { \"type\": \"text\", \"text\": \"<tool result>\" } ] } }\n\n(returned through the facade to Muse)",
      tokens: [],
      refs: [MCP_TOOLS],
    },
  },
];

/* ---------------- UC-NHI1 ---------------- */
export const UC_NHI1 = [
  {
    beats: [0],
    detail: {
      form: "GET /api/control-plane/agents\nCookie: <app session cookie>\n\n200 { \"live\": { \"id\": \"demo-agent\", \"kind\": \"live\", \"status\": \"active\", \"vertical\": \"<vertical>\", \"provider\": \"<llm provider>\" },\n       \"demo\": [ ... ] }",
      tokens: [],
      refs: [SPEC("OpenID CAEP / Shared Signals", "Revoke or re-evaluate after a security event"), RFC(7644, "SCIM 2.0 Protocol (identity inventory shape)")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /api/admin/agent/demo-agent/kill-switch\nCookie: <app session cookie>\nContent-Type: application/json\n\n{ \"reason\": \"<operator reason>\", \"scope\": \"full\" }\n\nthen at PingOne: revoke the agent's tokens, set the agent user enabled=false",
      tokens: [{
        note: mockNote("agent access token being revoked"),
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS_P1, sub: "<agent user id>", client_id: "<agent app id>", scope: "agent:invoke", exp: 1790000000 },
      }],
      refs: [RFC(7009, "OAuth 2.0 Token Revocation"), SPEC("OpenID CAEP / Shared Signals", "Revoke or re-evaluate after a security event")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "PUT /environments/<env-id>/applications/<agent app id>\nAuthorization: Bearer <worker access token>\nContent-Type: application/json\n\n{ \"enabled\": false }\n\n(new token requests for every user of this client now fail until re-enabled)",
      tokens: [],
      refs: [RFC(6749, "Token endpoint error responses (section 5.2)"), RFC(7009, "OAuth 2.0 Token Revocation")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "401 Unauthorized\nContent-Type: application/json\n\n{ \"error\": \"agent_killed\", \"need_auth\": true,\n  \"revoked_at\": \"<timestamp>\", \"time_to_revoke_ms\": <number> }\n\n(calling session destroyed; the roster row flips to revoked)",
      tokens: [],
      refs: [RFC(9110, "HTTP Semantics (401 Unauthorized)"), RFC(6750, "Bearer token error responses (section 3)")],
    },
  },
];

/* ---------------- UC-OBO ---------------- */
export const UC_OBO = [
  {
    beats: [0],
    detail: {
      form: "POST /api/obo/run\nCookie: <app session cookie>\n\n(or POST /api/obo/mcp, MCP tool act_on_my_behalf, from Claude Code)\n\nThe BFF reads the person's access token from the server-side session.",
      tokens: [{
        note: mockNote("subject token (the person), held in the BFF session"),
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS_P1, sub: "<person user id>", aud: "<bff audience>", scope: "openid profile", exp: 1790000000 },
      }],
      refs: [TX, ATJWT, MCP_SPEC],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /as/token  (PingOne)\nAuthorization: Basic <AI Agent client id:secret>\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=client_credentials&scope=agent:invoke",
      tokens: [{
        note: mockNote("actor token (the AI Agent client)"),
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS_P1, sub: "<agent client id>", client_id: "<agent client id>", scope: "agent:invoke", exp: 1790000000 },
      }],
      refs: [RFC(6749, "Client credentials grant (section 4.4)"), ATJWT],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST /as/token  (PingOne, as the Token Exchanger app)\nAuthorization: Basic <Token Exchanger client id:secret>\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<person access token>\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=<agent access token>\n&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n&audience=obo-demo.ping.demo&scope=obo:invoke",
      tokens: [
        { note: mockNote("input 1 · subject token (person)"), claims: { iss: ISS_P1, sub: "<person user id>", scope: "openid profile", exp: 1790000000 } },
        { note: mockNote("input 2 · actor token (AI Agent client)"), claims: { iss: ISS_P1, sub: "<agent client id>", scope: "agent:invoke", exp: 1790000000 } },
      ],
      refs: [TX, RI, ATJWT],
    },
  },
  {
    beats: [3],
    detail: {
      form: "200 OK\n{ \"access_token\": \"<delegated access token>\",\n  \"issued_token_type\": \"urn:ietf:params:oauth:token-type:access_token\",\n  \"token_type\": \"Bearer\", \"expires_in\": <seconds> }\n\nGET /api/obo/downstream\nAuthorization: Bearer <delegated access token>",
      tokens: [{
        note: mockNote("output · delegated token (sub = person, act = agent)"),
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS_P1, sub: "<person user id>", act: { client_id: "<agent client id>" }, aud: "obo-demo.ping.demo", scope: "obo:invoke", exp: 1790000000 },
      }],
      refs: [TX, ATJWT, RFC(6750, "Bearer token usage")],
    },
  },
];

/* ---------------- UC-PRIV B / C / D ---------------- */
export const UC_PRIVB = [
  {
    beats: [0],
    detail: {
      form: "POST /aggregate-limited/mcp\nAuthorization: Bearer <access token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/list\" }",
      tokens: [{
        note: mockNote("caller access token (identity the policy is resolved for)"),
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS_P1, sub: "<user id>", aud: "<privilege gateway>", exp: 1790000000 },
      }],
      refs: [MCP_TOOLS, MCP_SPEC, RFC(6750, "Bearer token usage")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "(inside the gateway, before any byte is written)\nresolve policies for identity <user id> on app aggregate-limited\n  -> granted tools: [ <tool a>, <tool b> ]   (2 tools)",
      tokens: [],
      refs: [SPEC("OpenID AuthZEN", "Standard authorization API between PEP and PDP"), SPEC("XACML 3.0", "Policy decision model")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "(gateway -> backend)\nPOST <backend mcp endpoint>\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/list\" }\n  -> 9 tools\n\nthe gateway keeps the 2 granted and drops the other 7 from the response",
      tokens: [],
      refs: [MCP_TOOLS],
    },
  },
  {
    beats: [3],
    detail: {
      form: "200 OK\n{ \"jsonrpc\": \"2.0\", \"id\": 1,\n  \"result\": { \"tools\": [ { \"name\": \"<tool a>\" }, { \"name\": \"<tool b>\" } ] } }\n\n(no denied list in the payload: those tools are undiscoverable, not denied)",
      tokens: [],
      refs: [MCP_TOOLS],
    },
  },
];

export const UC_PRIVC = [
  {
    beats: [0],
    detail: {
      form: "policy #1 on app aggregate-limited, identity <user id>\n  grants: [ A, B ]",
      tokens: [],
      refs: [SPEC("XACML 3.0", "Policy decision model"), MCP_TOOLS],
    },
  },
  {
    beats: [1],
    detail: {
      form: "policy #2 created for the same identity (additive, not declarative)\n  grants: [ B, C ]",
      tokens: [],
      refs: [SPEC("XACML 3.0", "Policy sets and combining algorithms")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "effective grant = union of non-expired policies\n  {A, B} + {B, C} = {A, B, C}   (3 tools, not 4)",
      tokens: [],
      refs: [SPEC("XACML 3.0", "Policy combining algorithms")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "(gateway -> backend, request header)\nPOST <backend mcp endpoint>\nX-Procyon-Mcp-Cap: <per-policy contributions, duplicates allowed here>\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/list\" }",
      tokens: [],
      refs: [MCP_TOOLS],
    },
  },
  {
    beats: [4],
    detail: {
      form: "200 OK\n{ \"jsonrpc\": \"2.0\", \"id\": 1,\n  \"result\": { \"tools\": [ { \"name\": \"A\" }, { \"name\": \"B\" }, { \"name\": \"C\" } ] } }\n\n(deduplicated: the shared tool B appears once)",
      tokens: [],
      refs: [MCP_TOOLS],
    },
  },
];

export const UC_PRIVD = [
  {
    beats: [0],
    detail: {
      form: "POST /aggregate-limited/mcp\nAuthorization: Bearer <access token>\n{ \"jsonrpc\": \"2.0\", \"id\": 2, \"method\": \"tools/list\" }\n\nbaseline: 3 tools {A, B, C}; console then sets policy #1's time window to expired",
      tokens: [],
      refs: [MCP_TOOLS, RFC(6750, "Bearer token usage")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "policy #1 time window: ended <timestamp>\nunion = non-expired policies only  ->  policy #1 contributes nothing\n(no event, no notification to the client)",
      tokens: [],
      refs: [SPEC("XACML 3.0", "Environment attributes such as current time in policy conditions")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "effective grant = policy #2 only = 2 tools\n(identical to what deleting policy #1 would have left)",
      tokens: [],
      refs: [SPEC("XACML 3.0", "Policy decision model")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "200 OK\n{ \"jsonrpc\": \"2.0\", \"id\": 2,\n  \"result\": { \"tools\": [ <2 tools> ] } }\n\ncount 3 -> 2 with no reason: expired, deleted and never-covered look the same to the client",
      tokens: [],
      refs: [MCP_TOOLS, SPEC("MCP tools list_changed", "notifications/tools/list_changed (a server may signal catalog changes; this door does not surface the reason)")],
    },
  },
];
