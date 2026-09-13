// "What just happened" — the developer walkthrough shown after a sign-in on
// /davinci-sdk-login.
//
// Written for developers integrating the Ping Orchestration SDK
// (@forgerock/davinci-client) with a PingOne DaVinci flow. Every claim below is
// backed by one of: the SDK source (davinci-client 2.1.1), the live PingOne
// configuration of this demo's application, or a run captured on the wire on
// 2026-09-13. Nothing here describes intended behaviour from memory.
//
// The "on this run" parts render the page's own SDK trace — the logger,
// requestMiddleware and subscribe hooks wired in lib/davinciSdkClient.js — so
// they show what actually happened in this browser, not a canned example. Only
// parameter NAMES are shown from captured URLs: never nonce, state, PKCE or
// authorization-code values.
import { useMemo } from "react";
import { useMermaidRender } from "../../hooks/useMermaidRender";
import "./SdkWalkthrough.css";

const safeUrl = (u) => {
  try {
    return new URL(u, window.location.origin);
  } catch {
    return null;
  }
};

/**
 * Reduce the page's SDK trace to what the walkthrough shows. Exported for tests.
 * @param {Array<object>} trace entries from lib/davinciSdkClient.js initClient
 */
export function summarizeTrace(trace = []) {
  const calls = (trace || [])
    .filter((e) => e?.source === "http" && e.url)
    .map((e) => {
      const u = safeUrl(e.url);
      return {
        method: String(e.method || "GET").toUpperCase(),
        host: u?.host || "",
        path: u?.pathname || String(e.url),
        params: u ? [...u.searchParams.keys()] : [],
        responseMode: u?.searchParams.get("response_mode") || null,
      };
    });

  const seen = new Set();
  const collectors = [];
  for (const e of trace || []) {
    if (e?.source !== "state") continue;
    for (const c of e.collectors || []) {
      const id = `${c.type}:${c.key ?? c.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      collectors.push(c);
    }
  }

  const statuses = (trace || [])
    .filter((e) => e?.source === "state" && e.status)
    .map((e) => e.status)
    .filter((s, i, all) => i === 0 || s !== all[i - 1]);

  const authorize = calls.find((c) => c.path.endsWith("/as/authorize")) || null;
  return {
    calls,
    collectors,
    statuses,
    authorize,
    piFlowOnWire: authorize?.responseMode === "pi.flow",
  };
}

/** Mermaid source for the path that actually ran. Exported for tests. */
export const sequenceSource = (viaSession) => `sequenceDiagram
  autonumber
  participant Page as This page
  participant SDK as davinci-client
  participant P1 as PingOne
  participant DV as DaVinci flow
  participant BFF as BFF
  Page->>BFF: POST /api/davinci-sdk-login/start
  BFF-->>Page: clientId, redirectUri, wellknown, scope, nonce
  Page->>SDK: davinci(config) then start(query nonce)
  SDK->>P1: GET /as/authorize response_mode=pi.flow, PKCE, state
  P1->>DV: the assigned flow policy runs the flow
${
  viaSession
    ? `  DV-->>SDK: 200 JSON status COMPLETED + authorizeResponse.code
  Note over P1,DV: PingOne already had a session, so no screens`
    : `  DV-->>SDK: 200 JSON form fields, interactionId, _links.next
  SDK-->>Page: node continue + collectors
  Note over Page: render collectors, update(collector)(value)
  Page->>SDK: next()
  SDK->>DV: POST _links.next.href with actionKey + formData
  DV-->>SDK: 200 JSON status COMPLETED + authorizeResponse.code`
}
  SDK-->>Page: node success, getClient().authorization.code
  Page->>BFF: POST /api/davinci-sdk-login/callback with code + PKCE verifier
  BFF->>P1: POST token endpoint with client_id + code_verifier
  BFF-->>Page: HttpOnly session cookie + username`;

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
    "Application › Policies — API: POST /environments/{envId}/applications/{appId}/flowPolicyAssignments",
    "Makes /as/authorize run the assigned DaVinci flow policy instead of PingOne's built-in sign-on policy. This is the whole connection between the app and DaVinci.",
  ],
  [
    "The flow policy itself",
    "DaVinci › Applications › Flow Policies",
    "Must be a PingOne flow policy (trigger AUTHENTICATION) — a choice made when the policy is created. The flow needs PingOne Flow enabled and must end in PingOne Authentication success/failure nodes. Without the trigger, /as/authorize returns a bare 500.",
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
    "Grants the resource scopes this page requests — and those scopes decide the access token's audience.",
  ],
  [
    "Signoff URL",
    "Application › Configuration",
    "A registered post_logout_redirect_uri lets /as/signoff return here when switching users.",
  ],
];

const CATEGORIES = [
  ["SingleValueCollector", "TextCollector, PasswordCollector", "One string. Render an input; write with update(c)(value)."],
  [
    "ValidatedSingleValueCollector",
    "text fields with validation rules (type is still TextCollector)",
    "One string plus rules in input.validation; call client.validate(c) before submitting.",
  ],
  ["MultiValueCollector", "checkbox lists, combo boxes", "An array of strings chosen from output.options."],
  ["ObjectValueCollector", "phone number (country code + number)", "An object value."],
  [
    "ActionCollector",
    "SubmitCollector, FlowCollector, IdpCollector",
    "No value — a button. next(), flow({ action })(), or an external IdP.",
  ],
  ["NoValueCollector", "read-only and rich text", "Display only; nothing is sent."],
  [
    "SingleValueAutoCollector, ObjectValueAutoCollector",
    "PingOne Protect signals, FIDO2",
    "No UI. The value is produced in code and sent with the step.",
  ],
  ["UnknownCollector", "any field the SDK does not recognise", "Render a visible fallback rather than dropping it."],
];

const CONTRAST = [
  [
    "Redirect (hosted pages)",
    "Default response mode: a 302 to PingOne's pages, then the browser is redirected to redirect_uri?code=…",
    "A code on your callback route",
  ],
  [
    "DaVinci widget",
    "DaVinci draws its own screens inside your page; davinci.skRenderScreen fires a JavaScript successCallback",
    "A DaVinci sessionToken, then a second /authorize hop to get a code",
  ],
  [
    "Orchestration SDK + pi.flow (this page)",
    "Every step is JSON returned to the SDK's own fetch; the page never navigates",
    "Collectors on each step, then authorizeResponse.code inside the final response",
  ],
];

const SNIPPET_START = `import { davinci } from "@forgerock/davinci-client";

const client = await davinci({
  config: {
    clientId,                    // the PingOne OIDC application
    redirectUri,                 // registered + validated; pi.flow never loads it
    scope: "openid profile email read write ai:agent:read",
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
    switch (c.category) {                          // category, not type
      case "SingleValueCollector":
      case "ValidatedSingleValueCollector": {
        const err = client.update(c)(valueFor(c)); // the ONLY write path
        if (err) showFieldError(c, err.error.message);
        break;
      }
      // ActionCollector: SubmitCollector -> next(), FlowCollector -> flow()
    }
  }

  node = branch
    ? await client.flow({ action: branch.output.key })() // FlowCollector
    : await client.next();                              // SubmitCollector
}

if (node.status === "success") {
  const { code, state } = client.getClient().authorization;
} else if (node.status === "failure") {
  // terminal: offer to call start() again
}`;

const SNIPPET_NEXT = `// What client.next() sent on the captured run (values elided).
// The URL is the _links.next.href from the previous response.
POST https://auth.pingone.com/<envId>/davinci/connections/<connectionId>/capabilities/customHTMLTemplate
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

const SNIPPET_FINAL = `// ...and the response that ended the flow (abridged)
{
  "status": "COMPLETED",
  "capabilityName": "returnSuccessResponseRedirect",
  "authorizeResponse": { "code": "…", "state": "…" },
  "interactionId": "…",
  "_links": { … }
}`;

const SNIPPET_BFF = `// POST /api/davinci-sdk-login/callback   { code, codeVerifier }
const expectedNonce = req.session.davinciSdkLoginNonce; // armed by /start
delete req.session.davinciSdkLoginNonce;                // one use only

const tokens = await postForm(tokenEndpoint, {
  grant_type: "authorization_code",
  client_id: sdkAppClientId,      // public client: no secret
  code,
  code_verifier: codeVerifier,    // PKCE: proves this browser began the flow
  redirect_uri: sameAsAuthorize,
});

if (nonceOf(tokens.id_token) !== expectedNonce) return res.status(401);

req.session.regenerate(() => {    // no session fixation
  req.session.oauthTokens = tokens; // server-side only
  req.session.user = user;          // resolved from userinfo
  res.json({ ok: true, username: user.username });
});`;

function Table({ head, rows }) {
  return (
    <div className="sdkw-table-wrap">
      <table className="sdkw-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((cell, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <td key={i}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Code = ({ children }) => (
  <pre className="sdkw-code">
    <code>{children}</code>
  </pre>
);

export default function SdkWalkthrough({ via = "form", username = null, trace = [], config = {} }) {
  const run = useMemo(() => summarizeTrace(trace), [trace]);
  const viaSession = via === "session";
  const { containerRef, error: diagramError } = useMermaidRender(sequenceSource(viaSession));

  return (
    <div className="sdkw">
      <p className="sdkw-lede">
        {username ? (
          <>
            You&rsquo;re signed in as <strong>{username}</strong> and still on this page.
          </>
        ) : (
          "You're signed in and still on this page."
        )}{" "}
        Below is exactly how that happened: how this app is wired to PingOne, what{" "}
        <code>pi.flow</code> changes, what collectors are, how each DaVinci step comes back, and
        how the result becomes a session.
      </p>

      <div className="sdkw-run">
        <p className="sdkw-run-title">On this run</p>
        <ul className="sdkw-list">
          <li>
            {viaSession
              ? "PingOne already had a session for this browser, so the flow completed on the very first call — no screens and no collectors."
              : "The flow returned a form, this page rendered its collectors, and you submitted them."}
          </li>
          <li>
            <code>response_mode</code>:{" "}
            {run.authorize ? (
              run.piFlowOnWire ? (
                <span className="sdkw-ok">
                  ✓ pi.flow — read off the actual /as/authorize request this page made
                </span>
              ) : (
                <span className="sdkw-warn">{run.authorize.responseMode || "not present"}</span>
              )
            ) : (
              "the authorize request was not captured"
            )}
          </li>
          <li>
            Node statuses: {run.statuses.length ? run.statuses.join(" → ") : "not captured"}
          </li>
          <li>Requests the SDK made: {run.calls.length}</li>
        </ul>
      </div>

      <section className="sdkw-section">
        <h3 className="sdkw-h">1. How this app is connected to PingOne</h3>
        <p className="sdkw-p">
          The SDK never talks to &ldquo;DaVinci&rdquo; directly. It speaks OIDC to a PingOne
          application, and a <strong>flow policy assignment</strong> on that application is what
          makes <code>/as/authorize</code> run a DaVinci flow instead of PingOne&rsquo;s built-in
          sign-on. Everything below has to be in place, or the SDK fails before a single collector
          arrives.
        </p>
        <Table head={["Setting", "Where", "Why it matters"]} rows={CHECKLIST} />
        {config.clientId && (
          <p className="sdkw-p">
            This page received: client_id <code>{config.clientId}</code>, redirect_uri{" "}
            <code>{config.redirectUri}</code>, scope <code>{config.scope}</code>, issuer{" "}
            <code>{safeUrl(config.wellknown || "")?.host}</code>. None of it is secret — the BFF
            hands the browser public configuration only.
          </p>
        )}
      </section>

      <section className="sdkw-section">
        <h3 className="sdkw-h">2. pi.flow — the flow comes back as JSON, not a redirect</h3>
        <p className="sdkw-p">
          A normal authorization-code request answers with a <strong>302</strong> to
          PingOne&rsquo;s hosted pages and later redirects the browser back to{" "}
          <code>redirect_uri?code=…</code>. With <code>response_mode=pi.flow</code> PingOne answers
          the same <code>GET /as/authorize</code> with <strong>200 and a JSON description of the
          current flow step</strong>. The browser never leaves your page — which is the only reason
          you can draw the sign-in UI yourself.
        </p>
        <p className="sdkw-p">
          You don&rsquo;t set it: davinci-client adds <code>responseMode: &apos;pi.flow&apos;</code>{" "}
          when it builds the authorize URL (<code>dist/src/lib/davinci.api.js</code> in 2.1.1),
          together with PKCE (<code>code_challenge</code>, S256) and <code>state</code>.
        </p>
        <Code>{SNIPPET_START}</Code>
        {run.authorize && (
          <p className="sdkw-p">
            The authorize request on this run carried: <code>{run.authorize.params.join(", ")}</code>
            .
          </p>
        )}
        <p className="sdkw-p">
          The JSON that comes back holds an <code>interactionId</code>, a{" "}
          <code>capabilityName</code>, the <code>form</code> with its fields, and{" "}
          <code>_links.next.href</code> — the address the next step must be posted to.
        </p>
      </section>

      <section className="sdkw-section">
        <h3 className="sdkw-h">3. Collectors — each form field as a typed object</h3>
        <p className="sdkw-p">
          davinci-client turns every field in that JSON into a <strong>collector</strong>: a plain
          object with <code>category</code>, <code>type</code>, <code>id</code>, <code>name</code>,{" "}
          <code>input</code> and <code>output</code>. You never parse DaVinci&rsquo;s raw form — you
          call <code>client.getCollectors()</code> and render what comes back. On the captured run
          the form fields were <code>TEXT username</code>, <code>PASSWORD password</code>,{" "}
          <code>SUBMIT_BUTTON SIGNON</code> and <code>FLOW_BUTTON REGISTER / TROUBLE</code>, which the
          SDK maps to a TextCollector, a PasswordCollector, a SubmitCollector and two FlowCollectors.
        </p>
        {run.collectors.length > 0 && (
          <>
            <p className="sdkw-p">Collectors this page received on this run:</p>
            <Table
              head={["type", "category", "key"]}
              rows={run.collectors.map((c) => [
                c.type,
                c.category,
                c.key ?? c.name ?? "",
              ])}
            />
          </>
        )}
        <p className="sdkw-p">Every collector falls into one category (davinci-client 2.1.1):</p>
        <Table head={["category", "examples", "what you do with it"]} rows={CATEGORIES} />
        <p className="sdkw-p">Rules that fail silently if you miss them:</p>
        <ul className="sdkw-list">
          <li>
            <strong>Collectors are immutable.</strong> The SDK&rsquo;s store is frozen, so assigning{" "}
            <code>collector.input.value</code> does nothing and only shows up at submit as an empty
            field. The one write path is <code>client.update(collector)(value)</code>, and it returns{" "}
            <code>null</code> or an <code>{"{ error }"}</code> you must check.
          </li>
          <li>
            <strong>Switch on category, not type.</strong> A validated text field reports{" "}
            <code>type: &apos;TextCollector&apos;</code> with{" "}
            <code>category: &apos;ValidatedSingleValueCollector&apos;</code>.
          </li>
          <li>
            <strong>SubmitCollector vs FlowCollector.</strong> Submit means{" "}
            <code>client.next()</code>. A FlowCollector is a branch —{" "}
            <code>client.flow({"{ action: collector.output.key }"})()</code> — and does not submit
            the current step.
          </li>
          <li>
            <strong>Where errors appear.</strong> A rejected step comes back with status{" "}
            <code>error</code> and the same collectors; the step-level message is{" "}
            <code>client.getError()?.message</code>. On this flow a wrong password produced that
            message with no per-field errors.
          </li>
        </ul>
        <Code>{SNIPPET_LOOP}</Code>
      </section>

      <section className="sdkw-section">
        <h3 className="sdkw-h">4. How DaVinci answers — there is no callback</h3>
        <p className="sdkw-p">
          Nothing in pi.flow calls back into your app: no webhook, no redirect to{" "}
          <code>redirect_uri</code>, no JavaScript success callback. Each step is an ordinary
          request and response made by the SDK&rsquo;s own <code>fetch</code> with{" "}
          <code>credentials: &apos;include&apos;</code>.
        </p>
        <ol className="sdkw-list">
          <li>
            The previous response carried <code>_links.next.href</code>. <code>client.next()</code>{" "}
            POSTs the step to exactly that URL — on this flow{" "}
            <code>/davinci/connections/&lt;connectionId&gt;/capabilities/customHTMLTemplate</code> —
            with the <code>interactionId</code>, <code>eventName: &quot;continue&quot;</code>, the
            button&rsquo;s <code>actionKey</code> and the <code>formData</code> the collectors hold.
          </li>
          <li>
            The response is the next node, and its status tells you what to do:{" "}
            <code>continue</code> → render the new collectors; <code>error</code> → same collectors
            plus a message; <code>failure</code> → terminal, offer to start again;{" "}
            <code>success</code> → finished.
          </li>
          <li>
            On success the flow&rsquo;s final PingOne Authentication step (
            <code>capabilityName: returnSuccessResponseRedirect</code>) puts the result{" "}
            <strong>inside the JSON</strong>: <code>status: &quot;COMPLETED&quot;</code> and{" "}
            <code>authorizeResponse.code</code>. The SDK exposes it as{" "}
            <code>client.getClient().authorization.code</code>. That code is the
            &ldquo;callback&rdquo; — delivered in a response body, not a navigation.
          </li>
        </ol>
        <Code>{SNIPPET_NEXT}</Code>
        <Code>{SNIPPET_FINAL}</Code>
        <p className="sdkw-p">
          The <code>redirect_uri</code> is still sent and must be registered — PingOne validates it
          and binds the code to it — but the browser never loads it. On the captured run the page
          URL never changed.
        </p>
        {run.calls.length > 0 && (
          <>
            <p className="sdkw-p">The requests the SDK made on this run, in order:</p>
            <ol className="sdkw-list">
              {run.calls.map((c, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={i}>
                  <code>
                    {c.method} {c.host}
                    {c.path}
                  </code>
                  {c.responseMode && (
                    <>
                      {" "}
                      <span className={c.responseMode === "pi.flow" ? "sdkw-ok" : "sdkw-warn"}>
                        response_mode={c.responseMode}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
        <p className="sdkw-p">The three ways a DaVinci sign-in reports back:</p>
        <Table head={["Integration", "How the result comes back", "What your code receives"]} rows={CONTRAST} />
      </section>

      <section className="sdkw-section">
        <h3 className="sdkw-h">5. Turning the code into a session — the BFF</h3>
        <p className="sdkw-p">The browser holds the code. It never holds the tokens.</p>
        <ol className="sdkw-list">
          <li>
            <strong>PKCE.</strong> When the SDK built the authorize URL it generated a code verifier
            and kept it in <code>sessionStorage</code> under{" "}
            <code>FR-SDK-authflow-&lt;clientId&gt;</code>. This page reads it once, deletes it, and
            sends it with the code to <code>POST /api/davinci-sdk-login/callback</code>.
          </li>
          <li>
            <strong>Exchange.</strong> The BFF calls PingOne&rsquo;s token endpoint as a public
            client — <code>client_id</code> plus <code>code_verifier</code>, no secret — with the
            same <code>redirect_uri</code>.
          </li>
          <li>
            <strong>Replay check.</strong> <code>POST /start</code> stored a one-time nonce in the
            server session and handed it to <code>start({"{ query: { nonce } }"})</code>. The BFF
            rejects the ID token unless its <code>nonce</code> matches, and the stored one is
            deleted either way.
          </li>
          <li>
            <strong>Session.</strong> It resolves the user, regenerates the session so it cannot be
            fixed in advance, stores the tokens server-side and answers with an HttpOnly cookie.
            Script on this page cannot read the tokens.
          </li>
          <li>
            <strong>Audience.</strong> The requested scopes decide who the access token is for. With
            only <code>openid profile email</code> PingOne mints a token for its own API and every
            call to this app&rsquo;s API is rejected — which is why the scope list includes this
            app&rsquo;s resource scopes.
          </li>
        </ol>
        <Code>{SNIPPET_BFF}</Code>
      </section>

      <section className="sdkw-section">
        <h3 className="sdkw-h">6. When PingOne already has a session</h3>
        <p className="sdkw-p">
          If the browser already has a PingOne session, <code>/as/authorize</code> completes the
          flow on the first call: the response is already <code>COMPLETED</code> with a code, and
          there are no collectors. This page treats that as a sign-in, tells you who it signed in
          as, and offers to sign out of PingOne to switch users.
        </p>
        <p className="sdkw-p">
          Don&rsquo;t force <code>prompt=login</code> to get the form back. PingOne then runs the
          screens over the existing session, and signing in there as a <em>different</em> user
          fails with <code>userSessionMismatch</code>. To switch users, end the PingOne session at
          the discovery document&rsquo;s <code>end_session_endpoint</code> (<code>/as/signoff</code>)
          with a registered <code>post_logout_redirect_uri</code>.
        </p>
      </section>

      <section className="sdkw-section">
        <h3 className="sdkw-h">7. The whole sequence{viaSession ? " (existing session)" : ""}</h3>
        {diagramError ? (
          <p className="sdkw-p sdkw-warn">Diagram failed to render: {diagramError}</p>
        ) : (
          <div className="sdkw-diagram" ref={containerRef} />
        )}
      </section>

      <p className="sdkw-foot">
        More: the <a href="/orchestration-sdk">Orchestration SDK Guide</a> on this site, and
        Ping&rsquo;s{" "}
        <a href="https://developer.pingidentity.com/orchsdks/index.html" target="_blank" rel="noreferrer">
          Orchestration SDK documentation
        </a>
        .
      </p>
    </div>
  );
}
