// "What just happened": the short run summary shown after a sign-in on
// /davinci-sdk-login. The teaching lives in the page's lesson sections; this
// says what happened on THIS run and links into them.
//
// Built only from the page's own SDK trace (the logger, requestMiddleware and
// subscribe hooks in lib/davinciSdkClient.js) and the steps the page recorded.
// From captured URLs only parameter NAMES are shown, never nonce, state, PKCE
// or authorization-code values.
import { useMemo } from "react";
import { Lede, LessonFoot, OnThisRun, Status, TableBlock } from "../lesson";
import { requestShape, stepTitle } from "./StepInspector";

/**
 * Reduce the page's SDK trace to what the summary shows. Exported for tests.
 * @param {Array<object>} trace entries from lib/davinciSdkClient.js initClient
 */
export function summarizeTrace(trace = []) {
  const calls = (trace || [])
    .filter((e) => e?.source === "http")
    .map(requestShape)
    .filter(Boolean)
    .map(({ method, host, path, paramNames, responseMode }) => ({
      method,
      host,
      path,
      params: paramNames,
      responseMode,
    }));

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

const READ_NEXT = [
  ["Each step you just took: the request, DaVinci's answer, and the collectors", "try-it-live", "Try It Live"],
  ["The exact JSON on the wire for every call", "api-calls", "API Calls"],
  ["What each collector is, with copyable code", "collectors", "Collectors"],
  ["How this app is connected to PingOne and DaVinci", "how-its-wired", "How It's Wired"],
];

export default function SdkWalkthrough({ via = "form", username = null, trace = [], steps = [], onNavigate }) {
  const run = useMemo(() => summarizeTrace(trace), [trace]);
  const viaSession = via === "session";

  const link = (id, label) => (
    <a
      href={`#${id}`}
      onClick={(e) => {
        if (!onNavigate) return;
        e.preventDefault();
        onNavigate(id);
      }}
    >
      {label}
    </a>
  );

  return (
    <div>
      <Lede>
        {username ? (
          <>
            You&rsquo;re signed in as <strong>{username}</strong> and still on this page.
          </>
        ) : (
          "You're signed in and still on this page."
        )}{" "}
        Here is what the Orchestration SDK did on this run. The lesson on this page explains each
        part.
      </Lede>

      <OnThisRun>
        <ul className="lesson-list">
          <li>
            {viaSession
              ? "PingOne already had a session for this browser, so the flow completed on the very first call, with no screens and no collectors."
              : "The flow returned a form, this page rendered its collectors, and you submitted them."}
          </li>
          <li>
            <code>response_mode</code>:{" "}
            {run.authorize ? (
              <Status ok={run.piFlowOnWire}>
                {run.piFlowOnWire
                  ? "pi.flow, read off the actual /as/authorize request this page made"
                  : run.authorize.responseMode || "not present"}
              </Status>
            ) : (
              "the authorize request was not captured"
            )}
          </li>
          <li>Node statuses: {run.statuses.length ? run.statuses.join(" → ") : "not captured"}</li>
          <li>Requests the SDK made: {run.calls.length}</li>
        </ul>
        {steps.length > 0 && (
          <>
            <p className="lesson-run-title">The steps, in order</p>
            <ol className="lesson-list">
              {steps.map((s, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={i}>{stepTitle(s)}</li>
              ))}
            </ol>
          </>
        )}
      </OnThisRun>

      <TableBlock
        headers={["To see", "Read"]}
        rows={READ_NEXT.map(([what, id, label]) => [what, link(id, label)])}
      />

      <LessonFoot>
        More: the <a href="/orchestration-sdk">Orchestration SDK Guide</a> on this site, and
        Ping&rsquo;s{" "}
        <a href="https://developer.pingidentity.com/orchsdks/index.html" target="_blank" rel="noreferrer">
          Orchestration SDK documentation
        </a>
        .
      </LessonFoot>
    </div>
  );
}
