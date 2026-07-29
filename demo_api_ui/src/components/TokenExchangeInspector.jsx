import React, { useState, useEffect } from 'react';
import { useTokenChainSSE } from '../hooks/useTokenChainSSE';
import { ExchangeBox } from './ExchangeBox';
import { TokenInspectModal } from './TokenInspectModal';

export function TokenExchangeInspector({ maxHistory = 50, onLogError, className, style }) {
  const { exchanges, error, isConnected } = useTokenChainSSE(maxHistory);
  const [inspectedExchange, setInspectedExchange] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (exchanges.length === 0) return;

    const latestExchange = exchanges[0];
    const logEntry = {
      timestamp: latestExchange.timestamp,
      exchangeType: latestExchange.exchangeType,
      subjectToken: latestExchange.subjectToken,
      resultToken: latestExchange.resultToken,
      metadata: latestExchange.metadata,
      sessionId: (typeof window !== 'undefined' && window.sessionStorage?.getItem('sessionId')) || 'unknown'
    };

    fetch('/api/token-exchanges/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEntry)
    }).catch((err) => {
      console.error('Failed to log token exchange:', err);
      if (onLogError) onLogError(err);
    });
  }, [exchanges, onLogError]);

  const handleInspect = (exchange) => {
    setInspectedExchange(exchange);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setInspectedExchange(null);
  };

  return (
    <div className={className} style={{ ...style, maxWidth: '100%', overflow: 'auto' }}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Token Exchanges</h3>
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: isConnected ? '#10b981' : '#ef4444'
          }}
          title={isConnected ? 'Connected' : 'Disconnected'}
        />
        <span style={{ fontSize: '0.8rem', color: '#666' }}>
          {exchanges.length} exchange{exchanges.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 4, padding: 8, marginBottom: 12, fontSize: '0.875rem', color: '#991b1b' }}>
          ❌ SSE Error: {error.message}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {exchanges.length === 0 ? (
          <div style={{ color: '#999', fontSize: '0.9rem', textAlign: 'center', padding: 20 }}>
            Waiting for token exchanges...
          </div>
        ) : (
          exchanges.map((exchange) => (
            <ExchangeBox key={exchange.id} exchange={exchange} onInspect={handleInspect} />
          ))
        )}
      </div>

      <TokenInspectModal exchange={inspectedExchange} isOpen={isModalOpen} onClose={handleCloseModal} />
    </div>
  );
}
