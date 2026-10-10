import React from "react";
import { Link } from "react-router-dom";
import DiagramStepBar from "./DiagramStepBar";
import StaticFlowDiagram from "./StaticFlowDiagram";
import { useDiagramStepper } from "../hooks/useDiagramStepper";
import { getConfig, useCaseDiagramPath } from "../config/useCaseDiagrams";
import "./DemoStepsLifelineAuditPage.css";

// Static audit report (read from code on main @ 1a84b4f, 13 Sep 2026). Backticks in strings render as <code>.
const code = (s) => s.split("`").map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p));

const REACH = { traced: "Traced", sim: "Sim only", none: "Not traced" };
const BASIS = { checked: "Checked", agent: "Agent", mixed: "Mixed" };

// [id, name, runs, reach, shown, gap, basis]
const STEPS = [
  ["UC24", "Public catalog, no exchange", "Chat chip", "traced", false, "Says the agent answered from context and draws MCP and API as not in path, though the local tool ran. `token-exchange` (skipped) and `tool-dispatched` go unread.", "mixed"],
  ["UC1", "Delegated access", "Chat chip", "traced", true, "Discovery now runs before the call and both 401 challenges draw in wire order (re-checked 9 Oct 2026). API and database steps can't finish without the MCP result; BFF introspection not drawn.", "checked"],
  ["UC8", "Consent (HITL)", "Chat chip", "traced", false, "The challenge draws, but approval runs through a consent modal and REST transfer outside the trace, so the run stays paused. `gateway_hitl_required` unread on gateway runs.", "mixed"],
  ["UC7", "MFA step-up", "Chat chip", "traced", false, "Gate emits a bare 428 `authorize_denied`; MFA phases only go to PostHog; the retry streams no live events.", "checked"],
  ["UC14b", "PAR within cap", "Simulator", "sim", false, "Quick result runs the offline RAR simulator — no PAR push. The live push is on the full page, which never feeds the diagram.", "checked"],
  ["UC14", "PAR over cap", "Simulator", "sim", false, "RAR denial draws as the intent-binding step; no PAR push or `request_uri` hop.", "checked"],
  ["UC12", "DPoP / replay defense", "Simulator", "sim", false, "An audience check: no DPoP proof, no replay check. Exchange stays pending.", "checked"],
  ["UC6", "Authorize DENY", "Chat chip", "traced", false, "A deny enforced at the gateway blanks the gateway step.", "checked"],
  ["UC2", "A2A delegation", "Chat chip", "traced", false, "No `a2a-*` event is read and there's no specialist lane; the handoff appears only in the explain modal.", "mixed"],
  ["UC2.5", "A2A orchestrator", "Chat chip", "traced", false, "Routes to UC2's action; the orchestrator never runs.", "checked"],
  ["UC2.7", "A2A end to end", "Own page", "none", false, "Its page never touches the store; the dashboard keeps the previous run.", "mixed"],
  ["UC22", "CIBA out-of-band", "Chat chip", "traced", false, "Polling yields only `ciba-poll`, which nothing reads; the retry wipes the challenge trace and streams no live events.", "checked"],
  ["UC5", "Insufficient scope", "Simulator", "sim", false, "Any gateway tool error is reported as `insufficient_scope`, including obligation challenges.", "checked"],
  ["UC10", "Cross-owner", "Simulator", "sim", false, "No flow id, so pipeline phases drop; `sim-cross-owner-denied` unread.", "checked"],
  ["UC13", "Confused deputy", "Simulator", "sim", false, "No flow id; the gateway's Authorize deny draws the gateway as not in path.", "checked"],
  ["UC11", "Bad client gateway", "Simulator", "sim", true, "Gateway deny and the audience mismatch draw. Token events only, no phases.", "agent"],
  ["UC20", "Audit trail", "Chat chip", "traced", false, "Same run as UC1; the audit trail it demonstrates leaves nothing on the diagram.", "agent"],
  ["UC18", "Rate-limit burst", "Simulator", "sim", false, "Burst and rate-limit events unread, so no 429 is drawn. After PR #3233 the run draws almost nothing.", "checked"],
  ["UC30", "Weather — Texas permit", "Chat chip", "traced", false, "Permit via `gw-filter-chain` isn't counted, so the gateway reads not in path. No weather-server lane.", "mixed"],
  ["UC31", "Weather — out of scope", "Chat chip", "traced", true, "`gateway_policy_denied` draws the gateway deny.", "agent"],
  ["UC32", "Weather — reconfigure scope", "Page → chat", "traced", false, "The page resets the scope when its own Run button navigates away; the change itself leaves no evidence.", "mixed"],
  ["UC40", "Enterprise-Managed MCP", "Page → chat", "traced", false, "ID-JAG issue and redeem draw, but the issuer is the BFF's own token endpoint shown on the PingOne lane, and the IdP policy check is invisible.", "agent"],
  ["UC38", "Personal Agent Concierge", "Own page", "none", false, "The page chat reads only the reply and never feeds the store; no MFA or registration evidence.", "agent"],
  ["UC-TOOL1", "Protected RAG", "Chat chip", "traced", true, "Exchange, Authorize and gateway draw; retrieval from the code index leaves no evidence and has no lane.", "agent"],
];
const count = (f) => STEPS.filter(f).length;

