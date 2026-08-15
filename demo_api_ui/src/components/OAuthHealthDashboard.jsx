import React, { useState, useEffect } from 'react';
import bffAxios from '../services/bffAxios';

export default function OAuthHealthDashboard() {
  const [healthInfo, setHealthInfo] = useState(null);
  const [checks, setChecks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkLoading, setCheckLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchHealthInfo();
  }, []);

  const fetchHealthInfo = async () => {
    try {
      const response = await bffAxios.get('/api/admin/oauth-health');
      setHealthInfo(response.data);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to fetch health info');
    } finally {
      setLoading(false);
    }
  };

  const runHealthCheck = async () => {
    setCheckLoading(true);
    try {
      const response = await bffAxios.post('/api/admin/oauth-health/check');
      setChecks(response.data);
    } catch (err) {
      console.error('Health check error:', err);
    } finally {
      setCheckLoading(false);
    }
  };

  const getHealthStatus = () => {
    if (!checks) return 'unknown';
    const passed = checks.checks.filter(c => c.status === 'pass').length;
    const total = checks.checks.length;
    if (passed === total) return 'pass';
    if (passed > 0) return 'warn';
    return 'fail';
  };

  const renderStatus = (status) => {
    const icons = { pass: '✅', fail: '❌', warn: '⚠️', unknown: '❓' };
    const colors = { pass: '#10b981', fail: '#ef4444', warn: '#f59e0b', unknown: '#6b7280' };
    return <span style={{ color: colors[status] }}>{icons[status]}</span>;
  };

  if (loading) return <div style={{ fontSize: 13, color: '#6b7280' }}>Loading...</div>;
  if (error) return <div style={{ fontSize: 13, color: '#dc2626' }}>Error: {error}</div>;
  if (!healthInfo) return null;

  return (
    <div>
      {/* Quick Status */}
      <div
        style={{
          background: '#f3f4f6',
          border: '1px solid #d1d5db',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
          {renderStatus(getHealthStatus())} OAuth Health Status
          {checks && (
            <span style={{ color: '#6b7280', fontWeight: 400, marginLeft: 8 }}>
              ({checks.checks.filter(c => c.status === 'pass').length}/{checks.checks.length} checks passing)
            </span>
          )}
        </div>
        <button
          onClick={runHealthCheck}
          disabled={checkLoading}
          style={{
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: checkLoading ? 'not-allowed' : 'pointer',
            opacity: checkLoading ? 0.6 : 1,
          }}
        >
          {checkLoading ? 'Checking...' : 'Run Health Check'}
        </button>
      </div>

      {/* OAuth Redirect URIs */}
      <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: '0 0 12px' }}>
        OAuth Redirect URIs
      </h4>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 12px' }}>
        URIs the BFF is sending to PingOne. Register these in PingOne Applications → Configuration → Redirect URIs.
      </p>
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
            marginBottom: 12,
          }}
        >
          {healthInfo.server_endpoints?.bff?.url}/api/auth/oauth/callback
        </div>

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
          {healthInfo.server_endpoints?.bff?.url}/api/auth/oauth/user/callback
        </div>
      </div>

      {/* Demo Test Accounts */}
      <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: '16px 0 12px' }}>
        Demo Test Accounts
      </h4>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 12px' }}>
        Use these to test the OAuth flow end-to-end.
      </p>
      <div style={{ marginBottom: 20 }}>
        {['admin', 'user'].map(type => (
          <div key={type} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, textTransform: 'capitalize' }}>
              <strong>{type === 'admin' ? 'Admin' : 'User'} Login</strong>
            </div>
            <div
              style={{
                background: '#ecfdf5',
                border: '1px solid #6ee7b7',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ color: '#065f46', fontFamily: 'monospace' }}>
                  {healthInfo.demo_credentials[type].username}
                </div>
                <div style={{ color: '#047857', fontSize: 11, marginTop: 2 }}>
                  password: {healthInfo.demo_credentials[type].password}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Health Check Results */}
      {checks && (
        <>
          <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: '16px 0 12px' }}>
            Health Check Results
          </h4>
          <div style={{ marginBottom: 20 }}>
            {checks.checks.map((check) => (
              <div
                key={check.name || check.label || check.id}
                style={{
                  background: check.status === 'pass' ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${check.status === 'pass' ? '#bbf7d0' : '#fecaca'}`,
                  borderRadius: 6,
                  padding: '10px 12px',
                  marginBottom: 8,
                  fontSize: 13,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {renderStatus(check.status)}
                  <strong style={{ color: '#111827' }}>{check.name}</strong>
                </div>
                {check.detail && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, marginLeft: 24 }}>
                    {check.detail}
                  </div>
                )}
              </div>
            ))}
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 12 }}>
              Last check: {new Date(checks.timestamp).toLocaleString()}
            </div>
          </div>
        </>
      )}

      {/* Server Endpoints */}
      <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: '16px 0 12px' }}>
        Server Endpoints
      </h4>
      <div style={{ marginBottom: 20 }}>
        {[
          { label: 'BFF API', url: healthInfo.server_endpoints.bff.url, port: healthInfo.server_endpoints.bff.port },
          {
            label: 'PingOne Auth',
            url: healthInfo.server_endpoints.pingone_auth.url,
            port: healthInfo.server_endpoints.pingone_auth.port,
          },
          {
            label: 'MCP Gateway',
            url: healthInfo.server_endpoints.gateway.url,
            port: healthInfo.server_endpoints.gateway.port,
          },
        ].map(({ label, url, port }) => (
          <div key={label} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              <strong>{label}</strong>
            </div>
            <div
              style={{
                background: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
                fontFamily: 'monospace',
              }}
            >
              {url}:{port}
            </div>
          </div>
        ))}
      </div>

      {/* Environment */}
      <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: '16px 0 12px' }}>
        Environment Info
      </h4>
      <div style={{ marginBottom: 20 }}>
        {[
          { label: 'PingOne Env ID', value: healthInfo.environment.pingone_environment_id || 'Not set' },
          { label: 'Region', value: healthInfo.environment.pingone_region },
          { label: 'Deployment Mode', value: healthInfo.environment.deployment_mode },
          { label: 'Active Vertical', value: healthInfo.environment.active_vertical },
        ].map(({ label, value }) => (
          <div key={label} style={{ marginBottom: 8, display: 'flex', fontSize: 13 }}>
            <div style={{ minWidth: 140, fontWeight: 600, color: '#374151' }}>{label}:</div>
            <div style={{ color: '#6b7280', fontFamily: 'monospace' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Config Source of Truth */}
      <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: '16px 0 12px' }}>
        Config Source of Truth
      </h4>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 12px' }}>
        LMDB (persisted) wins over .env fallback. Scope-topology.json is master SoT for deployment URLs.
      </p>
      <div style={{ marginBottom: 20 }}>
        {['admin_redirect_uri', 'user_redirect_uri'].map(key => (
          <div key={key} style={{ marginBottom: 16, padding: 12, background: '#f9fafb', borderRadius: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
              {key === 'admin_redirect_uri' ? 'Admin Redirect URI' : 'User Redirect URI'}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
              <strong>LMDB (active):</strong>{' '}
              <code style={{ background: '#fff', padding: '2px 4px', borderRadius: 2 }}>
                {healthInfo.config_sources[key].lmdb || '(empty)'}
              </code>
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              <strong>.env (fallback):</strong>{' '}
              <code style={{ background: '#fff', padding: '2px 4px', borderRadius: 2 }}>
                {healthInfo.config_sources[key].env || '(not set)'}
              </code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
