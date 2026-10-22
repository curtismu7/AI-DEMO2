import { useState } from "react";
import { TOKEN_ORDER, detailFor } from "./authorizationFlowDetails";
import { lanesFor, profileFor } from "./authorizationFlowData";

// The "what is really happening" region: follows the step being played. Plain-English account, tokens in play,
// the request and response, the decoded token with every claim explained, and what this boundary checks.

function CodeBlock({ label, text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      navigator.clipboard.writeText(text).then(() => setCopied(true), () => {});
    } catch { /* clipboard unavailable: the text stays selectable */ }
  };
  return (
    <div className="afd-code">
      <div className="afd-label">
        {label}
        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

const TOKEN_LINES = [
  "1 hour, exchange input only",
  "5 minutes, sub + act",
  "5 minutes, end of the chain",
];

export default function AuthorizationFlowDetail({ moment, vertical, stepIndex }) {
  const profile = profileFor(vertical);
  const names = Object.fromEntries(lanesFor(vertical).map((l) => [l.id, l.label]));
  const step = stepIndex >= 0 ? moment.steps[stepIndex] : null;
  const d = step ? detailFor(step.key, profile, moment.amount || 25, moment.pay) : null;
  const liveToken = d?.token?.idx || 0;

  return (
    <section className="afd" aria-label="Step detail">
      <header className="afd__head">
        {step ? (
          <>
            <span className="afd__kicker">Step {stepIndex + 1} of {moment.steps.length}</span>
            <h2>{step.label}</h2>
            <span className="afd__route">{names[step.from]} <i>{"→"}</i> {names[step.to]}</span>
            {d?.refused ? <span className="afd__pill afd__pill--no">Refused</span> : d?.ok ? <span className="afd__pill afd__pill--ok">Succeeds</span> : <span className="afd__pill afd__pill--info">In flight</span>}
          </>
        ) : (
          <>
            <span className="afd__kicker">Step detail</span>
            <h2>Press Simulate, or pick a step</h2>
          </>
        )}
      </header>

      <div>
        <div className="afd-label">Tokens in play</div>
        <div className="afd__tokens">
          {TOKEN_ORDER.map((name, i) => (
            <div key={name} className={`afd__tok${liveToken === i + 1 ? " afd__tok--live" : ""}`}>
              <strong>{i + 1} {"·"} {name}</strong>
              <span>{TOKEN_LINES[i]}</span>
            </div>
          ))}
        </div>
        {d?.token ? <p className="afd__tokline"><strong>{d.token.name}.</strong> {d.token.summary}</p> : null}
      </div>

      {!d ? (
        <p className="afd__idle">
          Each step shows what is happening and why, the request and response, the token in use with every claim
          explained, and what that boundary checks. Three tokens narrow the authority as the call moves inward.
        </p>
      ) : (
        <>
          <div className="afd__two">
            <div className="afd__say"><b>What is happening</b>{d.what}</div>
            <div className="afd__say afd__say--why"><b>Why it matters</b>{d.why}</div>
          </div>
          {d.request || d.response ? (
            <div className={`afd__two${d.request && d.response ? "" : " afd__two--one"}`}>
              {d.request ? <CodeBlock key={`req${stepIndex}`} label="Request" text={d.request} /> : null}
              {d.response ? <CodeBlock key={`res${stepIndex}`} label="Response" text={d.response} /> : null}
            </div>
          ) : null}
          {d.token ? (
            <div>
              <div className="afd-label">{d.token.name}, decoded (illustrative values)</div>
              <div className="afd__scroll">
                <table className="afd__claims">
                  <thead><tr><th>Claim</th><th>Value</th><th>What it means</th></tr></thead>
                  <tbody>
                    {d.token.claims.map((c) => (
                      <tr key={c.claim} className={c.key ? "afd__key" : undefined}>
                        <td>{c.claim}</td><td>{c.value}</td><td>{c.meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <div>
            <div className="afd-label">What this boundary checks</div>
            <ul className={`afd__checks${d.refused ? " afd__checks--no" : ""}`}>
              {d.checks.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

export function StepList({ moment, vertical, stepIndex, onPick }) {
  const names = Object.fromEntries(lanesFor(vertical).map((l) => [l.id, l.label]));
  return (
    <ol className="afd-steps" aria-label="Steps">
      {moment.steps.map((s, i) => (
        <li key={i}>
          <button
            type="button"
            aria-current={i === stepIndex ? "step" : undefined}
            className={`${i === stepIndex ? "afd-steps__cur" : ""}${i > stepIndex ? " afd-steps__future" : ""}${s.block ? " afd-steps__no" : ""}`}
            onClick={() => onPick(i)}
          >
            <span className="afd-steps__n">{i + 1}</span>
            <span>
              {s.label}
              <small>{names[s.from]} {"→"} {names[s.to]}</small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