// Board: the 24 steps in script order, six to a row, snaking so each hop joins neighbours.
const COLS = 6;
const GROUPS = {
  shown: { label: "Shows what it demonstrates", bg: "var(--th-status-success)" },
  traced: { label: "Reaches the diagram, misses the point", bg: "var(--th-status-info)" },
  sim: { label: "Simulator events only", bg: "var(--th-status-warning)" },
  none: { label: "Not traced", bg: "var(--th-text-muted)" },
};
const BOARD_NODES = STEPS.map(([id, name, runs, reach, ok], i) => {
  const row = Math.floor(i / COLS);
  const col = row % 2 ? COLS - 1 - (i % COLS) : i % COLS;
  return { id, group: ok ? "shown" : reach, label: id, sub: [name, runs], x: col * 250, y: row * 120 };
});
const BOARD_EDGES = STEPS.slice(1).map(([id], i) => [STEPS[i][0], id, "", { vertical: (i + 1) % COLS === 0 }]);

const LANES = ["browser", "pingone", "agent", "mcp", "bff"];

const FIXES = [
  ["Walk the MCP 401 dance on both legs", ["Ready · this work", "UI + BFF"], "Discovery runs for real before every gateway tool call, both anonymous probes (tools/list and tools/call) capture the live 401 + WWW-Authenticate and the RFC 9728 metadata, and every step-box surface shows only the hops the run performed — the rest collapse behind a count chip.", true],
  ["Merge PR #3233 — draw only what happened", ["Ready · draft", "UI"], "Stops the full flow appearing on page load, clears the diagram when a new run starts, and no longer auto-plays when slow mode is restored. Demos whose evidence isn't modelled will now look sparse instead of showing hops that never happened.", true],
  ["Clear the trace when a page-type Demo step opens its page", ["UI", "4 steps"], "UC2.7, UC32, UC40 and UC38 navigate away without starting or clearing a trace, so the dashboard still shows the previous run when you return."],
  ["Forward MCP results on the chat path", ["UI", "every chip"], "The chat stream handler passes token events and flow updates but never MCP result frames, so the API and database steps can't complete."],
  ["Make step-up visible", ["UI + BFF", "UC7 · UC8 · UC22"], "Treat a 428 `authorize_denied` as step-up started, emit MFA phases into the flow rather than only to PostHog, and stream live token events on the step-up and CIBA retries."],
  ["Put gateway decisions on the gateway", ["Trace builder", "all gateway runs"], "Check a gateway denial before an authorize failure and count `gw-filter-chain` as gateway evidence (landed on main since the audit); the credential-less `tools/call` challenge now draws in wire order (fixed 9 Oct 2026 with the discovery rework)."],
  ["Draw PAR", ["UI + builder", "UC14 · UC14b"], "Feed the live intent-binding run into the store and add PAR push and `request_uri` steps on the PingOne lane (RFC 9126)."],
  ["Draw agent-to-agent delegation", ["Builder + lanes", "UC2 · UC2.5 · UC2.7"], "Add a specialist-agent lane and steps for both RFC 8693 exchanges. The eight `a2a-*` events already arrive; nothing reads them."],
  ["Give simulators a flow id and read their events", ["UI + builder", "UC10 · UC13 · UC18"], "Sims post only `{ sim }`, so pipeline phases are dropped; the burst, rate-limit and cross-owner events are never read."],
];

