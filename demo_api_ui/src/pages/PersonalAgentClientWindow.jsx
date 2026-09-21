import React, { useState } from 'react';
import AgentClientSkin from '../components/AgentClientSkin';

const GREETINGS = {
  privilege: "Hello! I'm your Privilege AI assistant. I can access your MileagePlus account and help manage your upcoming flights.",
  claude: "Hello! I'm Claude. I can help you manage your airline reservations and loyalty points.",
  gpt: "How can I help you today? I can access your United MileagePlus account to check your points balance and manage upgrades.",
  gemini: "Hi! I'm Gemini. I can help with your United Airlines account — checking flights, seat availability, and loyalty points.",
};

export default function PersonalAgentClientWindow() {
  const params = new URLSearchParams(window.location.search);
  const skin = params.get('skin') || 'privilege';
  const theme = params.get('theme') || 'dark';

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
      body: JSON.stringify({ prompt: text, vertical: 'airlines', useCaseId: 'workload-digital-assistant-obo' }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
        return data;
      })
      .then((data) => setMessages((prev) => [
        ...prev.filter((m) => !m.typing),
        { role: 'agent', text: data.reply || 'The digital assistant completed the request.' },
      ]))
      .catch((error) => setMessages((prev) => [
        ...prev.filter((m) => !m.typing),
        { role: 'agent', text: error.message || 'The digital assistant could not complete the request.' },
      ]));
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Live badge bar */}
      <div style={{ background: 'rgba(34,197,94,0.1)', borderBottom: '1px solid rgba(34,197,94,0.2)', padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#22c55e', flexShrink: 0 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', animation: 'blink 1.5s infinite' }} />
        Live — token events streaming to main window
        <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}`}</style>
      </div>
      <AgentClientSkin
        skin={skin}
        theme={theme}
        messages={messages}
        onSend={handleSend}
        showPopOutButton={false}
        onPopOut={null}
      />
    </div>
  );
}
