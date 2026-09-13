// Call Inspector: one card per API call on /davinci-login-guide, built live from
// what crossed the wire in this browser (lib/davinciWidgetTrace.js).
//
// Each card answers: which call was this, did it succeed, and what did it do in
// the widget sign-in. Only method, address, status and the response's
// capabilityName/connectorId/success are ever shown — never bodies, tokens,
// interaction ids, nonce or form values.
import { Status } from "../lesson";

export function callKind(call) {
  const p = call?.path || "";
  if (p.endsWith("/api/davinci-login/sdk-token")) return "sdk-token";
  if (p.endsWith("/api/davinci-login/widget-session")) return "session";
  if (/\/davinci\/policy\/[^/]+\/start$/.test(p)) return "start";
  if (p.includes("/capabilities/")) {
    return call.capabilityName === "returnSuccessResponseWidget" ? "final" : "screen";
  }
  if (p.endsWith("/as/authorize")) return "authorize";
  return "other";
}

export function callTitle(call) {
  return `${call.method} ${call.host}${call.path}`;
}

function CallRole({ call }) {
  switch (callKind(call)) {
    case "sdk-token":
      return (
        <p>
          The page asks its BFF for widget config. The BFF mints a DaVinci SDK token with its API key
          (<code>X-SK-API-KEY</code>, never sent to the browser) and arms a one-time nonce it keeps in
          the session.
        </p>
      );
    case "start":
      return (
        <p>
          davinci.js starts flow policy <code>{call.path.split("/policy/")[1]?.split("/")[0]}</code> with
          the SDK token as a <code>Bearer</code> token. DaVinci runs the flow to its first screen and
          returns it as JSON (<code>capabilityName: {call.capabilityName || "…"}</code>), setting the{" "}
          <code>interactionId</code> cookie.
        </p>
      );
    case "screen":
      return (
        <p>
          A screen submit. davinci.js posts the button and form values with{" "}
          <code>eventName: &quot;continue&quot;</code> plus the <code>interactionid</code> and{" "}
          <code>interactiontoken</code> headers. DaVinci runs the flow to its next screen and returns it
          (<code>capabilityName: {call.capabilityName || "…"}</code>).
        </p>
      );
    case "final":
      return (
        <p>
          The last submit. The flow reached its final node, PingOne Authentication&rsquo;s{" "}
          <strong>Return Success Response (Widget Flows)</strong> (
          <code>capabilityName: returnSuccessResponseWidget</code>), which created the PingOne session
          and answered with <code>id_token</code> and <code>access_token</code>. davinci.js hands that
          response to <code>successCallback</code>.
        </p>
      );
    case "session":
      return call.status < 400 ? (
        <p>
          The page posts the two tokens to its BFF, which verifies both signatures, the nonce, both
          audiences and the subject, then starts the session with an HttpOnly cookie.
        </p>
      ) : (
        <p>The BFF rejected the tokens. The response&rsquo;s <code>error</code> names the check that failed.</p>
      );
    case "authorize":
      return (
        <p>
          A call to PingOne&rsquo;s <code>/as/authorize</code>. The widget integration never needs one; see
          pi.flow below.
        </p>
      );
    default:
      return null;
  }
}

function CallCard({ n, call }) {
  const ok = call.status < 400;
  return (
    <li className="dvl-call">
      <h4 className="dvl-call-title">
        Call {n}: <code>{callTitle(call)}</code>
      </h4>
      <p>
        <Status ok={ok}>HTTP {call.status}</Status>
        {callKind(call) === "final" && call.success === true && (
          <>
            {" "}
            <Status ok>success, tokens returned</Status>
          </>
        )}
      </p>
      <CallRole call={call} />
    </li>
  );
}

export default function CallInspector({ calls = [] }) {
  if (!calls.length) {
    return <p className="dvl-calls-empty">No calls yet. The first appears as soon as the widget starts.</p>;
  }
  return (
    <ol className="dvl-calls">
      {calls.map((c, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <CallCard key={i} n={i + 1} call={c} />
      ))}
    </ol>
  );
}