const CLAIMS = [
  ["UC12", "Labelled “DPoP / replay defense”, it sends the session token with the wrong audience. No DPoP proof is sent and there is no replay check — it's the same audience control as UC11."],
  ["UC2.5", "“A2A orchestrator” — its phrase matches the same routing rule as UC2, so the chip runs UC2 and the orchestrator never runs."],
  ["UC5", "Reports any gateway tool error as `insufficient_scope`, including 428 step-up, HITL and elicitation challenges."],
  ["UC32", "The weather page resets the scope to its default when it unmounts — and its own Run button unmounts it, so the reconfigured scope may be gone before the dashboard runs. Timing not observed live."],
  ["UC14b", "The default “quick result” runs the offline RAR simulator. The real PingOne PAR push only happens on the full intent-binding page."],
];

// [title, body, affects?] — all re-read in the code
const GAPS = [
  ["The diagram drew steps that hadn't happened", "The trace builder returns the whole pipeline on every trace, with no-evidence steps as `pending` and off-path steps as `notinpath`. The diagram had no styling for either, so it drew a complete flow on page load and made each new run look like the last. Fixed in PR #3233, and reworked 9 Oct 2026: one shared visibility policy drives every step-box surface — a completed run shows only what happened, and the rest collapse behind a 'hops not in this run' chip."],
  ["Step-up never reaches the trace", "The BFF gate emits a bare `authorize_denied` with status 428 for step-up, adding `authorize_denied_hitl` only for HITL. MFA phases go only to PostHog. Retries carry just the gate outcome and stream no live events, so a finished step-up run reads “did not demand step-up” in the reel.", "UC7 · UC8 · UC22"],
  ["Gateway decisions are drawn as “not in path”", "The gateway step tests for an authorize failure before a gateway denial, so a deny enforced at the gateway blanks the gateway. A permit that arrives only as `gw-filter-chain` isn't counted as gateway evidence either.", "UC6 · UC13 · UC30"],
  ["The credential-less `tools/call` challenge is out of order", "Fixed 9 Oct 2026: the `tools/call` probe now fires after discovery and immediately before the authorized call, and the discovery leg probes its own anonymous `tools/list` first — both dances draw in wire order. The static sequence page carries them as steps 5a/5b and 25a/25b.", "every gateway run"],
  ["MCP results never reach the store on the chat path", "The chat stream handler forwards token events and flow updates, not MCP result frames; the separate direct-tool path does dispatch them.", "every chat chip"],
  ["Simulators send no flow id", "The sim request carries only `{ sim }`. Without `flowTraceId` the pipeline's emit is a no-op, so pipeline-routed sims lose their phases.", "UC10 · UC13"],
  ["Evidence that arrives but nothing reads", "Token events `a2a-*` (eight ids), `ciba-poll`, `gw-backend-exchange`, `gw-mcp-audit`, `intent-token`, `token-exchange`, `tool-dispatched`, `sim-burst-*`, `sim-rate-limit-armed`, `sim-cross-owner-denied`. Phases `gateway_hitl_required`, `introspection_*`, `authorize_gate_skipped`."],
  ["Page-type steps leave the previous run on screen", "Picking one posts a message, navigates to its page and ticks the step done — without starting or clearing a trace.", "UC2.7 · UC32 · UC40 · UC38"],
];

const Basis = ({ k }) => <span className={`dsla-basis dsla-basis--${k}`}>{BASIS[k]}</span>;

