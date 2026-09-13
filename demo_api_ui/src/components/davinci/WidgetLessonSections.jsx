// demo_api_ui/src/components/davinci/WidgetLessonSections.jsx
// The lesson on /davinci-login-guide, below "Try It Live": how the DaVinci widget
// (davinci.js) runs a PingOne DaVinci flow inside your page, and how its result
// becomes a session.
//
// Every claim is backed by one of: a widget run captured on the wire on
// 2026-09-13, the live PingOne/DaVinci configuration of this demo, Ping's widget
// and PingOne Authentication connector docs, or this repo's code. Values that
// would identify a user or a session are shown as "…".
//
// Section ids and order are shared with the Orchestration SDK lesson on
// /davinci-sdk-login; the-final-node and tokens-to-session are widget-specific.
import { CodeBlock, MermaidFigure, OnThisRun, Section, Status, TableBlock } from "../lesson";

export const WIDGET_LESSON_SECTIONS = [
  { id: "try-it-live", label: "Try It Live" },
  { id: "overview", label: "Overview" },
  { id: "how-its-wired", label: "How It's Wired" },
  { id: "pi-flow", label: "pi.flow" },
  { id: "how-it-works", label: "How It Works" },
  { id: "api-calls", label: "API Calls" },
  { id: "the-flow", label: "The Flow" },
  { id: "the-final-node", label: "The Final Node" },
  { id: "tokens-to-session", label: "Tokens to Session" },
  { id: "security", label: "Security" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "in-this-repo", label: "In This Repo" },
];

const CONTRAST = [
  [
    "Redirect (hosted pages)",
    "PingOne's hosted pages, after a 302 from /as/authorize",
    "A code on your redirect_uri",
  ],
  [
    "DaVinci widget (this page)",
    "DaVinci's own HTML, drawn by davinci.js inside your container",
    "Whatever the flow's final node returns to successCallback — here id_token and access_token",
  ],
  [
    "Orchestration SDK + pi.flow",
    "Your UI, drawn from collectors",
    "authorizeResponse.code inside the final JSON (see /davinci-sdk-login)",
  ],
];

const WIRING = [
  [
    "DaVinci application and its API key",
    "DaVinci › Applications › General",
    "Your BFF mints the widget's SDK token with it (X-SK-API-KEY). A server-side secret — never in the browser.",
  ],
  [
    "Flow policy (here a759d4c3 \"AI DEMO\", latest version)",
    "DaVinci › Applications › Flow Policy",
    "Chosen by policyId in the SDK-token request. A widget policy has no trigger: it is not a PingOne flow policy and is not assigned to any PingOne application.",
  ],
  [
    "Flow Input Schema: nonce, username",
    "Flow › Input Schema",
    "The SDK-token request's parameters become {{global.parameters.*}} inside the flow. DaVinci rejects any parameter the schema does not declare.",
  ],
  [
    "PingOne SSO connection",
    "DaVinci › Connections",
    "A worker client (client id, secret, environment, region). The flow's Sign On nodes use it to look up the user and check the password in PingOne.",
  ],
  [
    "PingOne Authentication connection",
    "DaVinci › Connections",
    "Provides Return Success Response (Widget Flows), the node that creates the PingOne session and returns OIDC tokens to the widget.",
  ],
  [
    "That node's settings",
    "Flow › final node",
    "Application id (the OIDC app the tokens are issued to), Reduced Scopes (openid profile email read write ai:agent:read — they decide the access token's audience), and an idTokenClaims entry nonce = {{global.parameters.nonce}} for the BFF's replay check.",
  ],
  [
    "OIDC application's resource grant",
    "PingOne › Applications › Resources",
    "Grants the Demo API scopes, so the access token's aud is enduser.ping.demo — the audience this BFF accepts.",
  ],
  [
    "CORS allowed origin",
    "PingOne › Applications › Configuration",
    "davinci.js calls auth.pingone.com from your page with credentials. Ping's docs put the origin on the PingOne DaVinci Connection app or any app in the environment.",
  ],
];

