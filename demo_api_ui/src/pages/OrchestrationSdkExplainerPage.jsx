// How the Ping Orchestration SDK works (/orchestration-sdk) — a static lesson.
//
// Makes NO live SDK, PingOne or BFF calls, so it teaches correctly regardless of
// whether the DaVinci console setup for the SDK login path has been done. That
// is deliberate: the first attempt at an SDK page in this repo died on load in
// an environment with no PINGONE_DAVINCI_* config (REGRESSION_PLAN.md,
// 2026-09-02), and a lesson that only works on a configured tenant is not a
// lesson.
//
// Companion to /davinci-orchestration, which argues WHY DaVinci orchestration
// is worth buying. This page answers HOW you drive a DaVinci flow from your own
// UI with @forgerock/davinci-client, and it is the concept half of the two
// education surfaces; the live SDK trace on the login page is the other.
//
// Every code sample here is copied from shipped code, never hand-written for
// the page. Three docs in this repo went stale by describing intended code
// instead of real code — see the header of DavinciLoginPage.jsx for what that
// cost. If a sample here stops matching its source file, fix the sample.
import { useMermaidRender } from "../hooks/useMermaidRender";
import "./OrchestrationSdkExplainerPage.css";

// The three ways a DaVinci flow can reach a user, all three live in this app.
// `route` is null for the one that has no page of its own (it IS the app login).
const INVOCATION_MODES = [
  {
    mode: "Redirect",
    route: null,
    routeLabel: "the app's own sign-in",
    ui: "PingOne / DaVinci, on their domain",
    returns: "an authorization code, after a full-page redirect",
    pick: "Fastest to stand up. You accept Ping's UI and a round trip off your domain.",
    featured: false,
  },
  {
    mode: "Widget",
    route: "/davinci-login-guide",
    routeLabel: "/davinci-login-guide",
    ui: "DaVinci's own HTML, inside your page",
    returns: "a DaVinci sessionToken — not an OIDC code",
    pick:
      "Keeps the user on your domain without you building screens. But OIDC issuance belongs to the redirect integration, so turning the session into a token needs an extra /authorize hop.",
    featured: false,
  },
  {
    mode: "Orchestration SDK",
    route: "/davinci-sdk-login",
    routeLabel: "/davinci-sdk-login",
    ui: "you, rendered from collectors",
    returns: "an authorization code, in-page, with no redirect",
    pick:
      "Full control of the UI, and the flow stays editable in DaVinci without an app release. You own every field, every error and every piece of styling.",
    featured: true,
  },
];

// The four collector shapes. `category` is the discriminator the SDK actually
// sets; `type` values are examples, not an exhaustive list.
const COLLECTOR_CATEGORIES = [
  {
    category: "Input",
    categoryValues: "SingleValueCollector, ValidatedSingleValueCollector, MultiValueCollector, ObjectValueCollector",
    examples:
      "TextCollector, PasswordCollector, SingleSelectCollector, MultiSelectCollector, PhoneNumberCollector. A required checkbox arrives as ValidatedBooleanCollector and an optional one as BooleanCollector — the flow's own validation, surfaced as a different type.",
    render: "A form field.",
    write: "client.update(collector)(value)",
  },
  {
    category: "Action",
    categoryValues: "ActionCollector",
    examples: "SubmitCollector, FlowCollector, IdpCollector",
    render: "A button or link.",
    write: "Nothing — these carry no value. Call next(), flow() or externalIdp().",
  },
  {
    category: "Display",
    categoryValues: "NoValueCollector",
    examples: "ReadOnlyCollector, RichTextCollector, QrCodeCollector, ImageCollector",
    render: "Text or an image the flow wants shown.",
    write: "Nothing.",
  },
  {
    category: "Automatic",
    categoryValues: "SingleValueAutoCollector, ObjectValueAutoCollector",
    examples: "ProtectCollector, FidoRegistrationCollector, FidoAuthenticationCollector, PollingCollector",
    render: "No UI at all — act, then submit. These carry output.config instead of output.label, which is how you spot them.",
    write: "client.update(collector)(result) once you have the signal, assertion or poll status.",
  },
];

