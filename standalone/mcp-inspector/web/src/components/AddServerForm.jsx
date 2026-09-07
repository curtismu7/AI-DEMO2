// components/AddServerForm.jsx — "+ Add server" inline form, adapted from
// the banking demo's archived McpInspectorPage.jsx (docs/archive/), which had
// this UI before the page was rebuilt onto InspectorShell without it. This
// standalone tool's whole point is pointing at your own MCP servers, so the
// form comes back here as a first-class feature, not an afterthought.
import React, { useState } from 'react';
import { api } from '../lib/api';

const EMPTY = {
  label: '',
  transport: 'http',
  url: '',
  authHeader: 'Authorization',
  authValue: '',
  command: '',
  argsText: '',
  envText: '',
};

export default function AddServerForm({ onAdded, onCancel }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async () => {
    setError(null);
    const { label, transport, url, authHeader, authValue, command, argsText, envText } = form;
    const body = { label: label.trim(), transport };
    if (transport === 'stdio') {
      if (!command.trim()) return setError('Command is required.');
      body.command = command.trim();
      body.args = argsText.trim() ? argsText.trim().split(/\s+/) : [];
      if (envText.trim()) {
        body.env = {};
        for (const pair of envText.split(',')) {
          const [k, ...rest] = pair.split('=');
          if (k && k.trim()) body.env[k.trim()] = rest.join('=').trim();
        }
      }
    } else {
      if (!url.trim()) return setError('Server URL is required.');
      body.url = url.trim();
      if (authHeader.trim() && authValue.trim()) {
        body.authHeader = authHeader.trim();
        body.authValue = authValue.trim();
      }
    }
    const { ok, data } = await api.post('/api/profiles', body);
    if (!ok) return setError(data?.message || 'Failed to add server.');
    setForm(EMPTY);
    onAdded(data.profile);
  };

  return (
    <div className="add-server-form">
      <input placeholder="Label (e.g. My MCP server)" value={form.label} onChange={set('label')} />
      <select value={form.transport} onChange={set('transport')}>
        <option value="http">HTTP (Streamable HTTP)</option>
        <option value="stdio">stdio (local command)</option>
      </select>
      {form.transport === 'stdio' ? (
        <>
          <input placeholder="Command (e.g. npx)" value={form.command} onChange={set('command')} />
          <input
            placeholder="Args (space-separated, e.g. -y @brave/brave-search-mcp-server --transport stdio)"
            value={form.argsText}
            onChange={set('argsText')}
            className="wide"
          />
          <input
            placeholder="Env (KEY=value, comma-separated)"
            value={form.envText}
            onChange={set('envText')}
            className="wide"
          />
        </>
      ) : (
        <>
          <input placeholder="Server URL" value={form.url} onChange={set('url')} className="wide" />
          <input placeholder="Auth header (e.g. Authorization)" value={form.authHeader} onChange={set('authHeader')} />
          <input placeholder="Auth value (e.g. Bearer xxx)" type="password" value={form.authValue} onChange={set('authValue')} />
        </>
      )}
      <button type="button" className="btn btn--primary" onClick={handleSave}>Save</button>
      <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      {error && <span className="add-server-form__error">{error}</span>}
    </div>
  );
}