export default function DemoStepsLifelineAuditPage() {
  const shown = count((s) => s[4]);
  const stepper = useDiagramStepper(STEPS.length);
  const cur = STEPS[stepper.step];
  const now = (i) => (i === stepper.step ? " is-now" : "");
  return (
    <div className="dsla-page">
      <header className="dsla-header">
        <div className="dsla-eyebrow">Sequence view · /dashboard · {STEPS.length} Demo steps</div>
        <h1>Demo Steps Lifeline Audit</h1>
        <p className="dsla-lede">Which Demo steps actually reach the live sequence diagram, whether each one shows the thing it exists to demonstrate, and what to fix first. Every finding is marked as checked against the code or reported by an audit agent and not yet re-read.</p>
        <div className="dsla-meta">
          <span>Read from code on <code>main</code> @ <code>1a84b4f</code></span>
          <span>Audited 13 Sep 2026</span>
          <span>Re-checked 9 Oct 2026 — discovery + 401 dance rework</span>
          <span>Nothing run live</span>
        </div>
        <p className="dsla-note">
          Audited when the script had 24 steps. Five joined since and are not re-audited here —
          each has a walkthrough diagram:{["UC29", "UC46", "UC47", "UC-MUSE1", "UC-MUSE2"].map((id, i, all) => (
            <span key={id}>
              {i > 0 && (i === all.length - 1 ? " and " : ", ")}
              {getConfig(id)
                ? <Link to={useCaseDiagramPath(id)}>{id}</Link>
                : id}
            </span>
          ))}
          . The steps in the board below also link their diagram and live step.
        </p>
        <div className="dsla-lanes" aria-label="Diagram lanes referenced in this audit">
          {LANES.map((l) => <span key={l} className={`dsla-lane dsla-lane--${l}`}>{l.toUpperCase()}</span>)}
        </div>
      </header>

      <section aria-labelledby="dsla-summary">
        <h2 id="dsla-summary">{shown} of {STEPS.length} show what they demonstrate</h2>
        <p>Most Demo steps do put something on the diagram. Few put the hop that the step is about — the step-up, the PAR push, the agent-to-agent handoff, the 429.</p>
        <div className="dsla-tallies">
          <div className="dsla-tally"><b>{count((s) => s[3] === "traced")}</b><span>Traced — the run's own evidence reaches the diagram</span></div>
          <div className="dsla-tally dsla-tally--warn"><b>{count((s) => s[3] === "sim")}</b><span>Simulator events only — token events plus a decision</span></div>
          <div className="dsla-tally dsla-tally--bad"><b>{count((s) => s[3] === "none")}</b><span>Not traced — run on their own page</span></div>
          <div className="dsla-tally dsla-tally--bad"><b>{CLAIMS.length}</b><span>Claim more than the demo actually does</span></div>
        </div>
        <DiagramStepBar stepper={stepper} caption={cur ? `${cur[0]} ${cur[1]}: ${cur[5].replace(/`/g, "")}` : ""} />
        <StaticFlowDiagram
          NODES={BOARD_NODES}
          EDGES={BOARD_EDGES}
          GROUPS={GROUPS}
          step={-1}
          focusId={cur?.[0]}
          testId="dsla-board"
          height={620}
          ariaLabel={`The ${STEPS.length} Demo steps in script order, coloured by whether the step reaches the sequence diagram and shows what it demonstrates. Only ${STEPS.filter((s) => s[4]).map((s) => s[0]).join(", ")} show it.`}
        />
        <div className="dsla-keys">
          {Object.entries(GROUPS).map(([k, g]) => (
            <span key={k} className="dsla-key"><span className={`dsla-sw dsla-sw--${k}`} />{g.label}</span>
          ))}
          <span className="dsla-key">Script order, snaking row by row</span>
        </div>
      </section>

      <section aria-labelledby="dsla-fix">
        <h2 id="dsla-fix">Fix first</h2>
        <p>Ordered by how many Demo steps each fix repairs for the effort. The first is already built.</p>
        <ol className="dsla-fixes">
          {FIXES.map(([title, tags, body, ready]) => (
            <li key={title} className={ready ? "is-ready" : undefined}>
              <span className="dsla-fix-title">{title}</span>
              <span className="dsla-fix-scope">{tags.map((t, i) => <span key={t} className={`dsla-tag${ready && i === 0 ? " dsla-tag--ready" : ""}`}>{t}</span>)}</span>
              <span className="dsla-fix-body">{code(body)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="dsla-truth" aria-labelledby="dsla-truth">
        <h2 id="dsla-truth">Where the demo claims more than it does</h2>
        <p>These aren't diagram bugs — the step itself behaves differently from its label. Each needs a product call before a code fix.</p>
        <ul>
          {CLAIMS.map(([uc, body]) => (
            <li key={uc}><span className="dsla-uc">{uc}</span><p>{code(body)}</p><Basis k="checked" /></li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="dsla-cross">
        <h2 id="dsla-cross">Gaps that span many steps</h2>
        <p>Each was re-read in the code after an agent reported it, unless marked otherwise.</p>
        <div className="dsla-findings">
          {GAPS.map(([title, body, affects]) => (
            <div key={title} className="dsla-finding">
              <h3>{code(title)}</h3>
              <p>{code(body)}</p>
              <Basis k="checked" />
              {affects && <div className="dsla-affects">{affects}</div>}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="dsla-all">
        <h2 id="dsla-all">All {STEPS.length} Demo steps</h2>
        <p>In script order. “Shows it” means the hop the step exists to demonstrate appears correctly on the diagram.</p>
        <div className="dsla-table-wrap">
          <table>
            <thead>
              <tr><th>Demo step</th><th>Runs as</th><th>On the diagram</th><th>What's missing or wrong</th><th>Basis</th></tr>
            </thead>
            <tbody>
              {STEPS.map(([id, name, runs, reach, ok, gap, basis], i) => (
                <tr key={id} className={now(i).trim() || undefined}>
                  <td className="dsla-step">
                    <span className="dsla-id">{id}</span><span>{name}</span>
                    <span className="dsla-step-links">
                      {getConfig(id) && <Link to={useCaseDiagramPath(id)}>diagram</Link>}
                      <Link to={`/use-cases#${id}`}>live step</Link>
                    </span>
                  </td>
                  <td className="dsla-runs">{runs}</td>
                  <td className="dsla-state">
                    <span className={`dsla-pill dsla-pill--${reach}`}>{REACH[reach]}</span>
                    <span className={`dsla-pill dsla-pill--${ok ? "shown" : "missing"}`}>{ok ? "Shows it" : "Not shown"}</span>
                  </td>
                  <td className="dsla-gap">{code(gap)}</td>
                  <td><Basis k={basis} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dsla-keys">
          <span className="dsla-key"><Basis k="checked" /> re-read in the code</span>
          <span className="dsla-key"><Basis k="agent" /> reported by an audit agent, not re-read</span>
          <span className="dsla-key"><Basis k="mixed" /> core claim checked, detail from an agent</span>
        </div>
      </section>

      <section className="dsla-two-col" aria-labelledby="dsla-method">
        <div>
          <h2 id="dsla-method">How this was checked</h2>
          <ul>
            <li>Four read-only agents traced the 24 steps in groups: chat chips on the token path, delegation and MCP servers, security simulators, and page walkthroughs.</li>
            <li>Every load-bearing claim was then re-read in the code. Ids were diffed against every argument of the builder's <code>findEvent</code> calls, not just the first.</li>
            <li><strong>Nothing was run live.</strong> The shared stack was recreated by other sessions three times during this work, which voided each live run.</li>
            <li>Routing mode doesn't change the steps drawn: Demo steps always force the heuristic path.</li>
          </ul>
        </div>
        <div>
          <h2>Corrected along the way</h2>
          <ul>
            <li><strong>No RAR rename bug.</strong> The builder accepts both <code>sim-rar-grant</code> and <code>rar-authorization</code>.</li>
            <li><strong>Retries do lose live events.</strong> An early read of the <code>sendAgentMessage</code> signature was wrong; the agent's claim stands.</li>
            <li><strong><code>tool-dispatched</code> is emitted</strong> — on the signed-out public-catalog path only. Elsewhere the proof check reads the MCP result instead.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
