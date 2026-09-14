// Step Inspector: one card per SDK call on /davinci-sdk-login, built live from
// what actually crossed the wire in this browser.
//
// Each card answers the four questions a developer has while learning the
// Orchestration SDK:
//   1. What did my code call?        start() / flow() / update() + next(), copyable
//   2. What did the SDK send?        the request, typed values hidden
//   3. What did DaVinci answer?      the step JSON, abridged, values hidden
//   4. What did the SDK make of it?  each form field and the collector it became
// and then says why the page stopped: DaVinci runs the flow on its side and only
// answers when it reaches the next screen that needs the user.
//
// Sources, all real: the request is the requestMiddleware entry, masked in
// lib/davinciSdkClient.js before it was stored; the response is
// client.cache.getLatestResponse(), the SDK's own copy of the raw JSON; the
// collectors come from client.getCollectors(). From the authorize URL only
// parameter NAMES are rendered, never nonce, state, PKCE or code values.
import { CodeBlock, Status, TableBlock } from "../lesson";

const plain = (v) =>
  String(v ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

/**
 * The parts of a DaVinci step response the inspector shows. Exported for tests.
 * @param {object} data client.cache.getLatestResponse().data
 */
export function summarizeResponse(data) {
  if (!data || typeof data !== "object") return null;
  const fields = Array.isArray(data.form?.components?.fields) ? data.form.components.fields : [];
  return {
    flowStatus: data.status ? String(data.status) : null,
    capabilityName: data.capabilityName ? String(data.capabilityName) : null,
    eventName: data.eventName ? String(data.eventName) : null,
    hasInteractionId: Boolean(data.interactionId),
    formName: data.form?.name ? plain(data.form.name) : null,
    fields: fields.map((f) => ({
      type: String(f?.type ?? ""),
      key: f?.key == null ? null : String(f.key),
      label: plain(f?.label ?? f?.content),
    })),
    links: Object.keys(data._links || {}),
    authorizeKeys: Object.keys(data.authorizeResponse || {}),
    errorCode: data.code ? String(data.code) : null,
    errorMessage: data.message ? plain(data.message) : null,
  };
}

/** A response as a developer should read it: the shape kept, the values hidden. */
export function responseShape(s) {
  if (!s) return null;
  if (s.authorizeKeys.length) {
    return {
      ...(s.flowStatus ? { status: s.flowStatus } : {}),
      ...(s.capabilityName ? { capabilityName: s.capabilityName } : {}),
      authorizeResponse: Object.fromEntries(s.authorizeKeys.map((k) => [k, "…"])),
    };
  }
  return {
    ...(s.hasInteractionId ? { interactionId: "…" } : {}),
    ...(s.eventName ? { eventName: s.eventName } : {}),
    ...(s.capabilityName ? { capabilityName: s.capabilityName } : {}),
    ...(s.flowStatus ? { status: s.flowStatus } : {}),
    ...(s.errorCode ? { code: s.errorCode } : {}),
    ...(s.errorMessage ? { message: s.errorMessage } : {}),
    ...(s.formName || s.fields.length
      ? {
          form: {
            name: s.formName,
            components: {
              fields: s.fields.map(({ type, key, label }) => ({
                type,
                ...(key ? { key } : {}),
                ...(label ? { label } : {}),
              })),
            },
          },
        }
      : {}),
    ...(s.links.length ? { _links: Object.fromEntries(s.links.map((k) => [k, { href: "…" }])) } : {}),
  };
}

/** One requestMiddleware trace entry, reduced to what is safe to show. */
export function requestShape(entry) {
  if (!entry?.url) return null;
  let u;
  try {
    u = new URL(entry.url);
  } catch {
    return null;
  }
  return {
    method: String(entry.method || "GET").toUpperCase(),
    host: u.host,
    path: u.pathname,
    paramNames: [...u.searchParams.keys()],
    responseMode: u.searchParams.get("response_mode"),
    body: entry.body ?? null,
  };
}

/** A one-line name for a step, e.g. You clicked "Back" (FlowCollector) → form "Sign On". */
export function stepTitle(step) {
  const r = step?.response;
  const to = r?.formName
    ? ` → form "${r.formName}"`
    : r?.authorizeKeys?.length
      ? " → flow COMPLETED"
      : step?.nodeStatus
        ? ` → status ${step.nodeStatus}`
        : "";
  if (step?.kind === "start") return `The flow starts${to}`;
  const type = step?.trigger?.type || (step?.kind === "flow" ? "FlowCollector" : "SubmitCollector");
  const label = step?.trigger?.label ? `"${step.trigger.label}"` : "a button";
  return `You clicked ${label} (${type})${to}`;
}

/** The code this page ran for a step, written so it can be copied. */
export function stepCode(step) {
  const t = step?.trigger || {};
  if (step?.kind === "start") {
    return `const client = await davinci({ config }); // clientId, redirectUri, scope, serverConfig.wellknown

// GET /as/authorize with response_mode=pi.flow, PKCE and state, added by the SDK
const node = await client.start({ query: { nonce } });

if (node.status === "continue") render(client.getCollectors()); // the first form`;
  }
  if (step?.kind === "flow") {
    return `// "${t.label}" is a FlowCollector: a branch, not a submit.
// No values are written first, and next() is not called.
const node = await client.flow({ action: ${JSON.stringify(t.key ?? "")} })();

if (node.status === "continue") render(client.getCollectors()); // the next form`;
  }
  const keys = Object.keys(step?.request?.body?.parameters?.data?.formData || {});
  const writes = keys.length
    ? `const collectorFor = (key) => client.getCollectors().find((c) => c.output.key === key);

// Written as the user typed. Each call returns null, or { error } to show.
${keys.map((k) => `client.update(collectorFor(${JSON.stringify(k)}))(value);`).join("\n")}

`
    : "";
  return `${writes}// "${t.label}" is a SubmitCollector: send this form's values.
const node = await client.next();

// continue: render the next form      error: same form + client.getError().message
// success: client.getClient().authorization.code      failure: start again`;
}

function roleOf(field) {
  const key = field.key ?? "";
  switch (field.type) {
    case "TEXT":
      return (
        <>
          Holds one string. The input writes it with <code>client.update(collector)(value)</code>;{" "}
          <code>next()</code> sends it as <code>formData.{key}</code>.
        </>
      );
    case "PASSWORD":
      return (
        <>
          Holds one string, like text, but the SDK never hands the value back. Written with{" "}
          <code>update()</code>; sent as <code>formData.{key}</code>.
        </>
      );
    case "SUBMIT_BUTTON":
      return (
        <>
          No value; a button. It calls <code>client.next()</code>, which posts the form&rsquo;s values
          with <code>actionKey: &quot;{key}&quot;</code>.
        </>
      );
    case "FLOW_BUTTON":
      return (
        <>
          No value; a branch. It calls <code>client.flow({`{ action: "${key}" }`})()</code>, which posts{" "}
          <code>eventType: &quot;action&quot;</code> and <code>actionKey: &quot;{key}&quot;</code> without
          the form&rsquo;s values.
        </>
      );
    default:
      return <>Not handled by this page&rsquo;s renderer, which shows a visible fallback for it.</>;
  }
}

/** Table rows: each DaVinci form field beside the collector the SDK built from it. */
export function fieldRows(summary, collectors = []) {
  return (summary?.fields || []).map((f) => {
    const c = collectors.find((x) => f.key != null && x.key === f.key);
    return [
      <>
        <code>{f.type}</code> {f.key && <code>{f.key}</code>}
        {f.label && <> &ldquo;{f.label}&rdquo;</>}
      </>,
      c ? (
        <>
          <code>{c.type}</code>
          <br />
          {c.category}
        </>
      ) : (
        "none"
      ),
      roleOf(f),
    ];
  });
}

function Outcome({ step }) {
  switch (step.nodeStatus) {
    case "continue":
      return (
        <p className="sdkl-outcome">
          Node status <code>continue</code>. DaVinci ran the flow on its side until it reached a screen
          that needs the user, then stopped and returned that form. The page rendered its collectors
          and is waiting for you.
        </p>
      );
    case "error":
      return (
        <p className="sdkl-outcome">
          Node status <code>error</code>. DaVinci rejected this step and kept the same form
          {step.errorMessage ? (
            <>
              ; <code>client.getError().message</code> says &ldquo;{step.errorMessage}&rdquo;
            </>
          ) : null}
          .
        </p>
      );
    case "success":
      return (
        <p className="sdkl-outcome">
          Node status <code>success</code>. The flow answered <code>COMPLETED</code> with{" "}
          <code>authorizeResponse.code</code>. The page reads it with{" "}
          <code>client.getClient().authorization.code</code> and sends it, with the PKCE verifier, to
          the BFF.
        </p>
      );
    case "failure":
      return (
        <p className="sdkl-outcome">
          Node status <code>failure</code>. This is terminal
          {step.errorMessage ? <> (&ldquo;{step.errorMessage}&rdquo;)</> : null}; start the flow again
          with <code>client.start()</code>.
        </p>
      );
    default:
      return null;
  }
}

function StepCard({ n, step }) {
  const req = requestShape(step.request);
  const shape = responseShape(step.response);
  const codeTitle = step.kind === "start" ? "start()" : step.kind === "flow" ? "flow()" : "update() and next()";
  return (
    <li className="sdkl-step">
      <h4 className="sdkl-step-title">
        Step {n}: {stepTitle(step)}
      </h4>

      <p className="sdkl-part">1. This page called the SDK</p>
      <CodeBlock title={codeTitle} code={stepCode(step)} language="js" />

      <p className="sdkl-part">2. The SDK sent this to {step.kind === "start" ? "PingOne" : "DaVinci"}</p>
      {req ? (
        <>
          <p>
            <code>
              {req.method} {req.host}
              {req.path}
            </code>
            {req.responseMode && (
              <>
                {" "}
                <Status ok={req.responseMode === "pi.flow"}>response_mode={req.responseMode}</Status>
              </>
            )}
          </p>
          {req.body ? (
            <CodeBlock
              title="Request body (typed values hidden)"
              code={JSON.stringify(req.body, null, 2)}
              language="json"
            />
          ) : (
            req.paramNames.length > 0 && (
              <p>
                Query parameters (names only): <code>{req.paramNames.join(", ")}</code>
              </p>
            )
          )}
        </>
      ) : (
        <p>The request was not captured.</p>
      )}

      <p className="sdkl-part">
        3. {step.kind === "start" ? "PingOne ran the flow policy and DaVinci answered" : "DaVinci answered"}
      </p>
      {shape ? (
        <CodeBlock
          title="Response JSON (abridged, values hidden)"
          code={JSON.stringify(shape, null, 2)}
          language="json"
        />
      ) : (
        <p>The SDK kept no response body for this step.</p>
      )}

      {step.response?.fields?.length > 0 && (
        <>
          <p className="sdkl-part">4. The SDK turned each form field into a collector</p>
          <TableBlock
            headers={["DaVinci field", "Collector", "What it does"]}
            rows={fieldRows(step.response, step.collectors)}
          />
        </>
      )}

      <Outcome step={step} />
    </li>
  );
}

export default function StepInspector({ steps = [] }) {
  if (!steps.length) {
    return <p className="sdkl-empty">No steps yet. The first appears as soon as the flow starts.</p>;
  }
  return (
    <ol className="sdkl-steps">
      {steps.map((s, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <StepCard key={i} n={i + 1} step={s} />
      ))}
    </ol>
  );
}
