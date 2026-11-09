import { useState } from "react";
import { Card, KvList, StatusChip } from "../components/pingUi";
import { TOKEN_ORDER, detailFor } from "./authorizationFlowDetails";
import { lanesFor, profileFor } from "./authorizationFlowData";

// The "what is really happening" region: follows the step being played. Plain-English account, tokens in play,
// the request and response, the decoded token with every claim explained, and what this boundary checks.
// Every outcome word carries "(scripted)": nothing here is checked or minted, so no chip claims a real result.

function CodeBlock({ label, text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      navigator.clipboard.writeText(text).then(() => setCopied(true), () => {});
    } catch { /* clipboard unavailable: the text stays selectable */ }
  };
  return (
    <div className="afd-code">
      <div className="afd-label pu-label">
        {label}
        <span className="afd-label__copy">
          <span aria-live="polite" className="afd-copied">{copied ? "Copied" : ""}</span>
          <button type="button" className="pu-btn afd-copy" aria-label={`Copy ${label.toLowerCase()}`} onClick={copy}>Copy</button>
        </span>
      </div>
      {/* A long line scrolls inside the block, so the block takes the keyboard to scroll it. */}
      <pre role="region" aria-label={label} tabIndex={0}>{text}</pre>
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
    <Card className="afd" role="region" aria-label="Step detail">
      <header className="afd__head">
        {step ? (
          <>
            <span className="afd__kicker">Step {stepIndex + 1} of {moment.steps.length}</span>
            <h3 className="pu-h3 afd__title">{step.label}</h3>
            <span className="afd__route">{names[step.from]} <i>{"→"}</i> {names[step.to]}</span>
            <StatusChip>{d?.refused ? "Refused (scripted)" : d?.ok ? "Succeeds (scripted)" : "In flight (scripted)"}</StatusChip>
          </>
        ) : (
          <>
            <span className="afd__kicker">Step detail</span>
            <h3 className="pu-h3 afd__title">Press Simulate, or pick a step</h3>
          </>
        )}
      </header>

      <div>
        <p className="pu-label">Tokens in play</p>
        <KvList
          items={TOKEN_ORDER.map((name, i) => ({
            label: `${i + 1} · ${name}`,
            value: liveToken === i + 1 ? <>{TOKEN_LINES[i]} <StatusChip>In use at this step</StatusChip></> : TOKEN_LINES[i],
          }))}
        />
        {d?.token ? <p className="pu-note"><strong>{d.token.name}.</strong> {d.token.summary}</p> : null}
      </div>

      {!d ? (
        <p className="pu-note afd__idle">
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
              <p className="pu-label">{d.token.name}, decoded (illustrative values)</p>
              <table className="afd__claims">
                <thead><tr><th>Claim</th><th>Value</th><th>What it means</th></tr></thead>
                <tbody>
                  {d.token.claims.map((c) => (
                    <tr key={c.claim} className={c.key ? "afd__key" : undefined}>
                      <td data-label="Claim">{c.claim}</td><td data-label="Value">{c.value}</td><td data-label="What it means">{c.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div>
            <p className="pu-label">What this boundary checks</p>
            <ul className={`afd__checks${d.refused ? " afd__checks--no" : ""}`}>
              {d.checks.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        </>
      )}
    </Card>
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
            className={`pu-btn${i === stepIndex ? " afd-steps__cur" : ""}${i > stepIndex ? " afd-steps__future" : ""}${s.block ? " afd-steps__no" : ""}`}
            onClick={() => onPick(i)}
          >
            <span className="afd-steps__n">{i + 1}</span>
            <span>
              {s.label}
              <small>{names[s.from]} {"→"} {names[s.to]}{s.block ? " · refusal" : ""}</small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
