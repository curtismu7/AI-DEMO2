// The lesson on /davinci-sdk-login, below "Try It Live": how the Ping
// Orchestration SDK (@forgerock/davinci-client) runs a PingOne DaVinci flow,
// with copyable code.
//
// Written for developers integrating the SDK. Every claim is backed by one of:
// the SDK source (davinci-client 2.1.1 in this repo), the live PingOne
// configuration of this demo's application, or runs captured on the wire on
// 2026-09-13 (the "Sign On" form, the TROUBLE branch, the "Enter Username" form,
// and a SIGNON submit that completed). Values that would identify a user or a
// session are shown as "…".
//
// Section ids and order are shared with the DaVinci widget lesson so the two
// read as one course; the Collectors section is specific to the SDK.
import { CodeBlock, MermaidFigure, OnThisRun, Section, Status, TableBlock } from "../lesson";
import { requestShape } from "./StepInspector";

export const SDK_LESSON_SECTIONS = [
  { id: "try-it-live", label: "Try It Live" },
  { id: "overview", label: "Overview" },
  { id: "how-its-wired", label: "How It's Wired" },
  { id: "pi-flow", label: "pi.flow" },
  { id: "how-it-works", label: "How It Works" },
  { id: "api-calls", label: "API Calls" },
  { id: "the-flow", label: "The Flow" },
  { id: "collectors", label: "Collectors" },
  { id: "security", label: "Security" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "in-this-repo", label: "In This Repo" },
];

const CONTRAST = [
  [
    "Redirect (hosted pages)",
    "The browser is sent to PingOne's hosted sign-on pages, then redirected back to redirect_uri?code=…",
    "A code on your callback route",
  ],
  // Deliberately NOT "a sessionToken, then a second /authorize hop": that
  // pattern was measured not to work. PingOne's /authorize does not read a DV-ST
  // cookie, and what the widget returns depends on the flow's final node.
  [
    "DaVinci widget",
    "DaVinci draws its own screens inside your page; davinci.skRenderScreen fires a JavaScript successCallback with whatever the flow's final node returns",
    "A DaVinci session token or OIDC tokens (from a PingOne Authentication widget-success node), not an authorization code; your code turns it into a session",
  ],
  [
    "Orchestration SDK + pi.flow (this page)",
    "Every step is JSON returned to the SDK's own fetch; the page never navigates",
    "Collectors on each step, then authorizeResponse.code inside the final response",
  ],
];

const CHECKLIST = [
  [
    "OIDC application",
    "PingOne › Applications",
    "davinci() authorizes as this client_id. Response type code, grant type authorization_code.",
  ],
  [
    "Token auth None + PKCE S256 required",
    "Application › Configuration",
    "A browser cannot keep a secret. The BFF redeems the code as a public client and proves possession with the PKCE verifier.",
  ],
  [
    "Flow policy assignment",
    "Application › Policies",
    "Makes /as/authorize run the assigned DaVinci flow policy instead of PingOne's built-in sign-on policy. This is the whole connection between the app and DaVinci.",
  ],
  [
    "The flow policy itself",
    "DaVinci › Applications › Flow Policies",
    "Must be a PingOne flow policy (trigger AUTHENTICATION), a choice made when the policy is created. The flow needs PingOne Flow enabled and must end in PingOne Authentication success/failure nodes. Without the trigger, /as/authorize returns a bare 500.",
  ],
  [
    "Redirect URI",
    "Application › Configuration",
    "Validated on every authorize and bound to the code, even though pi.flow never navigates to it.",
  ],
  [
    "CORS allowed origins",
    "Application › Configuration",
    "The browser calls PingOne directly with credentials. A missing origin is an opaque CORS error with nothing in any server log.",
  ],
  [
    "Resource grant",
    "Application › Resources",
    "Grants the resource scopes this page requests, and those scopes decide the access token's audience.",
  ],
  [
    "Signoff URL",
    "Application › Configuration",
    "A registered post_logout_redirect_uri lets /as/signoff return here when switching users.",
  ],
];

const SNIPPET_ASSIGN = `# Attach a DaVinci flow policy to the PingOne application (Management API)
POST https://api.pingone.com/v1/environments/{envId}/applications/{appId}/flowPolicyAssignments
Authorization: Bearer <worker token>
Content-Type: application/json

{ "flowPolicy": { "id": "<flow policy id>" }, "priority": 1 }`;

