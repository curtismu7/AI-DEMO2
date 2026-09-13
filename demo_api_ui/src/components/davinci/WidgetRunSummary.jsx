// "What just happened": the short run summary shown after a widget sign-in on
// /davinci-login-guide. The teaching lives in the page's lesson sections; this
// says what happened on THIS run and links into them. Built only from the calls
// lib/davinciWidgetTrace.js recorded (addresses and status, never values).
import { useMemo } from "react";
import { summarizeWidgetTrace } from "../../lib/davinciWidgetTrace";
import { Lede, LessonFoot, OnThisRun, Status } from "../lesson";
import { callTitle } from "./CallInspector";

const READ_NEXT = [
  ["Every call you just made, request and response", "api-calls", "API Calls"],
  ["Why the flow's last node decides what the widget returns", "the-final-node", "The Final Node"],
  ["What the BFF checked before signing you in", "tokens-to-session", "Tokens to Session"],
  ["Why this never used pi.flow", "pi-flow", "pi.flow"],
];

export default function WidgetRunSummary({ username = null, calls = [], onNavigate }) {
  const run = useMemo(() => summarizeWidgetTrace(calls), [calls]);

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
        Here is what the DaVinci widget did on this run. The lesson on this page explains each part.
      </Lede>

      <OnThisRun>
        <ul className="lesson-list">
          <li>
            <Status ok={run.authorizeCalls === 0}>
              Signed in without an /authorize redirect: this page never navigated
            </Status>
          </li>
          <li>
            The flow started{run.started ? "" : " (start call not captured)"}, then {run.capabilityPosts} screen
            submits.
          </li>
          <li>
            Final node: <code>{run.finalCapability || "not captured"}</code>{" "}
            <Status ok={run.tokensReturned}>
              {run.tokensReturned ? "returned id_token and access_token" : "no tokens were returned"}
            </Status>
          </li>
          <li>
            Session:{" "}
            {run.session ? (
              <Status ok={run.session.status < 400}>POST /widget-session answered HTTP {run.session.status}</Status>
            ) : (
              "not captured"
            )}
          </li>
        </ul>
        {run.calls.length > 0 && (
          <>
            <p className="lesson-run-title">The calls, in order</p>
            <ol className="lesson-list">
              {run.calls.map((c, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={i}>
                  <code>{callTitle(c)}</code> — HTTP {c.status}
                  {c.capabilityName ? (
                    <>
                      , <code>{c.capabilityName}</code>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        )}
      </OnThisRun>

      <p className="lesson-run-title">Read next</p>
      <ul className="lesson-list">
        {READ_NEXT.map(([what, id, label]) => (
          <li key={id}>
            {what}: {link(id, label)}
          </li>
        ))}
      </ul>

      <LessonFoot>
        More: the <a href="/davinci-sdk-login">Orchestration SDK lesson</a>, and Ping&rsquo;s{" "}
        <a
          href="https://docs.pingidentity.com/davinci/integrating_flows_into_applications/davinci_launching_a_flow_with_the_widget.html"
          target="_blank"
          rel="noreferrer"
        >
          widget documentation
        </a>
        .
      </LessonFoot>
    </div>
  );
}
