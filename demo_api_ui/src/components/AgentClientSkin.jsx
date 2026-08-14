import React, { useRef, useEffect, useState } from 'react';

const SKIN_CONFIG = {
  privilege: {
    title: 'Privilege AI Agent',
    subtitle: 'Connected to Airlines MCP · MFA verified',
    placeholder: 'Message Privilege AI…',
    hint: 'Ping Privilege · Delegated token active · Airlines vertical',
    accentColor: '#0073e6',
    logo: () => (
      <div style={{ width: 24, height: 24, background: '#0073e6', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 12 }}>P</div>
    ),
    dark: {
      bg: '#0a0e1a', headerBg: '#0d1526', headerBorder: '#1a2540',
      titleColor: '#c8d6f0', subtitleColor: '#4a6080',
      agentBubbleBg: '#0d1e38', agentBubbleColor: '#c8d6f0',
      userBubbleBg: '#0073e6', userBubbleColor: '#ffffff',
      inputAreaBg: '#0a0e1a', inputBorder: '#1a2540', inputColor: '#c8d6f0',
    },
    light: {
      bg: '#f0f4fa', headerBg: '#dde8f7', headerBorder: '#b8cfe8',
      titleColor: '#0d2a52', subtitleColor: '#6a8ab0',
      agentBubbleBg: '#e0eaf8', agentBubbleColor: '#0d2a52',
      userBubbleBg: '#0073e6', userBubbleColor: '#ffffff',
      inputAreaBg: '#f0f4fa', inputBorder: '#b8cfe8', inputColor: '#0d2a52',
    },
  },
  claude: {
    title: 'Claude',
    subtitle: 'claude-sonnet-4-5',
    placeholder: 'Message Claude…',
    hint: 'Anthropic Claude · Delegated token active',
    accentColor: '#d97941',
    logo: () => (
      <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#d97941,#c0612a)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 12 }}>C</div>
    ),
    dark: {
      bg: '#1a1209', headerBg: '#1f1610', headerBorder: '#2d200f',
      titleColor: '#e8d5bc', subtitleColor: '#7a5a38',
      agentBubbleBg: '#2a1c0a', agentBubbleColor: '#e8d5bc',
      userBubbleBg: 'rgba(217,121,65,0.2)', userBubbleColor: '#e8d5bc',
      inputAreaBg: '#1a1209', inputBorder: '#2d200f', inputColor: '#e8d5bc',
    },
    light: {
      bg: '#fffaf5', headerBg: '#fdf0e3', headerBorder: '#f0d4b0',
      titleColor: '#6b2e0a', subtitleColor: '#a0601a',
      agentBubbleBg: '#fce9d6', agentBubbleColor: '#3d1a06',
      userBubbleBg: 'rgba(217,121,65,0.12)', userBubbleColor: '#6b2e0a',
      inputAreaBg: '#fffaf5', inputBorder: '#f0d4b0', inputColor: '#6b2e0a',
    },
  },
  gpt: {
    title: 'ChatGPT',
    subtitle: 'GPT-4o',
    placeholder: 'Message ChatGPT…',
    hint: 'OpenAI ChatGPT · Delegated token active',
    accentColor: '#10a37f',
    logo: () => (
      <div style={{ width: 24, height: 24, borderRadius: 6, background: '#10a37f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 12 }}>G</div>
    ),
    dark: {
      bg: '#212121', headerBg: '#2d2d2d', headerBorder: '#3d3d3d',
      titleColor: '#ececec', subtitleColor: '#888888',
      agentBubbleBg: '#171717', agentBubbleColor: '#ececec',
      userBubbleBg: '#2d2d2d', userBubbleColor: '#ececec',
      inputAreaBg: '#212121', inputBorder: '#3d3d3d', inputColor: '#ececec',
    },
    light: {
      bg: '#f9fafb', headerBg: '#edf2ef', headerBorder: '#c5ddd5',
      titleColor: '#111111', subtitleColor: '#555555',
      agentBubbleBg: '#f9fafb', agentBubbleColor: '#111111',
      userBubbleBg: '#e8f0ec', userBubbleColor: '#111111',
      inputAreaBg: '#f9fafb', inputBorder: '#c5ddd5', inputColor: '#111111',
    },
  },
  gemini: {
    title: 'Gemini',
    subtitle: 'Gemini 2.5 Pro',
    placeholder: 'Ask Gemini…',
    hint: 'Google Gemini · Delegated token active',
    accentColor: '#4285f4',
    logo: () => (
      <div style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg,#4285f4,#ea4335,#fbbc05,#34a853)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 11 }}>G</div>
    ),
    dark: {
      bg: '#1c1c2e', headerBg: '#202030', headerBorder: '#2a2a40',
      titleColor: '#e8e8ff', subtitleColor: '#5b5b80',
      agentBubbleBg: '#242438', agentBubbleColor: '#e8e8ff',
      userBubbleBg: 'rgba(66,133,244,0.15)', userBubbleColor: '#e8e8ff',
      inputAreaBg: '#1c1c2e', inputBorder: '#2a2a40', inputColor: '#e8e8ff',
    },
    light: {
      bg: '#f5f5ff', headerBg: '#eaeaf8', headerBorder: '#c8c8ef',
      titleColor: '#1a1a4a', subtitleColor: '#5555aa',
      agentBubbleBg: '#ebebf8', agentBubbleColor: '#1a1a4a',
      userBubbleBg: 'rgba(66,133,244,0.1)', userBubbleColor: '#1a1a6a',
      inputAreaBg: '#f5f5ff', inputBorder: '#c8c8ef', inputColor: '#1a1a4a',
    },
  },
};

function TypingIndicator({ color }) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '10px 14px' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 6, height: 6, borderRadius: '50%', background: color,
            animation: `typing 1.2s ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`@keyframes typing{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}`}</style>
    </div>
  );
}

export default function AgentClientSkin({ skin = 'privilege', theme = 'dark', messages = [], onSend, showPopOutButton = false, onPopOut }) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef(null);
  const cfg = SKIN_CONFIG[skin] || SKIN_CONFIG.privilege;
  const colors = cfg[theme] || cfg.dark;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && inputValue.trim()) {
      onSend?.(inputValue.trim());
      setInputValue('');
    }
  }

  function handleSend() {
    if (inputValue.trim()) {
      onSend?.(inputValue.trim());
      setInputValue('');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: colors.bg, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: colors.headerBg, borderBottom: `1px solid ${colors.headerBorder}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <cfg.logo />
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.titleColor }}>{cfg.title}</span>
        <span style={{ fontSize: 11, color: colors.subtitleColor, marginLeft: 'auto' }}>{cfg.subtitle}</span>
        {showPopOutButton && (
          <button
            onClick={onPopOut}
            style={{ marginLeft: 8, fontSize: 11, color: cfg.accentColor, cursor: 'pointer', border: `1px solid ${cfg.accentColor}`, borderRadius: 4, padding: '3px 8px', background: 'transparent' }}
          >
            Pop Out
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, maxWidth: '85%', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: msg.role === 'user' ? 'rgba(128,128,128,0.3)' : cfg.accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0 }}>
              {msg.role === 'user' ? 'U' : cfg.title[0]}
            </div>
            {msg.typing ? (
              <TypingIndicator color={cfg.accentColor} />
            ) : (
              <div style={{ padding: '10px 14px', borderRadius: msg.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px', background: msg.role === 'user' ? colors.userBubbleBg : colors.agentBubbleBg, color: msg.role === 'user' ? colors.userBubbleColor : colors.agentBubbleColor, fontSize: 13, lineHeight: 1.5 }}>
                {msg.text}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.inputBorder}`, background: colors.inputAreaBg, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(128,128,128,0.08)', border: '1px solid rgba(128,128,128,0.15)', borderRadius: 10, padding: '8px 12px' }}>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={cfg.placeholder}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: colors.inputColor, fontSize: 13 }}
          />
          <button onClick={handleSend} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: cfg.accentColor, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="white"><path d="M2 8l12-6-5 6 5 6-12-6z"/></svg>
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.6)', textAlign: 'center', marginTop: 6 }}>{cfg.hint}</div>
      </div>
    </div>
  );
}