const BFF_CONFIG = `# demo_api_server — read by config/davinci.js
PINGONE_DAVINCI_LOGIN_COMPANY_ID=<PingOne environment id>
PINGONE_DAVINCI_LOGIN_POLICY_ID_V1=<DaVinci flow policy id>
# PINGONE_DAVINCI_API_KEY lives in the vault, never in .env or the bundle`;

const INTEGRATION = `<div class="dvWidget"></div>
<script src="https://assets.pingone.com/davinci/latest/davinci.js"></script>
<script>
  (async () => {
    // Your BFF mints the SDK token; the API key never reaches the browser.
    const cfg = await (await fetch("/api/davinci-login/sdk-token", { method: "POST" })).json();

    davinci.skRenderScreen(document.querySelector(".dvWidget"), {
      config: {
        method: "runFlow",
        apiRoot: cfg.apiRoot,            // https://auth.pingone.com/
        accessToken: cfg.accessToken,    // the DaVinci SDK token
        companyId: cfg.companyId,        // the PingOne environment id
        policyId: cfg.policyId,          // the DaVinci flow policy
        includeHttpCredentials: true,    // send auth.pingone.com cookies (interactionId)
      },
      useModal: false,
      successCallback: async (response) => {
        // The final node returned OIDC tokens. Let the server verify them.
        await fetch("/api/davinci-login/widget-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: response.id_token, accessToken: response.access_token }),
        });
      },
      errorCallback: (err) => console.error(err),
    });
  })();
</script>`;

const SDK_TOKEN_CALL = `// BFF → DaVinci: mint one SDK token for one widget run
POST https://orchestrate-api.pingone.com/v1/company/<companyId>/sdktoken
X-SK-API-KEY: <DaVinci application API key>
Content-Type: application/json

{
  "policyId": "<flow policy id>",
  "parameters": { "nonce": "…" }   // plus "username" when you pre-fill it
}

// 200
{ "access_token": "eyJ…" }         // the SDK token — not a PingOne access token`;

const PAGE_CONFIG_CALL = `// Page → BFF
POST /api/davinci-login/sdk-token

// 200 — public config only; neither the API key nor the nonce is here
{
  "accessToken": "eyJ…",
  "companyId": "<environment id>",
  "policyId": "<flow policy id>",
  "flowVersion": "v1",
  "apiRoot": "https://auth.pingone.com/"
}`;

const START_CALL = `// davinci.js → DaVinci: start the flow policy
POST https://auth.pingone.com/<envId>/davinci/policy/<policyId>/start
Authorization: Bearer <SDK token>
(no body — the parameters ride inside the SDK token)

// 200, Set-Cookie: interactionId
{
  "interactionId": "…",
  "flowId": "<flow id>",
  "connectionId": "<HTTP connection id>",
  "capabilityName": "customHTMLTemplate",
  "screen": { "name": "…", "properties": { "formFieldsList": { … }, "button": { … } } }
}`;

const SCREEN_CALL = `// davinci.js → DaVinci: submit a screen (Sign On, then Welcome)
POST https://auth.pingone.com/<envId>/davinci/connections/<connectionId>/capabilities/customHTMLTemplate
interactionid: …
interactiontoken: …

{
  "id": "…",
  "eventName": "continue",
  "interactionId": "…",
  "nextEvent": { "eventName": "continue", "eventType": "post" },
  "parameters": {
    "buttonType": "form-submit",
    "buttonValue": "SIGNON",
    "username": "…",
    "password": "…"
  }
}

// 200 — the next screen, same shape as the start response.
// After the Create Session node, the response also sets ST and ST-NO-SS.`;