const SNIPPET_CORS = `# Part of the application object. PUT replaces the whole application,
# so read it first and send it back with this merged in.
"corsSettings": {
  "behavior": "ALLOW_SPECIFIC_ORIGINS",
  "origins": ["https://local.ping-devops.com:4000"]
}`;

const PIFLOW_TABLE = [
  [
    "Default (no response_mode)",
    "Redirects the browser to PingOne's hosted pages; the code comes back later on a redirect to redirect_uri",
    "Your page is gone while the user signs in",
  ],
  [
    "response_mode=pi.flow",
    "200 with a JSON description of the current flow step: interactionId, the form's fields, and _links.next",
    "Your page stays put and draws the form itself",
  ],
];

const SNIPPET_START = `import { davinci } from "@forgerock/davinci-client";

const client = await davinci({
  config: {
    clientId,                    // the PingOne OIDC application
    redirectUri,                 // registered + validated; pi.flow never loads it
    scope: "openid profile email", // plus your API's resource scopes
    responseType: "code",
    serverConfig: { wellknown }, // .../as/.well-known/openid-configuration
  },
});

// davinci-client adds response_mode=pi.flow, PKCE and state itself.
// Never pass response_mode here: start() applies \`query\` with
// URLSearchParams.set() AFTER building the URL, so it would REPLACE pi.flow.
let node = await client.start({ query: { nonce } });`;

const SNIPPET_LOOP = `// Each pass waits for the user in a real UI; this is the shape of it.
while (node.status === "continue" || node.status === "error") {
  if (node.status === "error") showMessage(client.getError()?.message);

  for (const c of client.getCollectors()) {
    if (c.category === "SingleValueCollector" || c.category === "ValidatedSingleValueCollector") {
      const err = client.update(c)(valueFor(c)); // the ONLY write path
      if (err) showFieldError(c, err.error.message);
    }
  }

  node = branch
    ? await client.flow({ action: branch.output.key })() // FlowCollector
    : await client.next();                               // SubmitCollector
}

if (node.status === "success") {
  const { code } = client.getClient().authorization; // send to your server
} else if (node.status === "failure") {
  // terminal: offer to call start() again
}`;

const API_START = `POST /api/davinci-sdk-login/start

200 OK
{
  "clientId": "<PingOne application id>",
  "redirectUri": "https://local.ping-devops.com:4000/davinci-sdk-login",
  "wellknown": "https://auth.pingone.com/<envId>/as/.well-known/openid-configuration",
  "scope": "openid profile email …",
  "nonce": "…"
}

503 Service Unavailable
{
  "error": "davinci_sdk_not_configured",
  "message": "…",
  "missing": ["PINGONE_DAVINCI_LOGIN_APP_ID (.env)"]
}`;

const API_AUTHORIZE = `GET https://auth.pingone.com/<envId>/as/authorize
    ?client_id=<clientId>
    &response_type=code
    &scope=openid profile email …
    &redirect_uri=https://local.ping-devops.com:4000/davinci-sdk-login
    &code_challenge=…
    &code_challenge_method=S256
    &state=…
    &nonce=…
    &response_mode=pi.flow
credentials: include`;

const API_FORM_1 = `200 OK
Content-Type: application/json;charset=utf-8

{
  "eventName": "continue",
  "isResponseCompatibleWithMobileAndWebSdks": "…",
  "id": "…",
  "interactionId": "…",
  "companyId": "<envId>",
  "flowId": "…",
  "connectionId": "…",
  "capabilityName": "customHTMLTemplate",
  "form": {
    "name": "Sign On",
    "components": {
      "fields": [
        { "type": "TEXT", "key": "username", "label": "Username" },
        { "type": "PASSWORD", "key": "password", "label": "Password" },
        { "type": "SUBMIT_BUTTON", "key": "SIGNON", "label": "Sign On" },
        { "type": "FLOW_BUTTON", "key": "REGISTER", "label": "No account? Register now!" },
        { "type": "FLOW_BUTTON", "key": "TROUBLE", "label": "Having trouble signing on?" }
      ]
    }
  },
  "_links": {
    "next": { "href": "https://auth.pingone.com/<envId>/davinci/connections/<connectionId>/capabilities/customHTMLTemplate" },
    "self": { "href": "…" }
  },
  "startUiSubFlow": "…",
  "resetCookie": "…"
}`;

