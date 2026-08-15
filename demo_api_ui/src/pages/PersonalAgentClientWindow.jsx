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
    // Simulate agent typing then response
    setMessages((prev) => [...prev, { role: 'agent', typing: true, text: '' }]);
    setTimeout(() => {
      setMessages((prev) => [
        ...prev.filter((m) => !m.typing),
        { role: 'agent', text: "Got it — I'll pass that along through the delegation chain." },
      ]);
    }, 1400);
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