const FINAL_CALL = `// davinci.js → DaVinci: the last submit (Success screen's Continue)
POST https://auth.pingone.com/<envId>/davinci/connections/<connectionId>/capabilities/customHTMLTemplate

// 200 — from the flow's final node, handed to successCallback
{
  "success": true,
  "capabilityName": "returnSuccessResponseWidget",
  "connectorId": "pingOneAuthenticationConnector",
  "id_token": "eyJ…",              // aud = the node's application id; nonce claim
  "access_token": "eyJ…",          // aud = enduser.ping.demo
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email write read ai:agent:read",
  "sessionToken": "…",             // opaque DaVinci session id
  "sessionTokenMaxAge": 2591999
}`;

const SESSION_CALL = `// Page → BFF: turn the tokens into a session
POST /api/davinci-login/widget-session
Content-Type: application/json

{ "idToken": "eyJ…", "accessToken": "eyJ…" }

// 200, Set-Cookie: connect.sid (HttpOnly)
{ "ok": true }

// 401 { "error": "nonce_missing" | "token_unverified" | "nonce_mismatch"
//                | "audience_mismatch" | "subject_mismatch" }
// 404 { "error": "user_not_found" }`;

const SESSION_CODE = `// routes/davinciLogin.js — POST /widget-session (abridged)
const expectedNonce = req.session.davinciLoginNonce;   // armed by /sdk-token
delete req.session.davinciLoginNonce;                  // one use, before any check

const [id, access] = await Promise.all([
  tokenVerificationService.verifyExchangedToken(idToken),
  tokenVerificationService.verifyExchangedToken(accessToken),
]);
// The verifier fails open and can fall back to introspection, whose claims
// carry no nonce or audience — so only a JWKS-verified signature counts.
const jwksVerified = (r) => r.verified === true && r.fallbackMethod === "jwks";
if (!jwksVerified(id) || !jwksVerified(access)) return reject("token_unverified");

if (id.claims.nonce !== expectedNonce) return reject("nonce_mismatch");
if (![].concat(id.claims.aud).includes(oauthService.config.clientId)) return reject("audience_mismatch");
if (bffAudience && ![].concat(access.claims.aud).includes(bffAudience)) return reject("audience_mismatch");
if (id.claims.sub !== access.claims.sub) return reject("subject_mismatch");

// Existing demo users only, then a fresh session (no fixation).
req.session.regenerate(() => {
  req.session.oauthTokens = { accessToken, idToken, refreshToken: null, expiresAt: access.claims.exp * 1000 };
  req.session.user = user;
  res.json({ ok: true });
});`;

export const FLOW_SOURCE = `sequenceDiagram
  autonumber
  participant Page as This page
  participant BFF as BFF
  participant API as DaVinci API
  participant W as davinci.js
  participant DV as DaVinci flow
  participant P1 as PingOne
  Page->>BFF: POST /api/davinci-login/sdk-token
  BFF->>BFF: arm a one-time nonce in the session
  BFF->>API: POST /company/companyId/sdktoken with X-SK-API-KEY
  API-->>BFF: SDK token
  BFF-->>Page: accessToken, companyId, policyId, apiRoot
  Page->>W: davinci.skRenderScreen(container, props)
  W->>DV: POST /davinci/policy/policyId/start with Bearer SDK token
  DV-->>W: first screen as JSON, Set-Cookie interactionId
  loop each screen
    W->>DV: POST /capabilities/customHTMLTemplate with eventName continue
    DV->>P1: PingOne SSO looks up the user and checks the password
    DV-->>W: next screen as JSON
  end
  DV->>P1: PingOne Authentication creates the session and issues tokens
  DV-->>W: success, id_token with nonce, access_token
  W-->>Page: successCallback(response)
  Page->>BFF: POST /api/davinci-login/widget-session
  BFF->>P1: GET /as/jwks and verify both signatures
  BFF-->>Page: ok and an HttpOnly session cookie`;

const FINAL_NODES = [
  [
    "HTTP connector — Send Success JSON Response",
    "No PingOne session and no tokens: only what you put in the JSON",
    "Nothing a server can verify on its own; you must build the session some other way",
  ],
  [
    "PingOne Authentication — Return Success Response (Widget Flows)",
    "Creates the PingOne session and returns id_token, access_token and a sessionToken",
    "Signed OIDC tokens the BFF verifies against PingOne's JWKS — what this page uses",
  ],
];