const API_FLOW_POST = `POST https://auth.pingone.com/<envId>/davinci/connections/<connectionId>/capabilities/customHTMLTemplate
Content-Type: application/json
interactionId: …
interactionToken: …
credentials: include

{
  "id": "…",
  "eventName": "continue",
  "interactionId": "…",
  "parameters": {
    "eventType": "action",
    "data": { "actionKey": "TROUBLE" }
  }
}`;

const API_FORM_2 = `200 OK
Content-Type: application/json; charset=utf-8

{
  "eventName": "continue",
  "isResponseCompatibleWithMobileAndWebSdks": "…",
  "id": "…",
  "interactionId": "…",
  "interactionToken": "…",
  "companyId": "<envId>",
  "flowId": "…",
  "connectionId": "…",
  "skProxyApiEnvironmentId": "…",
  "capabilityName": "customHTMLTemplate",
  "form": {
    "name": "Enter Username",
    "components": {
      "fields": [
        { "type": "TEXT", "key": "username", "label": "Username" },
        { "type": "SUBMIT_BUTTON", "key": "CONTINUE", "label": "Continue" },
        { "type": "FLOW_BUTTON", "key": "CANCEL", "label": "Back" }
      ]
    }
  },
  "_links": { "next": { "href": "…" }, "self": { "href": "…" } }
}`;

const API_SUBMIT_POST = `POST <_links.next.href from the Sign On response>
Content-Type: application/json
interactionId: …
interactionToken: …
credentials: include

{
  "id": "…",
  "eventName": "continue",
  "interactionId": "…",
  "parameters": {
    "eventType": "submit",
    "data": {
      "actionKey": "SIGNON",
      "formData": { "username": "…", "password": "…" }
    }
  }
}`;

const API_COMPLETED = `200 OK

{
  "status": "COMPLETED",
  "capabilityName": "returnSuccessResponseRedirect",
  "authorizeResponse": { "code": "…", "state": "…" },
  "interactionId": "…"
}`;

const API_CALLBACK = `POST /api/davinci-sdk-login/callback
Content-Type: application/json

{ "code": "…", "codeVerifier": "…" }

200 OK   { "ok": true, "username": "…" }        + HttpOnly session cookie
400      { "error": "invalid_request", "message": "…" }
401      { "error": "nonce_missing" | "nonce_mismatch", "message": "…" }
404      { "error": "user_not_found", "message": "…" }`;

export const FLOW_SOURCE = `sequenceDiagram
  autonumber
  participant Page as This page
  participant SDK as davinci-client
  participant P1 as PingOne
  participant DV as DaVinci flow
  participant BFF as BFF
  Page->>BFF: POST /api/davinci-sdk-login/start
  BFF-->>Page: clientId, redirectUri, wellknown, scope, nonce
  Page->>SDK: davinci(config), then start(query nonce)
  SDK->>P1: GET /as/authorize with response_mode=pi.flow
  P1->>DV: run the flow policy assigned to the app
  Note over DV: runs nodes until the first screen
  DV-->>SDK: 200 JSON, form Sign On + _links.next
  SDK-->>Page: node continue, collectors
  alt FlowCollector Having trouble signing on?
    Page->>SDK: flow(action TROUBLE)()
    SDK->>DV: POST _links.next.href, eventType action
    Note over DV: runs nodes until the next screen
    DV-->>SDK: 200 JSON, form Enter Username
    SDK-->>Page: node continue, new collectors
  else SubmitCollector Sign On
    Page->>SDK: update(collector)(value), then next()
    SDK->>DV: POST _links.next.href, eventType submit + formData
    DV-->>SDK: 200 JSON, status COMPLETED + authorizeResponse.code
    SDK-->>Page: node success, getClient().authorization.code
    Page->>BFF: POST /api/davinci-sdk-login/callback, code + PKCE verifier
    BFF->>P1: token endpoint, client_id + code_verifier
    BFF-->>Page: HttpOnly session cookie + username
  end`;

