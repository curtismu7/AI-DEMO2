import { useMemo, useState } from "react";
import DraggableModal from "./DraggableModal";
import { useThemeOptional } from "../context/ThemeContext";
import MermaidFlowDiagram from "./oauthVisualizer/MermaidFlowDiagram";
import OAuthVisualizerDetails from "./oauthVisualizer/OAuthVisualizerDetails";
import { OAUTH_VISUALIZER_FLOWS, createInitialRun, getStepStatus, OAUTH_VISUALIZER_STORAGE_KEY } from "./oauthVisualizer/oauthVisualizerModel";
import "./OAuthVisualizerPanel.css";

function readConfig() {
  try { return JSON.parse(localStorage.getItem(OAUTH_VISUALIZER_STORAGE_KEY) || "{}"); } catch { return {}; }
}

function writeConfig(config) {
  try { localStorage.setItem(OAUTH_VISUALIZER_STORAGE_KEY, JSON.stringify(config)); } catch {}
}

export default function OAuthVisualizerPanel({ embedded = false, isOpen = false, onClose = () => {}, onOpenPopout }) {
  const { darkMode, setDarkMode } = useThemeOptional();
  const [config, setConfig] = useState(readConfig);
  const [flowId, setFlowId] = useState(OAUTH_VISUALIZER_FLOWS[0].id);
  const flow = useMemo(() => OAUTH_VISUALIZER_FLOWS.find((item) => item.id === flowId) || OAUTH_VISUALIZER_FLOWS[0], [flowId]);
  const [run, setRun] = useState(() => createInitialRun(flow));
  const [fontScale, setFontScale] = useState(1);
  const [details, setDetails] = useState(null);

  function selectFlow(nextId) {
    const nextFlow = OAUTH_VISUALIZER_FLOWS.find((item) => item.id === nextId) || flow;
    setFlowId(nextId);
    setRun(createInitialRun(nextFlow));
    setDetails(null);
  }

  function reset() {
    setRun(createInitialRun(flow));
    setDetails(null);
  }

  function inspect(index) {
    const name = flow.steps[index];
    setRun((current) => ({ ...current, selectedStepId: name }));
    setDetails({ title: name, notes: "Preview this step, or run the flow to capture its live request and response." });
  }

  async function runFlow() {
    const next = { ...createInitialRun(flow), status: "running", selectedStepId: flow.steps[0], activeStepId: flow.steps[0] };
    setRun(next);
    for (let index = 0; index < flow.steps.length; index += 1) {
      const stepId = flow.steps[index];
      setRun((current) => ({ ...current, activeStepId: stepId, selectedStepId: stepId }));
      let detail = {
        title: stepId,
        request: { method: index === 0 ? "POST" : "GET", url: config.tokenEndpoint || "Configure an endpoint to execute this request" },
        response: { status: 200, body: { flow: flow.name, step: stepId, preview: true } },
        notes: "Configure a token endpoint and client ID to execute the supported token request; other steps remain safe protocol previews until their browser redirect inputs are configured.",
      };
      if (index === 0 && flow.id === "client-credentials" && config.tokenEndpoint && config.clientId) {
        try {
          const body = new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, ...(config.scope ? { scope: config.scope } : {}) });
          const response = await fetch(config.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
          const responseBody = await response.json().catch(() => ({}));
          detail = { ...detail, response: { status: response.status, body: responseBody }, notes: response.ok ? "Live browser request completed." : "The authorization server returned an error." };
          if (!response.ok) detail.error = responseBody.error_description || responseBody.error || `HTTP ${response.status}`;
        } catch (error) {
          detail = { ...detail, error: error?.message || "The browser request could not be completed." };
        }
      }
      setDetails(detail);
      await new Promise((resolve) => setTimeout(resolve, 280));
      setRun((current) => ({ ...current, completed: detail.error ? current.completed : [...current.completed, stepId], activeStepId: detail.error || index === flow.steps.length - 1 ? null : flow.steps[index + 1], status: detail.error ? "error" : index === flow.steps.length - 1 ? "complete" : "running", error: detail.error ? { stepId, message: detail.error } : null }));
      if (detail.error) return;
    }
  }

  const body = (
    <section className={`dm-scroll ov-panel ov-font-${fontScale}`} aria-label="OAuth Visualizer">
      <header className="ov-header">
        <div><h2>OAuth Visualizer</h2><p>Explore grant types and token exchange step by step.</p></div>
        <div className="ov-controls">
          <button type="button" onClick={() => setFontScale((value) => Math.max(0, value - 1))} aria-label="Decrease visualizer font size">A−</button>
          <span aria-live="polite">{fontScale === 0 ? "Small" : fontScale === 1 ? "Standard" : "Large"}</span>
          <button type="button" onClick={() => setFontScale((value) => Math.min(2, value + 1))} aria-label="Increase visualizer font size">A+</button>
          <button type="button" onClick={() => setDarkMode(!darkMode)} aria-label={darkMode ? "Use light mode" : "Use dark mode"}>{darkMode ? "☀️" : "🌙"}</button>
          {!embedded && <button type="button" onClick={onClose} aria-label="Close OAuth Visualizer">✕</button>}
        </div>
      </header>
      <div className="ov-config-row">
        <label htmlFor={`ov-flow-${embedded ? "embedded" : "popout"}`}>Flow</label>
        <select id={`ov-flow-${embedded ? "embedded" : "popout"}`} value={flowId} onChange={(event) => selectFlow(event.target.value)}>
          {OAUTH_VISUALIZER_FLOWS.map((item) => <option key={item.id} value={item.id}>{item.section}: {item.name}</option>)}
        </select>
        <label htmlFor={`ov-endpoint-${embedded ? "embedded" : "popout"}`}>Token endpoint</label>
        <input id={`ov-endpoint-${embedded ? "embedded" : "popout"}`} value={config.tokenEndpoint || ""} placeholder="https://…/token" onChange={(event) => { const next = { ...config, tokenEndpoint: event.target.value }; setConfig(next); writeConfig(next); }} />
        <label htmlFor={`ov-client-${embedded ? "embedded" : "popout"}`}>Client ID</label>
        <input id={`ov-client-${embedded ? "embedded" : "popout"}`} value={config.clientId || ""} placeholder="client ID" onChange={(event) => { const next = { ...config, clientId: event.target.value }; setConfig(next); writeConfig(next); }} />
        <button type="button" className="ov-primary" onClick={runFlow} disabled={run.status === "running"}>{run.status === "running" ? "Running…" : "Run flow"}</button>
        <button type="button" onClick={reset}>Start over</button>
        {onOpenPopout && <button type="button" onClick={onOpenPopout}>🪟 Pop out</button>}
      </div>
      <div className="ov-flow-meta"><strong>{flow.name}</strong><span>{flow.description}</span><a href={`https://datatracker.ietf.org/doc/html/${flow.rfcRef?.split(" ")[0].toLowerCase()}`} target="_blank" rel="noreferrer">{flow.rfcRef}</a></div>
      <div className="ov-workspace">
        <div className="ov-diagram-pane"><MermaidFlowDiagram flow={flow} activeStepIndex={Math.max(0, flow.steps.indexOf(run.activeStepId || run.selectedStepId))} darkMode={darkMode} /></div>
        <div className="ov-steps" aria-label="OAuth Visualizer steps">
          {flow.steps.map((step, index) => { const status = getStepStatus(run, step); return <button type="button" key={step} className={`ov-step ov-step-${status}`} onClick={() => inspect(index)} aria-current={run.activeStepId === step ? "step" : undefined}><span>{index + 1}</span><strong>{step}</strong><small>{status}</small></button>; })}
        </div>
      </div>
      <OAuthVisualizerDetails detail={details} />
    </section>
  );

  if (embedded) return body;
  return <DraggableModal isOpen={isOpen} onClose={onClose} title="OAuth Visualizer" className="ov-modal" defaultWidth={980} defaultHeight={720} minWidth={620} minHeight={420} storageKey="oauth-visualizer-modal" footer={null} singletonKey="oauth-visualizer">{body}</DraggableModal>;
}
