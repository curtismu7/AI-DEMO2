// DemoArchWorkloadScene.jsx — the Ping "Workload Agents" slide layout drawn
// with this demo's real services. One scene, three variants (topology, ciba,
// idjag); each variant swaps the labelled arrows for the mechanism it explains.
// `st(...steps)` tags a group with the walkthrough step(s) that light it up.
import { Dots, Robot, Win } from "./demoArchPrimitives";

export const WORKLOAD_META = {
  topology: {
    subtitle: "Agent Core + Gateway + Authorization · as built in the Super AI Demo",
    aria: "Workload Agents topology of the AI demo: a customer signs in through PingOne, the BFF exchanges the user token for a delegated agent token, agents call MCP tools through PingGateway, which asks PingOne Authorize for a decision and can route to the human-in-the-loop service; SPIRE issues workload SVIDs to the agents.",
    caption: "How one agent request crosses the trust boundary: the customer signs in to PingOne, the BFF trades the user token plus the agent's identity for a single delegated token, the agent calls an MCP tool through PingGateway, and PingGateway asks PingOne Authorize before the tool runs. A transfer adds the human-in-the-loop hop; SPIRE gives each agent workload its own SVID.",
    steps: [
      ["SPIRE attests the agent workload", "spire-agent matches the container's selectors and the spiffe-helper sidecar fetches a short-lived JWT-SVID for spiffe://bxfinance.demo/agent. No secret is copied into the image."],
      ["Customer signs in", "The browser runs OIDC authorization code + PKCE (passkey) against PingOne. The code returns to the BFF; the browser only ever holds a session cookie."],
      ["Browser talks to the BFF", "demo_api_ui calls demo_api_server with the cookie. The BFF is the token custodian: no access token reaches the SPA."],
      ["RFC 8693 token exchange", "The BFF presents the user's access token as subject_token and the agent's client_credentials (or JWT-SVID) as actor_token. PingOne mints one delegated token: sub = user, act = agent, aud = mcp-gw. A2A delegation nests a second act."],
      ["Agent runs over AG-UI", "The BFF streams the run to demo_agent_service over SSE (STATE_DELTA events) and traces every hop to Jaeger via OpenTelemetry."],
      ["Agent calls an MCP tool", "tools/call goes to PingGateway as JSON-RPC over WebSocket carrying the delegated token. A missing or bad token gets 401 plus RFC 9728 resource metadata."],
      ["Gateway asks PingOne Authorize", "PingGateway introspects the token (RFC 7662) and requests a decision. Authorize answers PERMIT, DENY, STEP-UP or a HITL obligation, using directory attributes as the PIP."],
      ["Tool runs on the MCP server", "On PERMIT the call is forwarded unchanged to Banking MCP, Invest MCP or the mortgage REST server. Weather and Brave sit outside the boundary as public tools."],
      ["HITL branch for sensitive tools", "On a HITL obligation the gateway returns -32002 (WS) or 403 hitl_required (HTTP) and opens a challenge in demo_hitl_service. The tool runs only after a human approves."],
    ],
  },
  ciba: {
    subtitle: "Step-up authorization · CIBA (HITL) · as built in the Super AI Demo",
    aria: "Step-up flow of the AI demo: PingOne Authorize returns STEP_UP for a large transfer, PingGateway refuses the tool call, the BFF starts a CIBA backchannel request at PingOne, the customer approves on their own device, and the agent retries with a bound transaction receipt.",
    caption: "What happens when the policy says step up: PingGateway refuses the transfer, the BFF starts a CIBA backchannel request at PingOne for the signed-in customer, the customer approves on their own device without touching the browser, the BFF polls until approved and marks the session step-up verified for five minutes, then the agent retries the same tool call carrying a single-use receipt.",
    steps: [
      ["Agent attempts the transfer", "create_transfer goes to PingGateway over MCP with the delegated token. Nothing is different yet."],
      ["Authorize returns STEP_UP", "The amount crosses the step-up threshold (default $500) on a write tool. authorizeObligations.js classifies the obligation: stepUp wins over consent and hitl."],
      ["Gateway refuses the call", "The agent gets Not authorized · step-up required. No tool ran, no money moved."],
      ["BFF starts CIBA", "POST /api/auth/ciba/initiate: the BFF calls PingOne's backchannel endpoint with a separate CIBA client, login_hint = the session user and binding_message = the transfer. PingOne returns auth_req_id."],
      ["Customer approves out of band", "PingOne pushes to the customer's own device (MFA push or email link). Offline demos open a simulated approval tab at /ciba-approve. The browser never redirects."],
      ["BFF polls until approved", "GET /api/auth/ciba/poll: on approval the tokens land in the server-side session and stepUpVerified is set for five minutes."],
      ["Retry with a bound receipt", "A single-use transaction receipt bound to user, agent and tool is recorded as a HITL challenge; the BFF re-runs the same tool call carrying it."],
      ["Approved · the transfer runs", "Authorize now sees the step-up satisfied and returns PERMIT. PingGateway forwards the call to Banking MCP."],
    ],
  },
  idjag: {
    subtitle: "3rd-party MCP via ID-JAG · as built in the Super AI Demo",
    aria: "ID-JAG flow of the AI demo: the user signs in through PingFederate, the BFF exchanges for an Identity Assertion JWT Authorization Grant, discovers the third-party MCP server's authorization server via RFC 9728, redeems the ID-JAG there for a local access token, and calls the third-party MCP tool through PingGateway.",
    caption: "Carrying one identity across two authorization servers without a second consent screen: PingFederate issues an audience-bound ID-JAG, the third-party MCP server's own authorization server redeems it through a JWT bearer grant after checking PingFederate's JWKS, and the resulting access token is what the MCP call actually carries.",
    steps: [
      ["Sign in once through PingFederate", "The browser authenticates at PingFederate (UC40). The BFF keeps the refresh token; the agent and the MCP calls never see browser tokens."],
      ["Request an ID-JAG", "The BFF asks PingFederate for an Identity Assertion JWT Authorization Grant via RFC 8693: requested_token_type id-jag, audience = the third-party MCP authorization server, resource = the MCP server."],
      ["Discover the third-party server", "The first call to the MCP server returns 401 with RFC 9728 protected-resource metadata, which names its authorization server. No pre-shared configuration."],
      ["Redeem the assertion", "The BFF presents the ID-JAG to that authorization server as a JWT bearer grant (RFC 7523). It validates PingFederate's signature via JWKS, issuer, audience, resource, expiry and replay, then issues its own access token."],
      ["Call the tool with the local token", "The MCP call carries the third-party access token, not the ID-JAG. PingGateway validates it and asks PingOne Authorize before the tool runs."],
      ["PERMIT", "Authorize permits and the third-party MCP server executes the tool. In this demo oauth-mcp plays both roles: MCP server and embedded OAuth 2.1 authorization server with an ID-JAG grant handler."],
    ],
  },
};