const TROUBLE = [
  ["Browser console: CORS error on auth.pingone.com", "The page's origin is not an allowed origin on any PingOne app in the environment", "Add it (Ping's docs: the PingOne DaVinci Connection app)"],
  ["431 Request Header Fields Too Large", "davinci.js forwards every cookie the origin has", "Set originCookies to the cookie names your flow needs"],
  ["/sdk-token 503 davinci_not_configured", "Missing company id, policy id, or the vaulted API key", "Set the value the error names"],
  ["\"data has additional properties\" from DaVinci", "A parameter the flow's Input Schema does not declare", "Declare it, or stop sending it"],
  ["The widget never starts the flow", "policyId names a PingOne flow policy (trigger AUTHENTICATION), which only /as/authorize runs", "Use a widget flow policy (no trigger) for the widget; keep PingOne flow policies for redirect or the SDK"],
  ["Widget shows no tokens / 401 token_unverified", "The final node is an HTTP success response, or a signature did not verify", "End the flow with Return Success Response (Widget Flows)"],
  ["401 nonce_mismatch", "The final node lost its nonce idTokenClaim, or a stale widget run", "Restart the sign-in; check the node's idTokenClaims"],
  ["401 audience_mismatch", "The node issues tokens for a different app, or without the Demo API scopes", "Point the node at the BFF's client and request the resource scopes"],
  ["404 user_not_found", "The PingOne user has no demo account", "Sign in as an existing demo user"],
];

const FILES = [
  ["demo_api_ui/src/pages/DavinciLoginGuidePage.jsx", "This page: LessonLayout, Try It Live grid, run summary modal"],
  ["demo_api_ui/src/pages/DavinciLoginWidget.jsx", "Mints config, installs the call trace, runs skRenderScreen, posts the tokens"],
  ["demo_api_ui/src/lib/davinciWidgetClient.js", "davinci.js loader, POST /sdk-token, POST /widget-session"],
  ["demo_api_ui/src/lib/davinciWidgetTrace.js", "Records the widget's calls (addresses and status only) for the Call Inspector"],
  ["demo_api_ui/src/components/davinci/CallInspector.jsx", "One card per call, live beside the widget"],
  ["demo_api_ui/src/components/davinci/WidgetRunSummary.jsx", "The What just happened modal"],
  ["demo_api_ui/src/components/davinci/WidgetLessonSections.jsx", "These sections"],
  ["demo_api_server/routes/davinciLogin.js", "POST /sdk-token (SDK token + nonce) and POST /widget-session (verification + session)"],
  ["demo_api_server/config/davinci.js", "Company id, policy ids, API key lookup"],
];

