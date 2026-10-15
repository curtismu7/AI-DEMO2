import React, { useEffect, useState } from 'react';
import AgentClientSkin from '../components/AgentClientSkin';
import apiClient from '../services/apiClient';
import { governanceFrom } from '../utils/dotGovernance';
import PageAgentModeToggle, { usePageAgentMode } from '../components/shared/PageAgentModeToggle';
import { dotSuggestions } from '../config/dotSuggestions';
import { useVertical } from '../vertical/useVertical';
import './WorkloadAgentsPage.css';

const GREETINGS = {
  privilege: "Hello! I'm your Privilege AI assistant. I can access your MileagePlus account and help manage your upcoming flights.",
  claude: "Hello! I'm Claude. I can help you manage your airline reservations and loyalty points.",
  gpt: "How can I help you today? I can access your United MileagePlus account to check your points balance and manage upgrades.",
  gemini: "Hi! I'm Gemini. I can help with your United Airlines account — checking flights, seat availability, and loyalty points.",
  dot: "Hi, I'm Dot — your always-on agent. I remember your preferences as we work, and every tool I use is governed by your identity provider. Tell me how you like things done.",
};

export default function PersonalAgentClientWindow() {
  const [agentMode, setAgentMode] = usePageAgentMode('personal-agent');
  const params = new URLSearchParams(window.location.search);
  const skin = params.get('skin') || 'privilege';
  const theme = params.get('theme') || 'dark';
  const routeId = params.get('useCase');
  const vertical = params.get('vertical');
  const workloadRoute = vertical && ['UC38', 'UC44'].includes(routeId);
  const { activeId, pageManifest } = useVertical();
  const [scenario, setScenario] = useState(null);
  const [runState, setRunState] = useState({ status: 'idle', text: '' });

  useEffect(() => {
    if (!workloadRoute) return;
    let live = true;
    apiClient.get(`/api/use-cases/${routeId}?vertical=${encodeURIComponent(vertical)}`)
      .then(({ data }) => { if (live) setScenario(data.useCase); })
      .catch(() => { if (live) setRunState({ status: 'error', text: 'The catalog action could not be loaded.' }); });
    return () => { live = false; };
  }, [workloadRoute, routeId, vertical]);

  function handleWorkloadRun() {
    if (!scenario?.runPrompt || !scenario?.useCaseId) return;
    setRunState({ status: 'running', text: '' });
    fetch('/api/agent/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ prompt: scenario.runPrompt, vertical, useCaseId: scenario.useCaseId, agentMode }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
      return data;
    }).then((data) => setRunState({ status: 'complete', text: data.reply || 'The workload agent completed the request.' }))
      .catch((error) => setRunState({ status: 'error', text: error.message || 'The workload agent could not complete the request.' }));
  }

  const [messages, setMessages] = useState([
    { role: 'agent', text: GREETINGS[skin] || GREETINGS.privilege },
  ]);

  function handleSend(text) {
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setMessages((prev) => [...prev, { role: 'agent', typing: true, text: '' }]);
    fetch('/api/agent/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      // Dot follows the active vertical; the other skins are the United airline demo.
      body: JSON.stringify({ prompt: text, vertical: skin === 'dot' ? (activeId || undefined) : 'airlines', agentMode }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
        return data;
      })
      .then((data) => setMessages((prev) => [
        ...prev.filter((m) => !m.typing),
        { role: 'agent', text: data.reply || 'The digital assistant completed the request.', dotMemories: data.dotMemories, governance: governanceFrom(data) },
      ]))
      .catch((error) => setMessages((prev) => [
        ...prev.filter((m) => !m.typing),
        { role: 'agent', text: error.message || 'The digital assistant could not complete the request.' },
      ]));
  }

  if (workloadRoute) return (
    <main className="workload-agents workload-agents__run">
      <h1>{scenario?.title || 'Loading workload action…'}</h1>
      <p>{routeId} · {vertical} · {scenario?.primaryTool || 'Loading action'}</p>
      <p>{routeId === 'UC38' ? 'Customer MFA is checked before this protected write.' : 'The registered agent reads customer-owned data on behalf of the signed-in customer.'}</p>
      <p>{scenario?.runPrompt || 'Loading catalog prompt'}</p>
      <button type="button" disabled={!scenario || runState.status === 'running'} onClick={handleWorkloadRun}>Run {routeId} action</button>
      <p role="status">{runState.status === 'running' ? 'Running the selected action…' : runState.text || 'Ready to run the selected catalog action.'}</p>
    </main>
  );

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Live badge bar */}
      <div style={{ background: 'rgba(34,197,94,0.1)', borderBottom: '1px solid rgba(34,197,94,0.2)', padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--th-status-success-text)', flexShrink: 0 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', animation: 'blink 1.5s infinite' }} />
        Live — token events streaming to main window
        <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}`}</style>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 12px' }}>
        <PageAgentModeToggle mode={agentMode} onChange={setAgentMode} />
      </div>
      <AgentClientSkin
        skin={skin}
        theme={theme}
        messages={messages}
        onSend={handleSend}
        suggestions={skin === 'dot' ? dotSuggestions(pageManifest) : []}
        showPopOutButton={false}
        onPopOut={null}
      />
    </div>
  );
}
