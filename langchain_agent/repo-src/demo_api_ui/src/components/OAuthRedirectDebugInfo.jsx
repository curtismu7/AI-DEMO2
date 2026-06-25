import React, { useState, useEffect } from 'react';
import bffAxios from '../services/bffAxios';

export default function OAuthRedirectDebugInfo() {
  const [debugInfo, setDebugInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchDebugInfo = async () => {
      try {
        const response = await bffAxios.get('/api/auth/oauth/redirect-info');
        setDebugInfo(response.data);
      } catch (err) {
        setError(err.message || 'Failed to fetch redirect info');
      } finally {
        setLoading(false);
      }
    };
    fetchDebugInfo();
  }, []);

  if (loading) return <div style={{ fontSize: 13, color: '#6b7280' }}>Loading...</div>;
  if (error) return <div style={{ fontSize: 13, color: '#dc2626' }}>Error: {error}</div>;
  if (!debugInfo) return null;

  return (
    <div>
      <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: '0 0 12px' }}>
        What This BFF Is Sending
      </h4>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
          <strong>Admin Redirect URI</strong>
        </div>
        <div
          style={{
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 12,
            fontFamily: 'monospace',
            wordBreak: 'break-all',
            color: '#111827',
          }}
        >
          {debugInfo.adminRedirectUri}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
          <strong>User Redirect URI</strong>
        </div>
        <div
          style={{
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 12,
            fontFamily: 'monospace',
            wordBreak: 'break-all',
            color: '#111827',
          }}
        >
          {debugInfo.userRedirectUri}
        </div>
      </div>

      <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: '16px 0 12px' }}>
        To Register in PingOne
      </h4>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 12px' }}>
        Copy the URIs above into PingOne Applications → [App Name] → Configuration → Redirect URIs
      </p>
      {debugInfo.pingOneRegisterThese?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {debugInfo.pingOneRegisterThese.map((uri, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div
                style={{
                  background: '#ecfdf5',
                  border: '1px solid #6ee7b7',
                  borderRadius: 6,
                  padding: '10px 12px',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  color: '#065f46',
                }}
              >
                {uri}
              </div>
            </div>
          ))}
        </div>
      )}

      {debugInfo.instructions?.steps && (
        <>
          <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: '16px 0 12px' }}>
            Setup Steps
          </h4>
          <ol style={{ fontSize: 13, color: '#6b7280', margin: 0, paddingLeft: 20 }}>
            {debugInfo.instructions.steps.map((step, i) => (
              <li key={i} style={{ marginBottom: 8 }}>
                {step}
              </li>
            ))}
          </ol>
        </>
      )}

      {debugInfo.adminClientId && (
        <div style={{ marginTop: 20, padding: 12, background: '#f0f9ff', borderRadius: 6, fontSize: 13 }}>
          <strong style={{ color: '#0369a1' }}>Admin App Client ID:</strong> {debugInfo.adminClientId.slice(0, 12)}...
        </div>
      )}

      {debugInfo.userClientId && (
        <div style={{ marginTop: 8, padding: 12, background: '#f0f9ff', borderRadius: 6, fontSize: 13 }}>
          <strong style={{ color: '#0369a1' }}>User App Client ID:</strong> {debugInfo.userClientId.slice(0, 12)}...
        </div>
      )}
    </div>
  );
}