// One sequence diagram is the whole lesson. Mirrors the architecture block in
// the plan and the order of calls in davinciSdkClient.js.
export const LIFECYCLE_DIAGRAM = `sequenceDiagram
  autonumber
  participant Page as Your page
  participant Sdk as davinci-client
  participant P1 as PingOne / DaVinci
  participant Bff as Your BFF
  Page->>Bff: POST /start
  Bff-->>Page: clientId, redirectUri, wellknown, nonce
  Page->>Sdk: await davinci({ config })
  Page->>Sdk: client.start({ query: { nonce } })
  Sdk->>P1: GET /as/authorize (response_mode=pi.flow)
  P1-->>Sdk: node + collectors
  Sdk-->>Page: node.status === 'continue'
  Note over Page: You render the collectors
  Page->>Sdk: client.update(collector)(value)
  Page->>Sdk: client.next()
  Sdk->>P1: POST flow continue
  P1-->>Sdk: next node
  Note over Page,Sdk: Loop until status is success
  Sdk-->>Page: authorization.code
  Page->>Bff: POST /callback (code + verifier)
  Bff->>P1: POST /as/token
  Bff-->>Page: HttpOnly session cookie`;

const INIT_SAMPLE = `const client = await davinci({
  config: {
    clientId,
    redirectUri,
    scope: 'openid profile email',
    responseType: 'code',
    serverConfig: { wellknown },
  },
});

let node = await client.start({ query: { nonce } });`;

const RENDER_SAMPLE = `switch (node.status) {
  case 'continue': return renderCollectors(client.getCollectors());
  case 'error':    return renderCollectors(client.getCollectors(), client.getErrorCollectors());
  case 'success':  return finish(client.getClient().authorization.code);
  default:         return renderFailure(client.getError()?.message);
}`;

const WRITE_SAMPLE = `// Collector state is immutable. Assignment is a silent no-op.
const err = client.update(collector)(value);
if (err && 'error' in err) {
  setFieldError(collector.name, err.error.message);
}`;

