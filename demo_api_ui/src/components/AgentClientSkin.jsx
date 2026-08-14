import React, { useRef, useEffect, useState } from 'react';

function ToolUseBlock({ toolName, toolInput, colors }) {
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 12, background: colors.toolBg, border: `1px solid ${colors.toolBorder}`, borderRadius: 6, padding: '8px 12px', maxWidth: '100%', marginTop: 4 }}>
      <div style={{ color: colors.toolColor, marginBottom: toolInput && Object.keys(toolInput).length > 0 ? 6 : 0 }}>
        <span style={{ opacity: 0.65, marginRight: 4 }}>tool</span>
        <span style={{ fontWeight: 700 }}>{toolName}</span>
      </div>
      {toolInput && Object.keys(toolInput).length > 0 && (
        <div style={{ color: colors.toolResultColor, opacity: 0.9 }}>
          {Object.entries(toolInput).map(([k, v]) => (
            <div key={k} style={{ lineHeight: 1.6 }}>
              <span style={{ opacity: 0.65 }}>{k}: </span>
              {JSON.stringify(v)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolResultBlock({ toolName, data, colors }) {
  const [expanded, setExpanded] = useState(false);
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const isLong = text && text.length > 220;
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 11, background: colors.toolResultBg, border: `1px solid ${colors.toolBorder}`, borderRadius: 6, padding: '8px 12px', maxWidth: '100%', marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: colors.toolColor, opacity: 0.65, fontSize: 10 }}>result: {toolName}</span>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ fontSize: 10, color: colors.toolColor, background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', opacity: 0.8 }}
          >
            {expanded ? 'collapse' : 'expand'}
          </button>
        )}
      </div>
      <pre style={{ color: colors.toolResultColor, margin: 0, whiteSpace: 'pre-wrap', maxHeight: isLong && !expanded ? 80 : undefined, overflow: 'hidden', fontSize: 11, lineHeight: 1.5 }}>
        {text}
      </pre>
    </div>
  );
}

const SKIN_CONFIG = {
  privilege: {
    title: 'Privilege AI',
    subtitle: 'PingOne Authorize · Delegated Identity',
    placeholder: 'Message Privilege AI…',
    hint: 'Ping Identity · Privileged access enforced',
    accentColor: '#0073e6',
    logo: () => (
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#0073e6,#0055b0)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="white" strokeWidth="1.5" fill="none" />
          <text x="8" y="12" textAnchor="middle" fill="white" fontSize="9" fontWeight="700" fontFamily="sans-serif">P</text>
        </svg>
      </div>
    ),
    dark: {
      bg: '#0b1929', headerBg: '#0d2040', headerBorder: '#1a3560',
      titleColor: '#d8e8ff', subtitleColor: '#3a5880',
      agentBubbleBg: '#102040', agentBubbleColor: '#c8dcff',
      userBubbleBg: '#0073e6', userBubbleColor: '#ffffff',
      inputAreaBg: '#0b1929', inputBorder: '#1a3560', inputColor: '#c8dcff',
      toolBg: '#07121e', toolBorder: '#1a3560', toolColor: '#4a90d0',
      toolResultBg: '#051020', toolResultColor: '#3a78b8',
    },
    light: {
      bg: '#f5f8ff', headerBg: '#ffffff', headerBorder: '#dde8f7',
      titleColor: '#0d2a52', subtitleColor: '#5a7aa8',
      agentBubbleBg: '#ffffff', agentBubbleColor: '#0d2a52',
      userBubbleBg: '#0073e6', userBubbleColor: '#ffffff',
      inputAreaBg: '#f0f4fa', inputBorder: '#dde8f7', inputColor: '#0d2a52',
      toolBg: '#eaf0ff', toolBorder: '#c0d4f0', toolColor: '#2a60a8',
      toolResultBg: '#e0ecff', toolResultColor: '#1a4880',
    },
  },

  claude: {
    title: 'Claude',
    subtitle: 'claude-sonnet-4-5 · Anthropic',
    placeholder: 'Message Claude…',
    hint: 'Anthropic · Delegated token active',
    accentColor: '#d4603e',
    logo: () => (
      <div style={{ width: 28, height: 28, flexShrink: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          {[0,1,2,3,4,5].map((i) => (
            <rect
              key={i}
              x="12.5" y="3"
              width="3" height="9"
              rx="1.5"
              fill="#d4603e"
              transform={`rotate(${i * 60} 14 14)`}
              opacity={0.6 + i * 0.07}
            />
          ))}
        </svg>
      </div>
    ),
    dark: {
      bg: '#1e1410', headerBg: '#231810', headerBorder: '#352010',
      titleColor: '#ead6bc', subtitleColor: '#7a5a38',
      agentBubbleBg: 'transparent', agentBubbleColor: '#ead6bc',
      userBubbleBg: '#2e1e0e', userBubbleColor: '#ead6bc',
      inputAreaBg: '#1e1410', inputBorder: '#352010', inputColor: '#ead6bc',
      toolBg: '#2a1c0c', toolBorder: '#4a2e18', toolColor: '#c07848',
      toolResultBg: '#1c1408', toolResultColor: '#b06838',
    },
    light: {
      bg: '#fffdf8', headerBg: '#fffdf8', headerBorder: '#f0e6d0',
      titleColor: '#2c1a08', subtitleColor: '#906040',
      agentBubbleBg: 'transparent', agentBubbleColor: '#2c1a08',
      userBubbleBg: '#f5ece0', userBubbleColor: '#2c1a08',
      inputAreaBg: '#fffdf8', inputBorder: '#f0e6d0', inputColor: '#2c1a08',
      toolBg: '#faf0e0', toolBorder: '#e0c8a0', toolColor: '#804830',
      toolResultBg: '#f5e8d0', toolResultColor: '#603820',
    },
  },

  'claude-terminal': {
    title: 'Claude',
    subtitle: '~/terminal · claude-3-5-sonnet',
    placeholder: '> ',
    hint: '',
    accentColor: '#ffb454',
    isTerminal: true,
    logo: () => (
      <div style={{ width: 28, height: 20, fontFamily: 'monospace', fontSize: 16, color: '#ffb454', display: 'flex', alignItems: 'center', lineHeight: 1, flexShrink: 0 }}>
        {'>_'}
      </div>
    ),
    dark: {
      bg: '#0d1117', headerBg: '#0d1117', headerBorder: '#21262d',
      titleColor: '#ffb454', subtitleColor: '#484f58',
      agentBubbleBg: 'transparent', agentBubbleColor: '#c9d1d9',
      userBubbleBg: 'transparent', userBubbleColor: '#79c0ff',
      inputAreaBg: '#0d1117', inputBorder: '#21262d', inputColor: '#c9d1d9',
      toolBg: '#161b22', toolBorder: '#30363d', toolColor: '#56d364',
      toolResultBg: '#0d1117', toolResultColor: '#79c0ff',
    },
    light: {
      bg: '#0d1117', headerBg: '#0d1117', headerBorder: '#21262d',
      titleColor: '#ffb454', subtitleColor: '#484f58',
      agentBubbleBg: 'transparent', agentBubbleColor: '#c9d1d9',
      userBubbleBg: 'transparent', userBubbleColor: '#79c0ff',
      inputAreaBg: '#0d1117', inputBorder: '#21262d', inputColor: '#c9d1d9',
      toolBg: '#161b22', toolBorder: '#30363d', toolColor: '#56d364',
      toolResultBg: '#0d1117', toolResultColor: '#79c0ff',
    },
  },

  gpt: {
    title: 'ChatGPT',
    subtitle: 'GPT-4o · OpenAI',
    placeholder: 'Message ChatGPT',
    hint: 'OpenAI · Delegated token active',
    accentColor: '#10a37f',
    logo: () => (
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#10a37f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 41 41" fill="white">
          <path d="M37.532 16.87a9.963 9.963 0 0 0-.856-8.184 10.078 10.078 0 0 0-10.855-4.835 9.964 9.964 0 0 0-6.504-2.981 10.079 10.079 0 0 0-9.614 6.977 9.967 9.967 0 0 0-6.664 4.834 10.08 10.08 0 0 0 1.24 11.817 9.965 9.965 0 0 0 .856 8.185 10.079 10.079 0 0 0 10.855 4.835 9.965 9.965 0 0 0 6.504 2.98 10.079 10.079 0 0 0 9.617-6.981 9.967 9.967 0 0 0 6.663-4.834 10.079 10.079 0 0 0-1.243-11.813zm-14.965 20.878a7.474 7.474 0 0 1-4.799-1.735c.061-.033.168-.091.237-.134l7.964-4.6a1.294 1.294 0 0 0 .655-1.134V19.054l3.366 1.944a.12.12 0 0 1 .066.092v9.299a7.505 7.505 0 0 1-7.49 7.496v.003zM6.392 31.006a7.471 7.471 0 0 1-.894-5.023c.06.036.162.099.237.141l7.964 4.6a1.297 1.297 0 0 0 1.308 0l9.724-5.614v3.888a.12.12 0 0 1-.048.103l-8.051 4.649a7.504 7.504 0 0 1-10.24-2.744zm-2.402-16.186A7.469 7.469 0 0 1 8.2 10.333c0 .068-.004.19-.004.274v9.201a1.294 1.294 0 0 0 .654 1.132l9.723 5.614-3.366 1.944a.12.12 0 0 1-.114.012L7.044 23.86a7.504 7.504 0 0 1-2.747-10.24h-.307zm27.658 6.437l-9.724-5.615 3.367-1.943a.121.121 0 0 1 .114-.012l8.048 4.648a7.498 7.498 0 0 1-1.158 13.528v-9.476a1.293 1.293 0 0 0-.647-1.13zm3.35-5.043c-.059-.037-.162-.099-.236-.141l-7.965-4.6a1.298 1.298 0 0 0-1.308 0l-9.723 5.614v-3.888a.12.12 0 0 1 .048-.103l8.05-4.645a7.497 7.497 0 0 1 11.135 7.763zm-21.063 6.929l-3.367-1.944a.12.12 0 0 1-.065-.092v-9.299a7.497 7.497 0 0 1 12.293-5.756 6.94 6.94 0 0 0-.236.134l-7.965 4.6a1.294 1.294 0 0 0-.654 1.132l-.006 11.225zm1.829-3.943l4.33-2.501 4.332 2.5v4.993l-4.331 2.5-4.331-2.5V19.2z" />
        </svg>
      </div>
    ),
    dark: {
      bg: '#212121', headerBg: '#212121', headerBorder: '#2d2d2d',
      titleColor: '#ececec', subtitleColor: '#8e8ea0',
      agentBubbleBg: 'transparent', agentBubbleColor: '#ececec',
      userBubbleBg: '#2f2f2f', userBubbleColor: '#ececec',
      inputAreaBg: '#2f2f2f', inputBorder: '#3d3d3d', inputColor: '#ececec',
      toolBg: '#2a2a2a', toolBorder: '#3a3a3a', toolColor: '#10a37f',
      toolResultBg: '#1e1e1e', toolResultColor: '#ababab',
    },
    light: {
      bg: '#ffffff', headerBg: '#ffffff', headerBorder: '#e5e5e5',
      titleColor: '#0d0d0d', subtitleColor: '#6e6e80',
      agentBubbleBg: 'transparent', agentBubbleColor: '#0d0d0d',
      userBubbleBg: '#f4f4f4', userBubbleColor: '#0d0d0d',
      inputAreaBg: '#ffffff', inputBorder: '#e5e5e5', inputColor: '#0d0d0d',
      toolBg: '#f4f4f4', toolBorder: '#dcdcdc', toolColor: '#10a37f',
      toolResultBg: '#eeeeee', toolResultColor: '#444444',
    },
  },

  gemini: {
    title: 'Gemini',
    subtitle: 'Gemini 2.5 Pro · Google',
    placeholder: 'Ask Gemini anything',
    hint: 'Google Gemini · Delegated token active',
    accentColor: '#1a73e8',
    logo: () => (
      <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="24" height="24" viewBox="0 0 192 192" fill="none">
          <defs>
            <linearGradient id="gm1" x1="0" y1="0" x2="192" y2="192" gradientUnits="userSpaceOnUse">
              <stop stopColor="#4285f4" />
              <stop offset="0.5" stopColor="#1a73e8" />
              <stop offset="1" stopColor="#a142f4" />
            </linearGradient>
          </defs>
          <path d="M96 8C96 56.6 56.6 96 8 96c48.6 0 88 39.4 88 88 0-48.6 39.4-88 88-88-48.6 0-88-39.4-88-88z" fill="url(#gm1)" />
        </svg>
      </div>
    ),
    dark: {
      bg: '#1c1c2e', headerBg: '#1c1c2e', headerBorder: '#2a2a4a',
      titleColor: '#e0e0ff', subtitleColor: '#5a5a90',
      agentBubbleBg: 'transparent', agentBubbleColor: '#e0e0ff',
      userBubbleBg: '#252545', userBubbleColor: '#e0e0ff',
      inputAreaBg: '#252545', inputBorder: '#3a3a60', inputColor: '#e0e0ff',
      toolBg: '#1e1e38', toolBorder: '#3a3a60', toolColor: '#7878d8',
      toolResultBg: '#181830', toolResultColor: '#9898d8',
    },
    light: {
      bg: '#ffffff', headerBg: '#ffffff', headerBorder: '#e8e8f0',
      titleColor: '#1a1a3a', subtitleColor: '#5f6368',
      agentBubbleBg: 'transparent', agentBubbleColor: '#1a1a3a',
      userBubbleBg: '#f0f4ff', userBubbleColor: '#1a1a3a',
      inputAreaBg: '#f8f9fa', inputBorder: '#e8e8f0', inputColor: '#1a1a3a',
      toolBg: '#eef2ff', toolBorder: '#c8d0f0', toolColor: '#1a73e8',
      toolResultBg: '#e8f0ff', toolResultColor: '#3c4043',
    },
  },
};

function TypingIndicator({ color, isTerminal }) {
  if (isTerminal) {
    return (
      <span style={{ display: 'inline-block', width: 8, height: 14, background: color, animation: 'tBlink 1s step-end infinite', verticalAlign: 'text-bottom', marginLeft: 2 }}>
        <style>{`@keyframes tBlink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 4, padding: '10px 14px' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{ width: 6, height: 6, borderRadius: '50%', background: color, animation: `typing 1.2s ${i * 0.2}s infinite` }}
        />
      ))}
      <style>{`@keyframes typing{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}`}</style>
    </div>
  );
}

function renderMessage(msg, i, cfg, colors, isTerminal) {
  const isUser = msg.role === 'user';
  const type = msg.type || 'text';

  if (isTerminal) {
    const prefix = isUser ? (
      <span style={{ color: '#79c0ff', marginRight: 6, userSelect: 'none' }}>$</span>
    ) : (
      <span style={{ color: '#ffb454', marginRight: 6, userSelect: 'none' }}>{'>'}</span>
    );

    if (msg.typing) {
      return (
        <div key={i} style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6, color: colors.agentBubbleColor }}>
          {prefix}
          <TypingIndicator color={colors.agentBubbleColor} isTerminal />
        </div>
      );
    }
    if (type === 'tool_use') {
      return (
        <div key={i} style={{ fontFamily: 'monospace', fontSize: 12 }}>
          <div style={{ color: colors.toolColor }}><span style={{ opacity: 0.65, marginRight: 4 }}>tool</span>{msg.toolName}</div>
          {msg.toolInput && <pre style={{ color: colors.toolResultColor, margin: '4px 0 0 16px', whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(msg.toolInput, null, 2)}</pre>}
        </div>
      );
    }
    if (type === 'tool_result') {
      const text = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data, null, 2);
      return (
        <div key={i} style={{ fontFamily: 'monospace', fontSize: 11 }}>
          <div style={{ color: colors.toolColor, opacity: 0.65, marginBottom: 2 }}>result: {msg.toolName}</div>
          <pre style={{ color: colors.toolResultColor, margin: '0 0 0 16px', whiteSpace: 'pre-wrap' }}>{text}</pre>
        </div>
      );
    }
    return (
      <div key={i} style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6, color: isUser ? colors.userBubbleColor : colors.agentBubbleColor }}>
        {prefix}{msg.text}
      </div>
    );
  }

  // Standard bubble rendering
  if (type === 'tool_use') {
    return (
      <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
        <ToolUseBlock toolName={msg.toolName} toolInput={msg.toolInput} colors={colors} />
      </div>
    );
  }
  if (type === 'tool_result') {
    return (
      <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
        <ToolResultBlock toolName={msg.toolName} data={msg.data} colors={colors} />
      </div>
    );
  }

  return (
    <div key={i} style={{ display: 'flex', gap: 10, maxWidth: '85%', alignSelf: isUser ? 'flex-end' : 'flex-start', flexDirection: isUser ? 'row-reverse' : 'row' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: isUser ? 'rgba(128,128,128,0.25)' : cfg.accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0 }}>
        {isUser ? '👤' : cfg.title[0]}
      </div>
      {msg.typing ? (
        <TypingIndicator color={cfg.accentColor} />
      ) : (
        <div style={{ padding: '10px 14px', borderRadius: isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px', background: isUser ? colors.userBubbleBg : colors.agentBubbleBg, color: isUser ? colors.userBubbleColor : colors.agentBubbleColor, fontSize: 13, lineHeight: 1.6, maxWidth: '100%' }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

export default function AgentClientSkin({ skin = 'privilege', theme = 'dark', messages = [], onSend, showPopOutButton = false, onPopOut }) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef(null);
  const cfg = SKIN_CONFIG[skin] || SKIN_CONFIG.privilege;
  const colors = cfg[theme] || cfg.dark;
  const isTerminal = !!cfg.isTerminal;

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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: colors.bg, overflow: 'hidden', fontFamily: isTerminal ? 'monospace' : 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ background: colors.headerBg, borderBottom: `1px solid ${colors.headerBorder}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <cfg.logo />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: isTerminal ? 12 : 13, fontWeight: isTerminal ? 400 : 600, color: colors.titleColor, fontFamily: isTerminal ? 'monospace' : 'inherit' }}>
            {isTerminal ? `claude@terminal: ~` : cfg.title}
          </span>
          <span style={{ fontSize: 11, color: colors.subtitleColor }}>{cfg.subtitle}</span>
        </div>
        {showPopOutButton && (
          <button
            onClick={onPopOut}
            style={{ fontSize: 11, color: cfg.accentColor, cursor: 'pointer', border: `1px solid ${cfg.accentColor}`, borderRadius: 4, padding: '3px 8px', background: 'transparent', flexShrink: 0 }}
          >
            Pop Out
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isTerminal ? '16px 20px' : 20, display: 'flex', flexDirection: 'column', gap: isTerminal ? 8 : 16 }}>
        {messages.map((msg, i) => renderMessage(msg, i, cfg, colors, isTerminal))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 16px', borderTop: `1px solid ${colors.inputBorder}`, background: colors.inputAreaBg, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: isTerminal ? 'transparent' : 'rgba(128,128,128,0.07)', border: isTerminal ? 'none' : '1px solid rgba(128,128,128,0.15)', borderTop: isTerminal ? `1px solid ${colors.inputBorder}` : undefined, borderRadius: isTerminal ? 0 : 10, padding: isTerminal ? '4px 0' : '8px 12px' }}>
          {isTerminal && <span style={{ color: '#79c0ff', fontFamily: 'monospace', fontSize: 13, flexShrink: 0 }}>$</span>}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isTerminal ? '' : cfg.placeholder}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: colors.inputColor, fontSize: isTerminal ? 13 : 13, fontFamily: isTerminal ? 'monospace' : 'inherit' }}
          />
          {!isTerminal && (
            <button onClick={handleSend} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: cfg.accentColor, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="white"><path d="M2 8l12-6-5 6 5 6-12-6z" /></svg>
            </button>
          )}
          {isTerminal && (
            <button onClick={handleSend} style={{ fontSize: 11, color: cfg.accentColor, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', flexShrink: 0, padding: '0 4px' }}>
              [enter]
            </button>
          )}
        </div>
        {cfg.hint && (
          <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.5)', textAlign: 'center', marginTop: 5 }}>{cfg.hint}</div>
        )}
      </div>
    </div>
  );
}
