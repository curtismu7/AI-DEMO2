import React, { useState } from "react";
import { DiagramControls, STEP_TIME_OPTIONS } from "./diagram";
import "./PingFederateIdJagPage.css";
import IdJagPathBar from "./IdJagPathBar";
import IdJagCallPlayer from "./IdJagCallPlayer";
import IdJagWireDetail from "./IdJagWireDetail";
import StaticFlowDiagram from "./StaticFlowDiagram";
import PageHeader from './common/PageHeader';
import { useDiagramStepper } from "../hooks/useDiagramStepper";
import { REFIT_EVENT } from "../hooks/useFitOnResize";
import { JAG_DIAGRAM, JAG_GUIDE, LOGIN_DIAGRAM, LOGIN_GUIDE, REQUEST_DIAGRAM, REQUEST_GUIDE } from "../config/pfIdJagDiagrams";

const MOCK = "MOCK DATA — NOT A REAL TOKEN";

function LearningPanel({ learning }) {
  return (
    <section className="pfj-learning" aria-labelledby="pfj-learning-title">
      <div className="pfj-learning__intro">
        <span className="pfj-protocol__eyebrow">THE IMPORTANT IDEAS</span>
        <h3 id="pfj-learning-title">Understand this flow</h3>
        <p>{learning.summary}</p>
      </div>
      <div className="pfj-learning__points">
        {learning.points.map((point, index) => (
          <article key={point.title}>
            <span className="pfj-learning__number">{String(index + 1).padStart(2, "0")}</span>
            <div><h4>{point.title}</h4><p>{point.body}</p></div>
          </article>
        ))}
      </div>
      <nav className="pfj-learning__docs" aria-label="PingFederate learning links">
        <h4>Learn from PingFederate documentation</h4>
        <div>{learning.docs.map((doc) => <a key={doc.label} href={doc.href} target="_blank" rel="noreferrer">{doc.label}<span aria-hidden="true"> ↗</span></a>)}</div>
      </nav>
    </section>
  );
}

// The request on the wire, the MOCK tokens and the standards for each arrow of the current guide step: the same
// data (config/pfIdJagStandards.js) the diagram's step reel shows, so the two never disagree.
function ProtocolDetails({ flow, edges, learning }) {
  return (
    <details open className="pfj-protocol">
      <summary>Protocol details <span>Mock tokens · API request / response</span></summary>
      <LearningPanel learning={learning} />
      <div className="pfj-protocol__body">
        {edges.map((i) => {
          const [src, tgt, label] = flow.EDGES[i];
          const name = (id) => flow.NODES.find((n) => n.id === id).label;
          const detail = flow.STEPS.find((s) => s.edges.includes(i))?.detail;
          return (
            <article key={i} className="pfj-protocol__arrow ijc" data-testid={`pfj-protocol-arrow-${i + 1}`}>
              <div className="pfj-protocol__heading">
                <div><span className="pfj-protocol__eyebrow">ARROW {i + 1}</span><h3>{name(src)} → {name(tgt)} · {label}</h3></div>
                <span className="pfj-protocol__mock">{MOCK}</span>
              </div>
              <IdJagWireDetail detail={detail} testPrefix={`pfj-protocol-${i + 1}`} />
            </article>
          );
        })}
      </div>
    </details>
  );
}

const withDetail = (guide) => guide.map((g) => ({ ...g, detail: g.what }));