const CATEGORIES = [
  ["SingleValueCollector", "TextCollector, PasswordCollector", "One string. Render an input; write with update(c)(value)."],
  [
    "ValidatedSingleValueCollector",
    "text fields with validation rules (type is still TextCollector)",
    "One string plus rules in input.validation; client.validate(c) returns a checker for them.",
  ],
  ["MultiValueCollector", "checkbox lists, combo boxes", "An array of strings chosen from output.options."],
  ["ObjectValueCollector", "phone number (country code + number)", "An object value."],
  [
    "ActionCollector",
    "SubmitCollector, FlowCollector, IdpCollector",
    "No value; a button. next(), flow({ action })(), or an external IdP.",
  ],
  ["NoValueCollector", "read-only and rich text", "Display only; nothing is sent."],
  [
    "SingleValueAutoCollector, ObjectValueAutoCollector",
    "PingOne Protect signals, FIDO2",
    "No UI. The value is produced in code and sent with the step.",
  ],
  ["UnknownCollector", "any field the SDK does not recognise", "Render a visible fallback rather than dropping it."],
];

const FIELD_MAP = [
  ["TEXT", "TextCollector", "SingleValueCollector", "An input; update(c)(value) on change; sent as formData.<key>"],
  ["PASSWORD", "PasswordCollector", "SingleValueCollector", "A password input; the same write path; sent as formData.<key>"],
  ["SUBMIT_BUTTON", "SubmitCollector", "ActionCollector", "A button that calls next()"],
  ["FLOW_BUTTON", "FlowCollector", "ActionCollector", "A button that calls flow({ action: c.output.key })()"],
];

const COLLECTOR_OBJECTS = `// client.getCollectors() on the Sign On form (two of the five shown).
[
  {
    "category": "SingleValueCollector",
    "error": null,
    "type": "TextCollector",
    "id": "username-0",
    "name": "username",
    "input": { "key": "username", "value": "", "type": "TEXT" },
    "output": { "key": "username", "label": "Username", "type": "TEXT" }
  },
  {
    "category": "ActionCollector",
    "error": null,
    "type": "FlowCollector",
    "id": "TROUBLE-4",
    "name": "TROUBLE",
    "output": { "key": "TROUBLE", "label": "Having trouble signing on?", "type": "FLOW_BUTTON" }
  }
]`;

const CODE_RENDER = `// Render whatever the current node holds. getCollectors() is the supported
// accessor, and an error node still carries its collectors.
function Collectors({ client, onNode }) {
  return client.getCollectors().map((collector) => {
    switch (collector.type) {
      case "TextCollector":
        return <TextField key={collector.id} client={client} collector={collector} />;
      case "PasswordCollector":
      case "ValidatedPasswordCollector":
        return <TextField key={collector.id} client={client} collector={collector} type="password" />;
      case "SubmitCollector":
        return <SubmitButton key={collector.id} client={client} collector={collector} onNode={onNode} />;
      case "FlowCollector":
        return <FlowButton key={collector.id} client={client} collector={collector} onNode={onNode} />;
      default:
        // Never render nothing: a missing field looks like a broken flow.
        return <p key={collector.id}>Unsupported collector: {collector.type}</p>;
    }
  });
}`;

const CODE_TEXT = `import { useState } from "react";

// TextCollector and PasswordCollector: one string each.
function TextField({ client, collector, type = "text" }) {
  const [value, setValue] = useState(collector.input.value ?? "");
  const [error, setError] = useState(null);
  const write = client.update(collector); // the ONLY way to set a value

  return (
    <label>
      {collector.output.label}
      <input
        type={type}
        name={collector.name}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          const result = write(e.target.value); // null, or { error: { message } }
          setError(result?.error?.message ?? null);
        }}
      />
      {error && <span role="alert">{error}</span>}
    </label>
  );
}`;

const CODE_SUBMIT = `// SubmitCollector: no value of its own. The fields already wrote their values
// into the SDK as the user typed, so submitting is just next(): it POSTs
// eventType "submit", this button's actionKey and the formData.
function SubmitButton({ client, collector, onNode }) {
  return (
    <button type="button" onClick={async () => onNode(await client.next())}>
      {collector.output.label}
    </button>
  );
}`;