export default function WidgetLessonSections({ calls = [] }) {
  const authorizeCalls = calls.filter((c) => c.path?.endsWith("/as/authorize")).length;
  return (
    <>
      <Section id="overview" title="Overview">
        <p>
          The DaVinci widget is Ping&rsquo;s hosted <code>davinci.js</code>. You give it a container, an SDK
          token and a flow policy id; it runs the DaVinci flow and draws the flow&rsquo;s own screens inside
          your page. Your code never renders a field. When the flow finishes, the widget calls your{" "}
          <code>successCallback</code> with whatever the flow&rsquo;s final node returned.
        </p>
        <p>The three ways to put a DaVinci sign-in in front of a user:</p>
        <TableBlock headers={["Integration", "Who draws the screens", "What your code receives"]} rows={CONTRAST} />
      </Section>

      <Section id="how-its-wired" title="How It's Wired">
        <p>
          The widget does not use a PingOne application&rsquo;s authorize endpoint at all. Your BFF picks a
          DaVinci flow policy by id and mints an SDK token for it; the flow does the sign-in against PingOne
          through its connections. Everything below has to be in place.
        </p>
        <TableBlock headers={["Setting", "Where", "Why it matters"]} rows={WIRING} />
        <p>
          <strong>Which login policy runs?</strong> No PingOne sign-on policy runs. The DaVinci flow is the
          login policy: the widget runs the flow policy you name directly. That is the difference from the
          Orchestration SDK, whose PingOne application has a flow policy assignment to a PingOne flow policy
          (trigger <code>AUTHENTICATION</code>), which is what makes <code>/as/authorize</code> run a flow.
        </p>
        <CodeBlock title="BFF configuration" code={BFF_CONFIG} language="bash" />
      </Section>

      <Section id="pi-flow" title="pi.flow">
        <p>
          <code>response_mode=pi.flow</code> is a parameter of PingOne&rsquo;s{" "}
          <code>GET /as/authorize</code>. A normal authorize request answers with a <strong>302</strong> to
          PingOne&rsquo;s hosted pages; with pi.flow, PingOne answers the same request with{" "}
          <strong>200 and JSON</strong> describing the current flow step, and delivers the authorization code
          inside the final JSON. That is what lets the Orchestration SDK draw the sign-in in your own UI.
        </p>
        <p>
          The widget never calls /as/authorize, so pi.flow never appears. It reaches the same kind of JSON
          steps through DaVinci&rsquo;s own API instead: <code>/davinci/policy/&lt;policyId&gt;/start</code>{" "}
          and <code>/capabilities/&lt;name&gt;</code> posts, authenticated by the SDK token rather than an OAuth
          client. Both keep the user on your page; they differ in who draws the screens and in what comes back.
        </p>
        <p>
          To see pi.flow on the wire, run the <a href="/davinci-sdk-login">Orchestration SDK lesson</a>: its
          Step Inspector shows <code>response_mode=pi.flow</code> read off the real authorize request.
        </p>
        {calls.length > 0 && (
          <OnThisRun>
            <p>
              <Status ok={authorizeCalls === 0}>
                {authorizeCalls} of {calls.length} calls this page recorded went to /as/authorize
              </Status>
            </p>
          </OnThisRun>
        )}
      </Section>

      <Section id="how-it-works" title="How It Works">
        <ol className="lesson-list">
          <li>The page asks its BFF for widget config: <code>POST /api/davinci-login/sdk-token</code>.</li>
          <li>
            The BFF arms a one-time nonce in the session, then calls DaVinci&rsquo;s{" "}
            <code>/sdktoken</code> with its API key, passing the nonce as a flow parameter. It returns the SDK
            token and public config — never the key or the nonce.
          </li>
          <li>
            The page calls <code>davinci.skRenderScreen</code>. davinci.js posts{" "}
            <code>/davinci/policy/&lt;policyId&gt;/start</code> with the SDK token and draws the first screen.
          </li>
          <li>
            Each button posts the screen to <code>/capabilities/customHTMLTemplate</code>; DaVinci runs the flow
            to the next screen. The Sign On nodes check the password through the PingOne SSO connection.
          </li>
          <li>
            The flow creates a PingOne session and ends at Return Success Response (Widget Flows), which returns{" "}
            <code>id_token</code> (carrying the nonce) and <code>access_token</code>.
          </li>
          <li>davinci.js calls <code>successCallback</code> with that response.</li>
          <li>
            The page posts both tokens to <code>POST /api/davinci-login/widget-session</code>; the BFF verifies
            them and starts the session. The page never navigates.
          </li>
        </ol>
        <CodeBlock title="The whole client integration" code={INTEGRATION} language="html" />
      </Section>

      <Section id="api-calls" title="API Calls">
        <p>
          Every call on a real run, captured on the wire and abridged. Values that identify a user or a session
          are shown as <code>…</code>.
        </p>
        <CodeBlock title="1. Page → BFF: widget config" code={PAGE_CONFIG_CALL} language="http" />
        <CodeBlock title="2. BFF → DaVinci: mint the SDK token" code={SDK_TOKEN_CALL} language="http" />
        <CodeBlock title="3. davinci.js → DaVinci: start the flow" code={START_CALL} language="http" />
        <CodeBlock title="4. davinci.js → DaVinci: submit a screen" code={SCREEN_CALL} language="http" />
        <CodeBlock title="5. davinci.js → DaVinci: the final node answers" code={FINAL_CALL} language="http" />
        <CodeBlock title="6. Page → BFF: tokens to session" code={SESSION_CALL} language="http" />
      </Section>

      <Section id="the-flow" title="The Flow">
        <MermaidFigure source={FLOW_SOURCE} label="DaVinci widget sign-in sequence" />
      </Section>

      <Section id="the-final-node" title="The Final Node">
        <p>
          What the widget hands your <code>successCallback</code> is decided entirely by the node the flow ends
          on. The widget does not return an authorization code.
        </p>
        <TableBlock headers={["Final node", "What it does", "What your code gets"]} rows={FINAL_NODES} />
        <p>
          This flow ends with PingOne Authentication&rsquo;s Return Success Response (Widget Flows), configured
          with the application id the tokens are issued to, the scopes{" "}
          <code>openid profile email read write ai:agent:read</code>, and an <code>idTokenClaims</code> entry{" "}
          <code>nonce = {"{{global.parameters.nonce}}"}</code>. Change any of the three and every sign-in fails
          the BFF&rsquo;s checks.
        </p>
        <p>
          <strong>Why not redirect to /authorize after the widget?</strong> It was tried here and measured not to
          work. PingOne&rsquo;s session cookie (<code>ST</code>) is set during the widget&rsquo;s cross-site calls
          and never reaches a top-level <code>/as/authorize</code>, so PingOne shows its hosted sign-on page
          instead of a code. Safari and Firefox block such cookies by default. Use the tokens the node returns.
        </p>
      </Section>

      <Section id="tokens-to-session" title="Tokens to Session">
        <p>The tokens crossed the browser, so the BFF trusts nothing about them until it has checked:</p>
        <ol className="lesson-list">
          <li><strong>The nonce is armed and single-use.</strong> Read and deleted before any other check.</li>
          <li>
            <strong>Both signatures verify against PingOne&rsquo;s JWKS.</strong> Not introspection alone, and not
            a fail-open result.
          </li>
          <li><strong>The ID token&rsquo;s nonce</strong> equals the armed one.</li>
          <li><strong>The ID token&rsquo;s audience</strong> is this app&rsquo;s client id.</li>
          <li><strong>The access token&rsquo;s audience</strong> includes this API&rsquo;s resource.</li>
          <li><strong>Both tokens name the same subject.</strong></li>
          <li>
            <strong>Existing demo users only</strong>, then the session is regenerated and the tokens are stored
            server-side behind an HttpOnly cookie.
          </li>
        </ol>
        <CodeBlock title="POST /api/davinci-login/widget-session" code={SESSION_CODE} language="js" />
        <p>
          The node returns no refresh token, so the session lasts as long as the access token (3600 seconds on
          this run).
        </p>
      </Section>

      <Section id="security" title="Security">
        <ul className="lesson-list">
          <li>The DaVinci API key stays on the server; the browser only ever holds a short-lived SDK token.</li>
          <li>The nonce never reaches the browser — it travels inside the SDK token and comes back in the ID token.</li>
          <li>Tokens are verified, never trusted: JWKS signatures, nonce, both audiences and the subject.</li>
          <li>The session is regenerated before tokens are stored, and tokens live server-side only.</li>
          <li>Only existing demo users sign in; nothing is auto-created from a DaVinci login.</li>
        </ul>
      </Section>

      <Section id="troubleshooting" title="Troubleshooting">
        <TableBlock headers={["Symptom", "Cause", "Fix"]} rows={TROUBLE} />
      </Section>

      <Section id="in-this-repo" title="In This Repo">
        <TableBlock headers={["File", "Purpose"]} rows={FILES} />
      </Section>
    </>
  );
}