export const DIAGRAMS = {
  jag: {
    label: "ID-JAG flow",
    exchangeSummary: "2 token exchanges",
    title: "ID-JAG token journey",
    intro: "Two sides: PingFederate issues the ID-JAG; the downstream MCP authorization server validates and redeems it.",
    badge: "ID-JAG · urn:ietf:params:oauth:token-type:id-jag",
    lanes: ["ID-JAG issuance and grant redemption", "Gateway policy and protected resource"],
    chain: ["upstream refresh token", "PingFederate ID-JAG", "MCP access token"],
    learning: {
      summary: "ID-JAG has two distinct validation sides. PingFederate validates the refresh token and issues the ID-JAG; the resource authorization server validates that assertion when it redeems it.",
      points: [
        { title: "Side 1 · issue", body: "The BFF sends its server-held refresh token to PingFederate in an OAuth token-exchange request. PingFederate validates it under the configured processor policy, then issues a signed ID-JAG whose audience identifies the receiving authorization server." },
        { title: "Side 2 · validate and redeem", body: "The BFF presents the ID-JAG as a JWT bearer assertion to the downstream MCP authorization server. That server validates the issuer and signature, audience, expiry, ID-JAG type, resource and replay identifier, then returns its own local access token." },
        { title: "Use the right token", body: "The ID-JAG is a short-lived delegation assertion, not the credential sent to the MCP API. The BFF uses the newly issued resource-scoped access token for the PingGateway call; PingOne Authorize evaluates the action policy." },
      ],
      docs: [
        { label: "OAuth grant types", href: "https://docs.pingidentity.com/pingfederate/13.1/introduction_to_pingfederate/pf_grant_types.html" },
        { label: "Refresh token → ID-JAG setup", href: "https://docs.pingidentity.com/pingfederate/13.1/administrators_reference_guide/pf_configuring_refresh_token_to_idjag_exchange.html" },
        { label: "JWT bearer assertion setup", href: "https://docs.pingidentity.com/pingfederate/13.1/administrators_reference_guide/pf_configuring_oauth_assertion_grant_idp_connection.html" },
      ],
    },
    flow: JAG_DIAGRAM,
    steps: withDetail(JAG_GUIDE),
  },
  pingfederate: {
    label: "PingFederate login",
    exchangeSummary: "OIDC code + PKCE sign-in",
    title: "PingFederate standard login",
    intro: "PingFederate handles OIDC login. The BFF redeems the code, keeps the tokens server-side and gives the browser only a session cookie. The next tab follows the signed-in user's AI request.",
    badge: "Login: PingFederate",
    lanes: ["Standard PingFederate OIDC login"],
    chain: ["BFF starts PKCE sign-in", "PingFederate authenticates", "code", "BFF session cookie"],
    learning: {
      summary: "Standard PingFederate OIDC login with Authorization Code and PKCE. Where one arrow shows a request and its response (for example the code exchange and the tokens that come back), the arrow label names the response in brackets and the protocol details show both.",
      points: [
        { title: "Login · authenticate once", body: "The BFF starts OIDC Authorization Code with PKCE. PingFederate authenticates the user and returns a code; the BFF redeems it, validates the ID token and keeps OAuth tokens server-side behind an HTTP-only browser session." },
        { title: "Credentials stay at PingFederate", body: "The user types the password into PingFederate's own sign-in page. The BFF never sees it, and the browser ends up with a cookie, never a token." },
      ],
      docs: [
        { label: "OAuth grant types", href: "https://docs.pingidentity.com/pingfederate/13.1/introduction_to_pingfederate/pf_grant_types.html" },
        { label: "OIDC authorization endpoint", href: "https://docs.pingidentity.com/pingfederate/13.1/developers_reference_guide/pf_authorization_endpoint.html" },
      ],
    },
    flow: LOGIN_DIAGRAM,
    steps: withDetail(LOGIN_GUIDE),
  },
  pfrequest: {
    label: "AI request",
    exchangeSummary: "agent delegation + policy",
    title: "PingFederate AI request path",
    intro: "After PingFederate login, the signed-in user follows the full AI path: BFF → agent service → PingFederate delegation → PingGateway → PingOne Authorize → MCP server.",
    badge: "Login: PingFederate · Runtime policy: PingOne Authorize",
    lanes: ["AI request · BFF-mediated authorization and MCP call"],
    chain: ["BFF session", "Agent Service", "PingFederate delegation", "PingGateway + P1AZ", "MCP server"],
    learning: {
      summary: "After login, the BFF runs the AI request and performs the app's separate agent-delegation exchanges before calling the protected MCP tool. Where one arrow shows a request and its response, the arrow label names the response in brackets and the protocol details show both.",
      points: [
        { title: "Agent · propose, BFF executes", body: "The BFF sends the prompt to the reasoning-only Agent Service. The agent proposes a tool call; it does not receive the user's OAuth tokens or call MCP. The BFF owns credentials and executes the approved request." },
        { title: "Delegation · two exchanges after login", body: "The two agent exchanges happen after login. The standard PingFederate adapter performs two RFC 8693 exchanges to construct a scoped MCP access token for the agent action. These runtime delegation exchanges are separate from the earlier OIDC code exchange and from the ID-JAG flow in the other tab." },
        { title: "Policy · protect the MCP action", body: "PingGateway enforces the access token and calls PingOne Authorize. PingOne Authorize evaluates the action policy; PingFederate is the login provider in this view." },
      ],
      docs: [
        { label: "OAuth grant types", href: "https://docs.pingidentity.com/pingfederate/13.1/introduction_to_pingfederate/pf_grant_types.html" },
      ],
    },
    flow: REQUEST_DIAGRAM,
    steps: withDetail(REQUEST_GUIDE),
  },
};