const CODE_FLOW = `// FlowCollector: a branch such as "Having trouble signing on?". It does NOT
// submit the form. flow() returns a function; calling it POSTs eventType
// "action" with actionKey set to the button's key, and no formData.
function FlowButton({ client, collector, onNode }) {
  return (
    <button
      type="button"
      onClick={async () => onNode(await client.flow({ action: collector.output.key })())}
    >
      {collector.output.label}
    </button>
  );
}`;

const CODE_NODE = `// start(), next() and flow() all resolve to the next node.
// Its status says what to render.
async function onNode(node) {
  switch (node.status) {
    case "continue": // DaVinci stopped at its next screen
      setCollectors(client.getCollectors());
      break;
    case "error": // step rejected; the same collectors come back
      setCollectors(client.getCollectors());
      setMessage(client.getError()?.message);
      break;
    case "success": { // COMPLETED: the code arrived in the response body
      const { code } = client.getClient().authorization;
      await sendCodeToYourServer(code);
      break;
    }
    case "failure": // terminal
      setMessage(client.getError()?.message); // offer client.start() again
      break;
  }
}`;

const CODE_VALIDATE = `// A text field with rules arrives as type "TextCollector" but category
// "ValidatedSingleValueCollector". validate() returns a checker for its rules.
if (collector.category === "ValidatedSingleValueCollector") {
  const check = client.validate(collector);
  const messages = check(value); // string[]; empty when every rule passes
}`;

const SECURITY = [
  [
    "No secret in the browser",
    "The PingOne app is a public client (token auth None) with PKCE S256 required. The code is useless without the verifier the SDK generated.",
  ],
  [
    "The verifier travels once",
    "The SDK leaves it in sessionStorage under FR-SDK-authflow-<clientId>. The page reads it, deletes it, and sends it with the code.",
  ],
  [
    "Nonce replay check",
    "/start stores a one-time nonce in the server session. /callback rejects an ID token whose nonce does not match, and the stored nonce is removed either way.",
  ],
  [
    "Tokens stay on the server",
    "The BFF exchanges the code, regenerates the session (no fixation), keeps the tokens server-side and answers with an HttpOnly cookie. Script on the page cannot read them.",
  ],
  [
    "Existing users only",
    "The BFF signs in a user it already knows; an unknown username is a 404, never a new account.",
  ],
  [
    "CORS is an allowlist",
    "Only the origins registered on the PingOne app can call it from a browser with credentials.",
  ],
  [
    "This lesson shows no secrets",
    "The Step Inspector's trace masks typed values before they are stored, and shows only parameter names from the authorize URL.",
  ],
];

const TROUBLE = [
  [
    "/as/authorize answers 500 UNEXPECTED_ERROR",
    "The app's flow policy has no AUTHENTICATION trigger: it is not a PingOne flow policy",
    "In DaVinci, create the policy as a PingOne Flow Policy (fixed at creation) over a flow with PingOne Flow enabled, and assign that",
  ],
  [
    "start() gives status failure, code unknown, an empty message and no collectors",
    "No DaVinci flow policy is assigned, so PingOne answered with its own native sign-on JSON, which davinci-client cannot read",
    "Add a flow policy assignment to the application",
  ],
  [
    "A CORS error in the browser console, nothing in any server log",
    "The page's origin is not in the application's CORS settings",
    "Add the scheme, host and port; read and merge before the PUT",
  ],
  [
    "userSessionMismatch",
    "The browser already has a PingOne session for a different user",
    "End the PingOne session at end_session_endpoint, then sign in. Don't force prompt=login",
  ],
  [
    "Signed in, but this app's API answers 401",
    "Only openid profile email were requested, so the access token is for PingOne's own API",
    "Grant the app its resource scopes and request them",
  ],
  [
    "A field arrives empty at DaVinci although the input shows text",
    "The code assigned collector.input.value; the SDK store is frozen and ignores it",
    "Write with client.update(collector)(value) and check what it returns",
  ],
  [
    "The page says Not configured",
    "/start answered 503 davinci_sdk_not_configured and named the missing key",
    "Set the key it names, e.g. PINGONE_DAVINCI_LOGIN_APP_ID",
  ],
  [
    "/callback 401 nonce_missing or nonce_mismatch",
    "The session was lost between /start and /callback, or the ID token is from another run",
    "Start the sign-in again",
  ],
  [
    "/callback 404 user_not_found",
    "The BFF has no demo user with the username PingOne returned",
    "Sign in as an existing demo user",
  ],
];

