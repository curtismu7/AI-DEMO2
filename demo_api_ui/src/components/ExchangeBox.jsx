import React from 'react';

const TYPE_CONFIG = {
  'person-to-agent': { color: '#10b981', icon: '👤', label: 'Person → Agent', borderColor: '#059669' },
  'person-to-mcp': { color: '#3b82f6', icon: '👤', label: 'Person → MCP', borderColor: '#1d4ed8' },
  'agent-to-a2a': { color: '#8b5cf6', icon: '🤖', label: 'Agent → A2A', borderColor: '#6d28d9' },
  introspection: { color: '#6b7280', icon: '🔍', label: 'Introspection', borderColor: '#4b5563' },
  unknown: { color: '#d1d5db', icon: '❓', label: 'Unknown', borderColor: '#9ca3af' }
};

export function ExchangeBox({ exchange, onInspect }) {
  const config = TYPE_CONFIG[exchange.exchangeType] || TYPE_CONFIG.unknown;

  const truncateToken = (token, length = 20) => {
    return token ? token.substring(0, length) + '...' : '(none)';
  };

  const formatTime = (iso) => {
    const date = new Date(iso);
    return date.toLocaleTimeString();
  };

  return (
    <div
      onClick={() => onInspect(exchange)}
      style={{
        border: `2px solid ${config.borderColor}`,
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        backgroundColor: config.color + '11',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: '1.2rem' }}>{config.icon}</span>
        <span style={{ fontWeight: 600, color: config.borderColor, fontSize: '0.9rem' }}>
          {config.label}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#666' }}>
          {formatTime(exchange.timestamp)}
        </span>
      </div>

      <div style={{ fontSize: '0.85rem', color: '#444', fontFamily: 'monospace', marginBottom: 6 }}>
        <div>Subject: {truncateToken(exchange.subjectToken)}</div>
        <div>Result: {truncateToken(exchange.resultToken)}</div>
      </div>

      <div style={{ fontSize: '0.75rem', color: '#999', fontStyle: 'italic' }}>
        Click to inspect
      </div>
    </div>
  );
}