export default function PingFederateIdJagPage() {
  const [diagramId, setDiagramId] = useState("jag");
  const diagram = DIAGRAMS[diagramId];
  const { GROUPS, NODES, EDGES, STEPS } = diagram.flow;
  // One stepper walks the arrows: the diagram, its movie reel, the controls and the guide below all follow it.
  const stepper = useDiagramStepper(EDGES.length);
  const guideIndex = stepper.step < 0 ? 0 : Math.max(0, diagram.steps.findIndex((s) => s.edges.includes(stepper.step)));
  const step = diagram.steps[guideIndex];
  const goToGuide = (index) => stepper.goTo(diagram.steps[index].edges[0]);
  const onReset = () => {
    stepper.stop();
    window.dispatchEvent(new Event(REFIT_EVENT));
  };

  const selectDiagram = (id) => {
    stepper.stop();
    setDiagramId(id);
  };

  const controlProps = {
    currentStep: Math.max(stepper.step, 0) + 1,
    totalSteps: stepper.total,
    isSimulating: stepper.active,
    isPaused: stepper.paused,
    onSimulate: stepper.simulate,
    onPrev: stepper.prev,
    onPause: stepper.pause,
    onResume: stepper.resume,
    onNext: stepper.next,
    onStop: stepper.stop,
    onReset,
    stepTimeOptions: STEP_TIME_OPTIONS,
    stepMs: stepper.stepMs,
    onSetStepMs: stepper.setStepMs,
  };

  return (
    <main className="pfj-page" data-testid="pingfederate-id-jag-page">
      <IdJagPathBar current="protocol" />
      <PageHeader className="pfj-header" eyebrow="UC40 · Enterprise-managed MCP authorization" title={diagram.title} summary={diagram.intro}
        actions={<>        <div className="pfj-provider-badge"><span /> {diagram.badge}</div>
        </>} />

      <nav className="pfj-diagram-tabs" role="tablist" aria-label="Architecture views">
        {Object.entries(DIAGRAMS).map(([id, item]) => (
          <button key={id} type="button" role="tab" aria-label={`${item.label}, ${item.exchangeSummary}`} aria-selected={diagramId === id} className={diagramId === id ? "is-current" : ""} onClick={() => selectDiagram(id)}>
            <span>{item.label}</span>
            <small>{item.exchangeSummary}</small>
          </button>
        ))}
      </nav>

      <div className="pfj-toolbar" role="group" aria-label="Top diagram controls">
        <DiagramControls {...controlProps} />
      </div>

      <section className="pfj-diagram" aria-label={`Interactive ${diagram.label}`}>
        <p className="pfj-lanes">{diagram.lanes.map((lane) => <span key={lane}>{lane}</span>)}</p>
        <StaticFlowDiagram
          key={diagramId}
          NODES={NODES}
          EDGES={EDGES}
          GROUPS={GROUPS}
          stepper={stepper}
          steps={STEPS}
          pingStyle
          testId={`pfj-${diagramId}`}
          ariaLabel={`Interactive ${diagram.label}`}
        />
        <div className="pfj-chain" aria-label="Token chain">
          {diagram.chain.map((name, index) => <React.Fragment key={name}>{index > 0 && <b aria-hidden="true">→</b>}<span>{name}</span></React.Fragment>)}
        </div>
      </section>

      <section className="pfj-guide" aria-live="polite">
        <div className="pfj-guide__copy">
          <span className="pfj-step-count">{String(guideIndex + 1).padStart(2, "0")} / {String(diagram.steps.length).padStart(2, "0")}</span>
          <div><h2>{step.title}</h2><p>{step.detail}</p></div>
        </div>
        <nav className="pfj-step-nav" aria-label={`${diagram.label} steps`}>
          <button type="button" onClick={() => goToGuide(Math.max(guideIndex - 1, 0))} disabled={guideIndex === 0} aria-label="Previous step">‹</button>
          {diagram.steps.map((item, index) => (
            <button key={item.title} type="button" className={index === guideIndex ? "is-current" : ""} onClick={() => goToGuide(index)} aria-label={`Step ${index + 1}: ${item.title}`} aria-current={index === guideIndex ? "step" : undefined}>{index + 1}</button>
          ))}
          <button type="button" onClick={() => goToGuide(Math.min(guideIndex + 1, diagram.steps.length - 1))} disabled={guideIndex === diagram.steps.length - 1} aria-label="Next step">›</button>
        </nav>
      </section>

      <div className="pfj-toolbar pfj-toolbar--mid" role="group" aria-label="Mid-page diagram controls">
        <span className="pfj-toolbar__label">Playback controls</span>
        <DiagramControls {...controlProps} />
      </div>

      <ProtocolDetails flow={diagram.flow} edges={step.edges} learning={diagram.learning} />

      {diagramId === "jag" && <p className="pfj-footnote">Two distinct servers validate two distinct credentials: PingFederate validates the upstream token during Side 1; the downstream MCP authorization server validates the ID-JAG during Side 2. The returned MCP access token is used for the resource call.</p>}
      <section className="pfj-calls" aria-labelledby="pfj-calls-h" data-testid="pfj-calls">
        <h2 id="pfj-calls-h">Every call, in order</h2>
        <p className="pfj-intro">The diagram above groups the flow into steps. This lists all 19 calls, from sign-in to the banking API.</p>
        <IdJagCallPlayer />
      </section>
    </main>
  );
}