export default function DemoArchWorkloadScene({ variant = "topology", st }) {
  const ciba = variant === "ciba";
  const idjag = variant === "idjag";
  const meta = WORKLOAD_META[variant];
  return (
    <svg viewBox="0 0 1800 1040" role="img" aria-label={meta.aria} className="das-svg">
      <defs>
        <marker id="das-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="das-cur" />
        </marker>
        <pattern id="das-dots" width="52" height="52" patternUnits="userSpaceOnUse">
          <rect x="20" y="20" width="10" height="10" className="das-dotfill" />
        </pattern>
      </defs>

      <rect x="960" y="0" width="840" height="1040" fill="url(#das-dots)" />

      <text x="48" y="72" className="das-title">Workload Agents</text>
      <text x="48" y="118" className="das-subtitle">{meta.subtitle}</text>

      {/* Trust boundary */}
      <rect x="490" y="140" width="1130" height="822" rx="72" className="das-boundary" />
      <rect x="490" y="200" width="38" height="232" className="das-pink-box" />
      <text transform="translate(519 316) rotate(90)" textAnchor="middle" className="das-pink-ink das-fs17">Trust boundary</text>

      {/* On-prem Docker stack */}
      <g transform="translate(600 150)">
        <rect x="0" y="0" width="34" height="46" className="das-ico" />
        <rect x="38" y="16" width="22" height="30" className="das-ico" />
        <line x1="7" y1="10" x2="27" y2="10" className="das-ico" />
        <line x1="7" y1="20" x2="27" y2="20" className="das-ico" />
        <line x1="7" y1="30" x2="27" y2="30" className="das-ico" />
      </g>
      <text x="630" y="222" textAnchor="middle" className="das-t">On-prem Docker stack</text>
      <text x="630" y="240" textAnchor="middle" className="das-s">OrbStack · docker-compose.yml</text>

      {/* PingOne Directory */}
      <text x="1120" y="130" textAnchor="middle" className="das-t">Agent identity · scopes · populations</text>
      <text x="1120" y="147" textAnchor="middle" className="das-s">pingone:bootstrap · /agent-registry</text>
      <rect x="995" y="156" width="250" height="72" rx="8" className="das-red-box" />
      <text x="1120" y="186" textAnchor="middle" className="das-on-red das-fs20">PingOne Directory</text>
      <text x="1120" y="208" textAnchor="middle" className="das-on-red das-fs12">users · groups · agent OAuth clients</text>

      {/* PingOne AS */}
      <rect x="815" y="285" width="265" height="76" rx="8" className="das-red-box" />
      <text x="947" y="315" textAnchor="middle" className="das-on-red das-fs22">PingOne / PingFederate</text>
      <text x="947" y="340" textAnchor="middle" className="das-on-red das-fs12">
        {ciba ? "(IdP · AS) · OIDC CIBA Core 1.0 · RFC 8693" : idjag ? "(IdP · AS) · PingFederate issues the ID-JAG" : "(IdP · AS) · RFC 8693 · RFC 7662 · JWKS"}
      </text>

      {/* AS -> Directory provisioning */}
      <polyline points="947,285 947,192 995,192" className="das-line" markerEnd="url(#das-arrow)" />
      <text x="936" y="236" textAnchor="end" className="das-t">Agent / user identity</text>
      <text x="936" y="252" textAnchor="end" className="das-t">provisioning</text>
      <text x="936" y="268" textAnchor="end" className="das-s">worker app · client_credentials</text>

      {/* Directory -> Authorize (PIP) — topology slide only */}
      {!ciba && !idjag && (
        <g className={st(7)}>
          <polyline points="1245,192 1302,192 1302,290" className="das-line" markerEnd="url(#das-arrow)" />
          <text x="1312" y="232" className="das-t">PIP</text>
          <text x="1312" y="250" className="das-s">user · group · agent attrs</text>
        </g>
      )}

      {/* PingOne Authorize */}
      <rect x="1170" y="290" width="265" height="72" rx="8" className="das-red-box" />
      <text x="1302" y="319" textAnchor="middle" className="das-on-red das-fs22">PingOne Authorize</text>
      <text x="1302" y="343" textAnchor="middle" className="das-on-red das-fs12">PAP / PDP · mock demo_authz_server :9001</text>

      {/* Gateway <-> Authorize */}
      <g className={ciba ? st(2, 8) : idjag ? st(5, 6) : st(7)}>
        <line x1="1294" y1="470" x2="1294" y2="362" className="das-line" markerEnd="url(#das-arrow)" />
        <line x1="1310" y1="362" x2="1310" y2="470" className="das-dot" markerEnd="url(#das-arrow)" />
        <text x="1284" y="400" textAnchor="end" className="das-t">Token validation</text>
        <text x="1284" y="416" textAnchor="end" className="das-s">introspect RFC 7662</text>
        <text x="1284" y="430" textAnchor="end" className="das-s">+ decision request</text>
        {ciba ? (
          <>
            <text x="1320" y="400" className="das-deny">Not authorized</text>
            <text x="1320" y="414" className="das-deny das-fs11">STEP_UP · amount ≥ $500</text>
            <text x="1320" y="432" className="das-ok">Approved · on retry</text>
          </>
        ) : (
          <>
            <text x="1320" y="400" className="das-ok">PERMIT</text>
            <text x="1320" y="416" className="das-deny">DENY</text>
            <text x="1320" y="432" className="das-t das-fs12">{idjag ? "aud · resource checked" : "STEP-UP · HITL"}</text>
          </>
        )}
      </g>

      {/* PingGateway (PEP) */}
      <rect x="1265" y="470" width="72" height="205" rx="8" className="das-red-box" />
      <text transform="translate(1292 572) rotate(-90)" textAnchor="middle" className="das-on-red das-fs18">PingGateway (IG) :3036</text>
      <text transform="translate(1316 572) rotate(-90)" textAnchor="middle" className="das-on-red das-fs11">PEP · alt: demo_mcp_gateway :3005</text>

      {/* Gateway -> MCP servers */}
      <text x="1545" y="462" textAnchor="middle" className="das-t">MCP servers</text>
      <g className={ciba ? st(8) : idjag ? st() : st(8)}>
        <line x1="1337" y1="545" x2="1460" y2="515" className="das-line" markerEnd="url(#das-arrow)" />
        <line x1="1337" y1="585" x2="1460" y2="605" className="das-line" markerEnd="url(#das-arrow)" />
        <line x1="1337" y1="630" x2="1460" y2="695" className="das-line" markerEnd="url(#das-arrow)" />
      </g>
      <Win x={1460} y={485} w={170} h={60} title="oauth-mcp :8080" sub="Banking · aud mcp_banking" />
      <Win x={1460} y={575} w={170} h={60} title="mcp_resource_server :8081" sub="Invest MCP · SQLite" />
      <Win x={1460} y={665} w={170} h={60} title="api_resource_server :8082" sub="mortgage REST · X-API-Key" />

      {/* 3rd party */}
      {idjag ? (
        <>
          <text x="1715" y="728" textAnchor="middle" className="das-t">3rd-party MCP</text>
          <Win x={1655} y={740} w={120} h={56} title="oauth-mcp" sub="external door · dual role" />
          <g className={st(4)}>
            <rect x="1560" y="850" width="230" height="48" rx="8" className="das-grey-box" />
            <text x="1675" y="870" textAnchor="middle" className="das-on-red das-fs14">3rd-party AS</text>
            <text x="1675" y="887" textAnchor="middle" className="das-on-red das-fs11">embedded OAuth 2.1 · ID-JAG grant</text>
            <line x1="1145" y1="760" x2="1560" y2="866" className="das-line" markerEnd="url(#das-arrow)" />
            <g transform="translate(1360 815) rotate(14.3)">
              <text x="0" y="16" textAnchor="middle" className="das-t">ID-JAG → 3rd-party AT · jwt-bearer grant (RFC 7523)</text>
              <text x="0" y="30" textAnchor="middle" className="das-s">validates PingFederate JWKS · issuer · audience · resource · replay</text>
            </g>
          </g>
          <g className={st(5, 6)}>
            <polyline points="1301,675 1301,758 1655,768" className="das-line" markerEnd="url(#das-arrow)" />
            <text x="1480" y="730" textAnchor="middle" className="das-b das-i">MCP</text>
            <text x="1480" y="745" textAnchor="middle" className="das-s">tools/call · 3rd-party AT · not the ID-JAG</text>
          </g>
        </>
      ) : (
        <>
          <text x="1715" y="728" textAnchor="middle" className="das-t">3rd-party MCP</text>
          <Win x={1655} y={740} w={120} h={56} title="mcp-weather" sub="mcp-brave · public" />
          <rect x="1640" y="850" width="150" height="48" rx="8" className="das-grey-box" />
          <text x="1715" y="870" textAnchor="middle" className="das-on-red das-fs14">PingOne Privilege</text>
          <text x="1715" y="887" textAnchor="middle" className="das-on-red das-fs11">Agent Privilege · hosted</text>
        </>
      )}

      {/* HITL service — not on the ID-JAG slide */}
      {!idjag && (
        <g className={ciba ? st(7) : st(9)}>
          <line x1="1294" y1="675" x2="1294" y2="742" className="das-line" markerEnd="url(#das-arrow)" />
          <line x1="1310" y1="742" x2="1310" y2="675" className="das-dot" markerEnd="url(#das-arrow)" />
          {ciba ? (
            <>
              <text x="1284" y="700" textAnchor="end" className="das-t">Challenge + receipt</text>
              <text x="1284" y="715" textAnchor="end" className="das-s">bound to user · agent · tool</text>
              <text x="1322" y="712" className="das-ok">single-use · replay-safe</text>
            </>
          ) : (
            <>
              <text x="1284" y="700" textAnchor="end" className="das-t">HITL obligation</text>
              <text x="1284" y="715" textAnchor="end" className="das-s">-32002 · 403 hitl_required</text>
              <text x="1322" y="712" className="das-ok">human approves · poll</text>
            </>
          )}
          <Win x={1200} y={742} w={200} h={58} title="demo_hitl_service :3009" sub="challenge · CIBA · anti-replay" />
        </g>
      )}

      {/* Enterprise agents */}
      <rect x="735" y="535" width="410" height="230" rx="28" className="das-cluster" />
      <text x="760" y="566" className="das-t">Enterprise</text>
      <text x="760" y="582" className="das-t">agents</text>
      <rect x="850" y="572" width="180" height="98" rx="12" className="das-outline" />
      <text x="862" y="600" className="das-s">spiffe-helper</text>
      <text x="862" y="614" className="das-s">SVID sidecar</text>
      <Robot x={955} y={583} />
      <text x="940" y="650" textAnchor="middle" className="das-b">demo_agent_service :3006</text>
      <text x="940" y="664" textAnchor="middle" className="das-s">AG-UI runner · SSE</text>
      <g transform="translate(1052 578)">
        <rect x="0" y="0" width="34" height="26" rx="3" className="das-ico-red" />
        <circle cx="9" cy="10" r="3" className="das-ico-red" />
        <line x1="6" y1="19" x2="12" y2="19" className="das-ico-red" />
        <line x1="17" y1="9" x2="29" y2="9" className="das-ico-red" />
        <line x1="17" y1="15" x2="29" y2="15" className="das-ico-red" />
        <path d="M22,22 l4,3 l6,-7" className="das-ico-ok" />
      </g>
      <rect x="750" y="690" width="128" height="58" rx="8" className="das-outline" />
      <text x="814" y="713" textAnchor="middle" className="das-b das-fs12">langchain_agent</text>
      <text x="814" y="729" textAnchor="middle" className="das-s">:8888 · LangGraph</text>
      <rect x="886" y="690" width="128" height="58" rx="8" className="das-outline" />
      <text x="950" y="713" textAnchor="middle" className="das-b das-fs12">openai · mastra</text>
      <text x="950" y="729" textAnchor="middle" className="das-s">pydantic · :8891–8893</text>
      <rect x="1022" y="690" width="108" height="58" rx="8" className="das-outline" />
      <text x="1076" y="713" textAnchor="middle" className="das-b das-fs12">A2A specialist</text>
      <text x="1076" y="729" textAnchor="middle" className="das-s">nested act chain</text>

      {/* LLM proxy */}
      <rect x="545" y="722" width="165" height="56" rx="6" className="das-outline" />
      <Dots x={545} y={722} />
      <text x="627" y="745" textAnchor="middle" className="das-b das-fs12">demo_llm_proxy :8090</text>
      <text x="627" y="762" textAnchor="middle" className="das-s">llama.cpp · oMLX · on-prem</text>
      <line x1="750" y1="750" x2="712" y2="750" className="das-line" markerEnd="url(#das-arrow)" />

      {/* Agents <-> AS */}
      <g className={ciba ? st(4, 6) : idjag ? st(2) : st(4)}>
        <line x1="935" y1="535" x2="935" y2="362" className="das-line" markerEnd="url(#das-arrow)" />
        <line x1="959" y1="362" x2="959" y2="535" className="das-dot" markerEnd="url(#das-arrow)" />
        {ciba ? (
          <>
            <text x="925" y="425" textAnchor="end" className="das-t">CIBA</text>
            <text x="925" y="441" textAnchor="end" className="das-s">STEP_UP → BFF initiates</text>
            <text x="925" y="455" textAnchor="end" className="das-s">POST /api/auth/ciba/initiate</text>
            <text x="969" y="425" className="das-t">TX JWT</text>
            <text x="969" y="441" className="das-s">approved → retry tool call</text>
            <text x="969" y="455" className="das-s">stepUpVerified · 5-min TTL</text>
          </>
        ) : idjag ? (
          <>
            <text x="925" y="425" textAnchor="end" className="das-t">Token exchange</text>
            <text x="925" y="441" textAnchor="end" className="das-s">SVID / agent + user JWT</text>
            <text x="925" y="455" textAnchor="end" className="das-s">requested_token_type = id-jag</text>
            <text x="969" y="425" className="das-t">ID-JAG</text>
            <text x="969" y="441" className="das-s">signed by PingFederate</text>
            <text x="969" y="455" className="das-s">aud = 3rd-party AS · resource = MCP</text>
          </>
        ) : (
          <>
            <text x="925" y="425" textAnchor="end" className="das-t">actor_token</text>
            <text x="925" y="441" textAnchor="end" className="das-s">agent client_credentials</text>
            <text x="925" y="455" textAnchor="end" className="das-s">or JWT-SVID (PingFederate)</text>
            <text x="969" y="425" className="das-t">Delegated AT</text>
            <text x="969" y="441" className="das-s">aud = mcp-gw</text>
            <text x="969" y="455" className="das-s">{"sub = user · act = {agent}"}</text>
          </>
        )}
      </g>

      {/* Agents -> Gateway */}
      <g className={ciba ? st(1, 3) : idjag ? st(3, 5) : st(6)}>
        <line x1="1145" y1="600" x2="1265" y2="585" className="das-line" markerEnd="url(#das-arrow)" />
        <line x1="1265" y1="620" x2="1145" y2="640" className="das-dot" markerEnd="url(#das-arrow)" />
        <text x="1205" y="572" textAnchor="middle" className="das-b das-i">MCP</text>
        <text x="1205" y="587" textAnchor="middle" className="das-s">tools/call · JSON-RPC · WS</text>
        {ciba ? (
          <>
            <text x="1200" y="652" textAnchor="middle" className="das-deny">Not authorized</text>
            <text x="1200" y="667" textAnchor="middle" className="das-deny das-fs11">step-up required</text>
          </>
        ) : (
          <>
            <text x="1200" y="652" textAnchor="middle" className="das-deny">Invalid token → 401</text>
            <text x="1200" y="667" textAnchor="middle" className="das-deny das-fs11">{idjag ? "RFC 9728 · discover the AS" : "RFC 9728 metadata"}</text>
          </>
        )}
      </g>

      {/* Agents <-> SPIFFE */}
      <g className={ciba ? st() : idjag ? st(2) : st(1)}>
        <line x1="935" y1="765" x2="935" y2="845" className="das-line" markerEnd="url(#das-arrow)" />
        <line x1="959" y1="845" x2="959" y2="765" className="das-dot" markerEnd="url(#das-arrow)" />
        <text x="925" y="800" textAnchor="end" className="das-s">attest · container selectors</text>
        <text x="969" y="800" className="das-t">JWT-SVID</text>
        <text x="969" y="815" className="das-s">→ actor_token on the exchange</text>
      </g>
      <rect x="790" y="845" width="315" height="76" rx="8" className="das-grey-box" />
      <text x="947" y="875" textAnchor="middle" className="das-on-red das-fs20">SPIRE 1.15.2</text>
      <text x="947" y="898" textAnchor="middle" className="das-on-red das-fs12">server · agent · trust domain spiffe://bxfinance.demo</text>

      {/* Users */}
      <g transform="translate(60 568)">
        <circle cx="38" cy="22" r="14" className="das-ico" />
        <path d="M12,70 q26,-34 52,0" className="das-ico" />
        <circle cx="14" cy="30" r="10" className="das-ico" />
        <path d="M-4,66 q18,-26 32,-6" className="das-ico" />
        <circle cx="62" cy="30" r="10" className="das-ico" />
        <path d="M80,66 q-18,-26 -32,-6" className="das-ico" />
      </g>
      <text x="98" y="660" textAnchor="middle" className="das-t">Customer · Admin</text>
      <text x="98" y="676" textAnchor="middle" className="das-s">{ciba ? "own device · MFA push" : "browser · passkey"}</text>

      {/* User <-> AS */}
      {ciba ? (
        <g className={st(5)}>
          <line x1="815" y1="312" x2="140" y2="578" className="das-dot" markerEnd="url(#das-arrow)" />
          <g transform="translate(320 507) rotate(-21.5)">
            <text x="0" y="-24" textAnchor="middle" className="das-ok">Approved</text>
            <text x="0" y="-8" textAnchor="middle" className="das-t">CIBA out-of-band approval · MFA push · /ciba-approve</text>
          </g>
        </g>
      ) : (
        <g className={st(idjag ? 1 : 2)}>
          <line x1="140" y1="578" x2="815" y2="312" className="das-line" markerEnd="url(#das-arrow)" />
          <text x="190" y="470" className="das-t">User AuthN</text>
          <text x="190" y="486" className="das-s">{idjag ? "PingFederate login · UC40" : "OIDC auth code + PKCE · passkey"}</text>
        </g>
      )}

      {/* User -> UI -> BFF */}
      <g className={ciba ? st() : st(idjag ? 1 : 3)}>
        <line x1="145" y1="622" x2="200" y2="622" className="das-line" markerEnd="url(#das-arrow)" />
        <Win x={200} y={592} w={140} h={62} title="demo_api_ui :4000" sub="React SPA · cookie only" />
        <line x1="340" y1="622" x2="380" y2="622" className="das-line" markerEnd="url(#das-arrow)" />
      </g>
      <rect x="380" y="520" width="75" height="205" rx="8" className="das-red-box" />
      <text transform="translate(408 622) rotate(-90)" textAnchor="middle" className="das-on-red das-fs18">demo_api_server :3001</text>
      <text transform="translate(432 622) rotate(-90)" textAnchor="middle" className="das-on-red das-fs11">BFF · token custodian · session</text>

      {/* BFF -> AS */}
      <g className={ciba ? st(4, 6) : idjag ? st(2) : st(4)}>
        <line x1="417" y1="520" x2="815" y2="338" className="das-line" markerEnd="url(#das-arrow)" />
        {ciba ? (
          <>
            <text x="540" y="482" className="das-b">CIBA backchannel request</text>
            <text x="540" y="498" className="das-s">separate CIBA client · login_hint = session user</text>
            <text x="540" y="512" className="das-s">binding_message = the transfer · poll every interval</text>
          </>
        ) : idjag ? (
          <>
            <text x="540" y="482" className="das-b">RFC 8693 → ID-JAG</text>
            <text x="540" y="498" className="das-s">subject = user · BFF holds the refresh token</text>
            <text x="540" y="512" className="das-s">audience = 3rd-party AS · resource = 3rd-party MCP</text>
          </>
        ) : (
          <>
            <text x="540" y="482" className="das-b">RFC 8693 token exchange</text>
            <text x="540" y="498" className="das-s">subject_token = user AT · actor_token = agent</text>
            <text x="540" y="512" className="das-s">{"→ delegated AT · A2A nests act:{specialist, act:{agent}}"}</text>
          </>
        )}
      </g>

      {/* BFF <-> Agents */}
      <g className={ciba ? st(7) : idjag ? st(3, 4) : st(5)}>
        <line x1="455" y1="622" x2="735" y2="622" className="das-line" markerEnd="url(#das-arrow)" markerStart="url(#das-arrow)" />
        <text x="595" y="606" textAnchor="middle" className="das-t">AG-UI · SSE · STATE_DELTA</text>
        <text x="595" y="644" textAnchor="middle" className="das-s">OTel traces → Jaeger · Grafana</text>
      </g>

      {/* Legend */}
      <g transform="translate(60 930)">
        <line x1="0" y1="0" x2="48" y2="0" className="das-line" markerEnd="url(#das-arrow)" />
        <text x="58" y="4" className="das-s">primary call path</text>
        <line x1="0" y1="26" x2="48" y2="26" className="das-dot" markerEnd="url(#das-arrow)" />
        <text x="58" y="30" className="das-s">token · decision · response</text>
        <text x="0" y="56" className="das-deny">red text</text>
        <text x="58" y="56" className="das-s">deny / failure path</text>
      </g>
      <text x="1760" y="1010" textAnchor="end" className="das-s">AI-DEMO2 · local Docker</text>
    </svg>
  );
}
