import React, { useState } from 'react';
import { notifySuccess, notifyError } from '../utils/appToast';
import JsonHighlight from './shared/JsonHighlight';

// JWTs use base64url (-/_), but atob() only accepts standard base64 (+//).
function base64UrlToBase64(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return padded + '='.repeat((4 - (padded.length % 4)) % 4);
}

function decodeJwt(token) {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(base64UrlToBase64(parts[1])));
    return payload;
  } catch (err) {
    return null;
  }
}

export function TokenInspectModal({ exchange, isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('decoded');

  if (!isOpen || !exchange) return null;

  const subjectDecoded = decodeJwt(exchange.subjectToken);
  const resultDecoded = decodeJwt(exchange.resultToken);

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess(`Copied ${label} to clipboard`);
    } catch (err) {
      notifyError(`Failed to copy ${label}`);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999
    }}>
      <div style={{
        background: 'white',
        borderRadius: 8,
        padding: 20,
        maxWidth: 600,
        maxHeight: '80vh',
        overflow: 'auto',
        boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
      }}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 8px 0' }}>Inspect Token Exchange</h3>
          <div style={{ fontSize: '0.9rem', color: '#666' }}>
            <div>Type: {exchange.exchangeType}</div>
            <div>Timestamp: {exchange.timestamp}</div>
            {exchange.metadata?.aud && <div>Audience: {exchange.metadata.aud}</div>}
            {exchange.metadata?.sub && <div>Subject: {exchange.metadata.sub}</div>}
            {exchange.metadata?.scope && <div>Scope: {exchange.metadata.scope}</div>}
          </div>
        </div>

        <div style={{ marginBottom: 12, display: 'flex', gap: 8, borderBottom: '1px solid #e5e7eb' }}>
          <button onClick={() => setActiveTab('decoded')} style={{
            padding: '8px 12px',
            border: 'none',
            background: activeTab === 'decoded' ? '#3b82f6' : 'transparent',
            color: activeTab === 'decoded' ? 'white' : '#666',
            cursor: 'pointer',
            fontWeight: activeTab === 'decoded' ? 600 : 400
          }}>Decoded</button>
          <button onClick={() => setActiveTab('raw')} style={{
            padding: '8px 12px',
            border: 'none',
            background: activeTab === 'raw' ? '#3b82f6' : 'transparent',
            color: activeTab === 'raw' ? 'white' : '#666',
            cursor: 'pointer',
            fontWeight: activeTab === 'raw' ? 600 : 400
          }}>Raw</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Subject Token:</h4>
          <pre style={{ background: '#f9fafb', padding: 12, borderRadius: 4, overflow: 'auto', fontSize: '0.8rem', maxHeight: 150, margin: 0 }}>
            {activeTab === 'decoded'
              ? (subjectDecoded ? <JsonHighlight value={subjectDecoded} /> : '(Unable to decode)')
              : (exchange.subjectToken || '(none)')}
          </pre>
          <button onClick={() => copyToClipboard(exchange.subjectToken, 'subject token')} style={{
            marginTop: 8,
            padding: '6px 12px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: '0.875rem'
          }}>Copy Subject Token</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Result Token:</h4>
          <pre style={{ background: '#f9fafb', padding: 12, borderRadius: 4, overflow: 'auto', fontSize: '0.8rem', maxHeight: 150, margin: 0 }}>
            {activeTab === 'decoded'
              ? (resultDecoded ? <JsonHighlight value={resultDecoded} /> : '(Unable to decode)')
              : (exchange.resultToken || '(none)')}
          </pre>
          <button onClick={() => copyToClipboard(exchange.resultToken, 'result token')} style={{
            marginTop: 8,
            padding: '6px 12px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: '0.875rem'
          }}>Copy Result Token</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{
            padding: '8px 16px',
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500
          }}>Close</button>
        </div>
      </div>
    </div>
  );
}