const REPO = [
  ["demo_api_ui/src/pages/DavinciSdkLoginPage.jsx", "The node loop, the live sign-in, and the steps the inspector shows"],
  ["demo_api_ui/src/components/davinci/CollectorField.jsx", "Renders one collector; the only place that knows collector shapes"],
  ["demo_api_ui/src/components/davinci/StepInspector.jsx", "One card per SDK call: code, request, response, collectors"],
  ["demo_api_ui/src/components/davinci/SdkLessonSections.jsx", "This lesson"],
  ["demo_api_ui/src/components/davinci/SdkWalkthrough.jsx", "The post-sign-in run summary"],
  ["demo_api_ui/src/lib/davinciSdkClient.js", "davinci() with the logger, requestMiddleware and subscribe hooks; PKCE verifier; callback; sign-out"],
  ["demo_api_ui/src/components/lesson/", "The lesson shell shared with the DaVinci widget guide"],
  ["demo_api_server/routes/davinciSdkLogin.js", "POST /start (config + nonce) and POST /callback (exchange, nonce check, session)"],
];

export default function SdkLessonSections({ config = {}, steps = [] }) {
  const authorize = requestShape(steps.find((s) => s.kind === "start")?.request);

  return (
    <>
      <Section id="overview" title="Overview">
        <p>
          The Ping Orchestration SDK for JavaScript, <code>@forgerock/davinci-client</code>, runs a
          PingOne DaVinci flow from your own page. PingOne hands the SDK each step of the flow as
          JSON, the SDK turns the step&rsquo;s form into <strong>collectors</strong>, and your page
          draws them and sends them back. The browser never leaves your page, and on success the
          flow&rsquo;s authorization code arrives in a response body.
        </p>
        <p>There are three ways to put a DaVinci sign-in in front of a user:</p>
        <TableBlock headers={["Integration", "How the result comes back", "What your code receives"]} rows={CONTRAST} />
        <p>
          This page uses the third. The BFF, not the browser, turns the code into tokens and a
          session.
        </p>
      </Section>

      <Section id="how-its-wired" title="How It's Wired">
        <p>
          The SDK never talks to &ldquo;DaVinci&rdquo; directly. It speaks OIDC to a PingOne
          application, and a <strong>flow policy assignment</strong> on that application is what
          makes <code>/as/authorize</code> run a DaVinci flow instead of PingOne&rsquo;s built-in
          sign-on. Everything below has to be in place, or the SDK fails before a single collector
          arrives.
        </p>
        <TableBlock headers={["Setting", "Where", "Why it matters"]} rows={CHECKLIST} />
        <CodeBlock title="Attach the flow policy" code={SNIPPET_ASSIGN} language="http" />
        <CodeBlock title="Allow the page's origin" code={SNIPPET_CORS} language="json" />
        {config.clientId && (
          <p>
            This page received: client_id <code>{config.clientId}</code>, redirect_uri{" "}
            <code>{config.redirectUri}</code>, scope <code>{config.scope}</code>. None of it is
            secret; the BFF hands the browser public configuration only.
          </p>
        )}
      </Section>

      <Section id="pi-flow" title="pi.flow">
        <p>
          <code>response_mode=pi.flow</code> is what makes a custom UI possible. It changes what
          PingOne does with the same <code>GET /as/authorize</code>:
        </p>
        <TableBlock headers={["Request", "PingOne answers", "Result"]} rows={PIFLOW_TABLE} />
        <p>
          The JSON carries only the form&rsquo;s fields with their types, never the screen&rsquo;s
          HTML. That is why a flow built from DaVinci HTML screens can still be drawn by your page.
        </p>
        <p>
          You don&rsquo;t set it: davinci-client adds <code>response_mode=pi.flow</code> when it
          builds the authorize URL (<code>dist/src/lib/davinci.api.js</code> in 2.1.1), together
          with PKCE (<code>code_challenge</code>, S256) and <code>state</code>.
        </p>
        <CodeBlock title="Start a flow" code={SNIPPET_START} language="js" />
        {authorize && (
          <OnThisRun>
            <p>
              <Status ok={authorize.responseMode === "pi.flow"}>
                response_mode={authorize.responseMode || "not present"}
              </Status>{" "}
              on the authorize request this page just made, with parameters{" "}
              <code>{authorize.paramNames.join(", ")}</code>.
            </p>
          </OnThisRun>
        )}
      </Section>

      <Section id="how-it-works" title="How It Works">
        <ol>
          <li>
            The page asks the BFF for configuration: <code>POST /api/davinci-sdk-login/start</code>{" "}
            returns the public client settings and arms a one-time nonce in the server session.
          </li>
          <li>
            <code>davinci({"{ config }"})</code> reads the discovery document, and{" "}
            <code>client.start()</code> calls <code>/as/authorize</code> with{" "}
            <code>response_mode=pi.flow</code>. PingOne runs the flow policy assigned to the
            application.
          </li>
          <li>
            DaVinci runs the flow&rsquo;s nodes on its side (connectors, functions, conditions)
            until it reaches one that needs the user. Here that is a Custom HTML Template screen,{" "}
            <code>capabilityName: customHTMLTemplate</code>. It stops and answers with that
            screen&rsquo;s form as JSON.
          </li>
          <li>
            The SDK turns each form field into a collector. The page calls{" "}
            <code>client.getCollectors()</code> and draws them.
          </li>
          <li>
            As the user types, each input writes its value into the SDK with{" "}
            <code>client.update(collector)(value)</code>.
          </li>
          <li>
            A <strong>submit</strong> button calls <code>client.next()</code>; a <strong>flow</strong>{" "}
            button calls <code>client.flow({"{ action }"})()</code>. Either way the SDK POSTs the
            step to <code>_links.next.href</code> from the last response, with the{" "}
            <code>interactionId</code> and <code>interactionToken</code> it kept.
          </li>
          <li>
            DaVinci continues from that screen and again runs until the next screen that needs
            the user, or until the end of the flow. Its answer is the next node:{" "}
            <code>continue</code> (a new form), <code>error</code> (same form, with a message),{" "}
            <code>failure</code> (terminal) or <code>success</code>.
          </li>
          <li>
            On success the flow&rsquo;s final PingOne Authentication node answers{" "}
            <code>COMPLETED</code> with <code>authorizeResponse.code</code>. The page sends the
            code and the PKCE verifier to <code>POST /api/davinci-sdk-login/callback</code>, and
            the BFF makes the session.
          </li>
        </ol>
        <CodeBlock title="The node loop" code={SNIPPET_LOOP} language="js" />
        <p>
          There is no callback into your app at any point: no webhook, no redirect, no JavaScript
          success callback. Each step is an ordinary request and response made by the SDK&rsquo;s
          own <code>fetch</code> with <code>credentials: &apos;include&apos;</code>.
        </p>
      </Section>

      <Section id="api-calls" title="API Calls">
        <p>
          The calls on the wire, in order, from runs captured on this demo. Values that identify a
          user or a session are shown as <code>…</code>; each field also carries display properties
          not shown here.
        </p>
        <h3>1. Get configuration from the BFF</h3>
        <CodeBlock title="POST /api/davinci-sdk-login/start" code={API_START} language="http" />
        <h3>2. The flow starts</h3>
        <CodeBlock title="client.start() sends" code={API_AUTHORIZE} language="http" />
        <CodeBlock title="PingOne answers with the first form" code={API_FORM_1} language="json" />
        <h3>3. A FlowCollector sends the flow back to DaVinci</h3>
        <p>
          The user clicked <strong>Having trouble signing on?</strong>. No values are sent, only
          the button&rsquo;s key.
        </p>
        <CodeBlock title='client.flow({ action: "TROUBLE" })() sends' code={API_FLOW_POST} language="http" />
        <CodeBlock title="DaVinci runs to its next screen and stops" code={API_FORM_2} language="json" />
        <h3>4. A SubmitCollector sends the form&rsquo;s values</h3>
        <p>
          On the Sign On form instead, <strong>Sign On</strong> sends what the user typed:
        </p>
        <CodeBlock title="client.next() sends" code={API_SUBMIT_POST} language="http" />
        <CodeBlock title="The flow completes" code={API_COMPLETED} language="json" />
        <h3>5. The code becomes a session</h3>
        <CodeBlock title="POST /api/davinci-sdk-login/callback" code={API_CALLBACK} language="http" />
      </Section>

      <Section id="the-flow" title="The Flow">
        <p>
          The first form, then either path out of it: the branch that stops at the next form, or
          the submit that completes the flow. If PingOne already has a session for this browser,
          step 6 already answers <code>COMPLETED</code> and there are no forms.
        </p>
        <MermaidFigure source={FLOW_SOURCE} label="Sequence of an Orchestration SDK sign-in" />
      </Section>

      <Section id="collectors" title="Collectors">
        <p>
          A collector is the SDK&rsquo;s typed, read-only view of one field on the current form. You
          never parse DaVinci&rsquo;s form JSON yourself: you call{" "}
          <code>client.getCollectors()</code>, draw each one, and write values back through the SDK.
        </p>
        <h3>How this flow&rsquo;s fields map</h3>
        <TableBlock headers={["DaVinci field", "Collector type", "Category", "In your UI"]} rows={FIELD_MAP} />
        <CodeBlock title="What getCollectors() returns" code={COLLECTOR_OBJECTS} language="json" />
        <h3>Every category</h3>
        <TableBlock headers={["Category", "Examples", "What you do with it"]} rows={CATEGORIES} />
        <h3>Code you can copy</h3>
        <p>
          React, following this page&rsquo;s own renderer (<code>CollectorField.jsx</code>). Each
          component takes the <code>client</code> returned by <code>davinci()</code>.
        </p>
        <CodeBlock title="Render the current node's collectors" code={CODE_RENDER} language="jsx" />
        <CodeBlock title="TextCollector and PasswordCollector" code={CODE_TEXT} language="jsx" />
        <CodeBlock title="SubmitCollector" code={CODE_SUBMIT} language="jsx" />
        <CodeBlock title="FlowCollector" code={CODE_FLOW} language="jsx" />
        <CodeBlock title="Handle the node that comes back" code={CODE_NODE} language="js" />
        <CodeBlock title="Validated text fields" code={CODE_VALIDATE} language="js" />
        <h3>Rules that fail silently if you miss them</h3>
        <ul>
          <li>
            <strong>Collectors are immutable.</strong> The SDK&rsquo;s store is frozen, so assigning{" "}
            <code>collector.input.value</code> does nothing and shows up only at submit as an empty
            field. The one write path is <code>client.update(collector)(value)</code>, and it
            returns <code>null</code> or an <code>{"{ error }"}</code> you must check.
          </li>
          <li>
            <strong>Check category for validation.</strong> A validated text field reports{" "}
            <code>type: &apos;TextCollector&apos;</code> with{" "}
            <code>category: &apos;ValidatedSingleValueCollector&apos;</code>.
          </li>
          <li>
            <strong>Submit and flow are different calls.</strong> A SubmitCollector means{" "}
            <code>client.next()</code>. A FlowCollector is a branch,{" "}
            <code>client.flow({"{ action: collector.output.key }"})()</code>, and does not submit
            the current form.
          </li>
          <li>
            <strong>Where errors appear.</strong> A rejected step comes back with status{" "}
            <code>error</code> and the same collectors; the step&rsquo;s message is{" "}
            <code>client.getError()?.message</code>. On this flow a wrong password produced that
            message with no per-field errors.
          </li>
          <li>
            <strong>Key React inputs by step.</strong> Two forms in a row can reuse a collector id
            (<code>username-0</code> on both forms here). Remount the inputs per node, or the second
            form shows a value the SDK does not hold.
          </li>
        </ul>
      </Section>

      <Section id="security" title="Security">
        <TableBlock headers={["Control", "How"]} rows={SECURITY} />
      </Section>

      <Section id="troubleshooting" title="Troubleshooting">
        <TableBlock headers={["Symptom", "Cause", "Fix"]} rows={TROUBLE} />
      </Section>

      <Section id="in-this-repo" title="In This Repo">
        <TableBlock headers={["File", "Purpose"]} rows={REPO} />
        <p>
          More: the <a href="/orchestration-sdk">Orchestration SDK Guide</a> on this site, and
          Ping&rsquo;s{" "}
          <a href="https://developer.pingidentity.com/orchsdks/index.html" target="_blank" rel="noreferrer">
            Orchestration SDK documentation
          </a>
          .
        </p>
      </Section>
    </>
  );
}