export default function OrchestrationSdkExplainerPage() {
  const { containerRef, error: diagramError } = useMermaidRender(LIFECYCLE_DIAGRAM);

  return (
    <div className="osx-page">
      <p className="osx-eyebrow">Ping Orchestration SDK</p>
      <h1 className="osx-title">Running a DaVinci flow in your own UI</h1>
      <p className="osx-lede">
        A DaVinci flow can reach a user three ways, and only one of them lets you render the
        screens. With <code className="osx-code-inline">@forgerock/davinci-client</code> the flow
        hands you <strong>collectors</strong> &mdash; a description of what it needs next &mdash;
        and you decide what that looks like. The flow stays editable in DaVinci; your app does not
        ship a release to follow it.
      </p>

      <section className="osx-section">
        <h2 className="osx-h2">Three ways to run a flow</h2>
        <p className="osx-body">
          All three are live in this app, against the same DaVinci flow. That comparison is the
          fastest way to see what the SDK actually buys you.
        </p>
        <div className="osx-modes">
          {INVOCATION_MODES.map((m) => (
            <article className={`osx-mode${m.featured ? " is-featured" : ""}`} key={m.mode}>
              <header className="osx-mode-head">
                <h3 className="osx-mode-title">{m.mode}</h3>
                {m.route ? (
                  <a className="osx-mode-link" href={m.route}>
                    {m.routeLabel}
                  </a>
                ) : (
                  <span className="osx-mode-note">{m.routeLabel}</span>
                )}
              </header>
              <dl className="osx-mode-facts">
                <dt>Who renders the UI</dt>
                <dd>{m.ui}</dd>
                <dt>What comes back</dt>
                <dd>{m.returns}</dd>
              </dl>
              <p className="osx-mode-pick">{m.pick}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="osx-section">
        <h2 className="osx-h2">The client lifecycle</h2>
        <p className="osx-body">
          Create a client, start the flow, then loop: read the collectors, write values back, call{" "}
          <code className="osx-code-inline">next()</code>. The loop ends when a node arrives with
          status <code className="osx-code-inline">success</code>, carrying the authorization code.
        </p>
        {diagramError ? (
          <p className="osx-diagram-error">Diagram failed to render: {diagramError}</p>
        ) : (
          <div className="osx-diagram" ref={containerRef} />
        )}
        <pre className="osx-code">
          <code>{INIT_SAMPLE}</code>
        </pre>
        <p className="osx-body">
          Note that <code className="osx-code-inline">davinci()</code> is async, and that{" "}
          <code className="osx-code-inline">serverConfig</code> takes{" "}
          <code className="osx-code-inline">wellknown</code> &mdash; the discovery document URL, not
          a base URL. Anything you pass in{" "}
          <code className="osx-code-inline">start({"{ query }"})</code> is merged onto the authorize
          request, which is how a server-armed <code className="osx-code-inline">nonce</code> gets
          in.
        </p>
      </section>

      <section className="osx-section">
        <h2 className="osx-h2">Every node has a status, and you branch on it</h2>
        <pre className="osx-code">
          <code>{RENDER_SAMPLE}</code>
        </pre>
        <p className="osx-body">
          An <code className="osx-code-inline">error</code> node still carries its collectors
          &mdash; that is what lets you re-render the same form with the server&rsquo;s complaints
          attached, rather than starting over. A{" "}
          <code className="osx-code-inline">failure</code> node is terminal: the flow is over and
          the only way forward is a fresh <code className="osx-code-inline">start()</code>.
        </p>
      </section>

      <section className="osx-section">
        <h2 className="osx-h2">The collector model</h2>
        <p className="osx-body">
          A collector is one thing the flow needs from this step. A DaVinci form field becomes a
          collector; so does a submit button, a social sign-in option, and a device signal you
          collect without showing anything. There are four shapes, and{" "}
          <code className="osx-code-inline">category</code> &mdash; not{" "}
          <code className="osx-code-inline">type</code> &mdash; is what reliably tells them apart.
        </p>
        <div className="osx-cats">
          {COLLECTOR_CATEGORIES.map((c) => (
            <article className="osx-cat" key={c.category}>
              <h3 className="osx-cat-title">{c.category}</h3>
              <p className="osx-cat-values">
                <code className="osx-code-inline">{c.categoryValues}</code>
              </p>
              <dl className="osx-cat-facts">
                <dt>Examples</dt>
                <dd>{c.examples}</dd>
                <dt>Render</dt>
                <dd>{c.render}</dd>
                <dt>Write a value</dt>
                <dd>{c.write}</dd>
              </dl>
            </article>
          ))}
        </div>
        <pre className="osx-code">
          <code>{WRITE_SAMPLE}</code>
        </pre>
        <p className="osx-body osx-body-aside">
          Two limits worth knowing before you design a flow around the SDK, both
          from Ping&rsquo;s compatibility reference. <strong>SKPolling components cannot be
          processed by the DaVinci client and should not be included in a flow at
          all</strong> &mdash; which rules out Magic Link and anything else built on
          polling, even though a <code className="osx-code-inline">PollingCollector</code> type
          exists for MFA polling. And images embedded in a Custom HTML Template
          cannot be passed to the SDK as structured data.
        </p>
      </section>

      <section className="osx-section">
        <h2 className="osx-h2">Why there is no redirect</h2>
        <p className="osx-body">
          The SDK sends <code className="osx-code-inline">response_mode=pi.flow</code> on the
          authorize request. Instead of redirecting the browser to a login page, PingOne answers
          with JSON describing the flow&rsquo;s current step &mdash; and keeps answering that way
          until the flow finishes, when it returns the authorization code. The whole conversation
          happens in your page, on your origin.
        </p>
        <p className="osx-body">
          That single parameter is what makes custom UI possible, and the contrast with the widget
          makes it concrete: the widget ends at a DaVinci session token, so it needs a second
          <code className="osx-code-inline">/authorize</code> hop to turn that session into a
          token. The SDK never needs one. You do still register a redirect URI &mdash; it is a
          required authorize parameter and it is used for real if your flow hands off to an
          external identity provider &mdash; but nothing navigates to it on the happy path.
        </p>
        <p className="osx-body osx-body-aside">
          The SDK sets <code className="osx-code-inline">pi.flow</code> itself. You do not pass it,
          and you must not put it in <code className="osx-code-inline">start({"{ query }"})</code>,
          because query values are merged last and would override the SDK&rsquo;s own.
        </p>
      </section>

      <section className="osx-section">
        <h2 className="osx-h2">What the SDK will not tell you</h2>
        <p className="osx-body">
          Five things that compile, look correct, and fail at runtime. Each one has cost someone a
          debugging session.
        </p>

        <details className="osx-trap">
          <summary className="osx-trap-summary">Collectors are immutable</summary>
          <div className="osx-trap-body">
            <p className="osx-body">
              The SDK&rsquo;s internal state is frozen. Assigning{" "}
              <code className="osx-code-inline">collector.input.value = x</code> throws nothing,
              changes nothing, and fails only when you submit and the field arrives empty. The
              updater from <code className="osx-code-inline">client.update(collector)</code> is the
              only way in.
            </p>
          </div>
        </details>

        <details className="osx-trap">
          <summary className="osx-trap-summary">The updater returns an error you have to check</summary>
          <div className="osx-trap-body">
            <p className="osx-body">
              It returns <code className="osx-code-inline">null</code> on success and an object
              with an <code className="osx-code-inline">error</code> property on failure. Calling
              it and ignoring the result discards the SDK&rsquo;s only report that your write did
              not land.
            </p>
          </div>
        </details>

        <details className="osx-trap">
          <summary className="osx-trap-summary">
            Validated fields share a <code className="osx-code-inline">type</code> with unvalidated ones
          </summary>
          <div className="osx-trap-body">
            <p className="osx-body">
              A validated text field arrives as{" "}
              <code className="osx-code-inline">type: 'TextCollector'</code> with{" "}
              <code className="osx-code-inline">category: 'ValidatedSingleValueCollector'</code>.
              Switch on <code className="osx-code-inline">type</code> alone and you will render it
              as a plain input and silently drop its validation rules. Branch on{" "}
              <code className="osx-code-inline">category</code>.
            </p>
          </div>
        </details>

        <details className="osx-trap">
          <summary className="osx-trap-summary">Server field errors live somewhere else</summary>
          <div className="osx-trap-body">
            <p className="osx-body">
              Per-field server validation comes from{" "}
              <code className="osx-code-inline">client.getErrorCollectors()</code>, as{" "}
              <code className="osx-code-inline">{"{ code, message, target }"}</code> &mdash; match{" "}
              <code className="osx-code-inline">target</code> to the field key. It only returns
              anything while <code className="osx-code-inline">node.status === 'error'</code>.
            </p>
            <p className="osx-body">
              Every collector also has an <code className="osx-code-inline">error</code> property,
              and it is not this. In the current release it is only ever set for polling
              collectors, so treating it as the validation channel gets you a form that never shows
              a server error.
            </p>
          </div>
        </details>

        <details className="osx-trap">
          <summary className="osx-trap-summary">Rich text arrives unsanitized</summary>
          <div className="osx-trap-body">
            <p className="osx-body">
              <code className="osx-code-inline">RichTextCollector</code> carries replacement links
              whose <code className="osx-code-inline">href</code> the SDK does not sanitize.
              Sanitizing it is your job, on your side of the boundary.
            </p>
          </div>
        </details>
      </section>

      <section className="osx-section">
        <h2 className="osx-h2">Where to go next</h2>
        <ul className="osx-links">
          <li>
            <a href="/davinci-sdk-login">/davinci-sdk-login</a> &mdash; the SDK driving a real flow,
            with a live trace of every call it makes.
          </li>
          <li>
            <a href="/davinci-login-guide">/davinci-login-guide</a> &mdash; the same flow in the hosted widget,
            for contrast.
          </li>
          <li>
            <a href="/davinci-orchestration">/davinci-orchestration</a> &mdash; why DaVinci
            orchestration is worth the licence, rather than how to drive it.
          </li>
        </ul>
      </section>

      <p className="osx-footnote">
        Static content only &mdash; this page makes no SDK, PingOne or BFF calls, so it works in any
        environment regardless of console setup.
      </p>
    </div>
  );
}
