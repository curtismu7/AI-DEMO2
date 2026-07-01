import React, { useState, useEffect, useCallback, useRef } from 'react';
import Monaco from '@monaco-editor/react';
import apiClient from '../services/apiClient';
import { notifyError, notifySuccess, notifyWarning } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import './AgentGatewayConfigEditor.css';

const API = '/api/admin/agent-gateway';

// scope-topology also feeds the BFF (configStore reads it at startup), so its
// restart hits both containers; config/admin only need the gateway.
function restartTargetsForType(type) {
  if (type === 'scope-topology') return ['ping-gateway', 'bff'];
  if (type === 'ig-config' || type === 'ig-admin') return ['ping-gateway'];
  return [];
}

export default function AgentGatewayConfigEditor() {
  const [files, setFiles] = useState([]);
  const [restartCaps, setRestartCaps] = useState({ enabled: true, socket: false });
  const [selectedId, setSelectedId] = useState(null);
  const [meta, setMeta] = useState(null);          // { type, reloadMode, label }
  const [editorValue, setEditorValue] = useState('');
  const [baseline, setBaseline] = useState('');    // last-loaded raw (revert + dirty)
  const [errors, setErrors] = useState([]);        // [{ level, path, message, line?, col? }]
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(null);      // save response .reload
  const [restarting, setRestarting] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);

  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const debounceRef = useRef(null);

  const dirty = editorValue !== baseline;
  const hasErrors = errors.some((e) => e.level === 'error');

  // --- load file list -------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const { data } = await apiClient.get(`${API}/files`);
        setFiles(data.files || []);
        if (data.restart) setRestartCaps(data.restart);
        if (data.files?.length) setSelectedId(data.files[0].id);
      } catch (err) {
        notifyError(formatAxiosError(err, 'Failed to load gateway file list'));
      }
    })();
  }, []);

  // --- load a selected file -------------------------------------------------
  const loadFile = useCallback(async (id) => {
    setLoadingFile(true);
    setErrors([]);
    setReload(null);
    try {
      const { data } = await apiClient.get(`${API}/files/${encodeURIComponent(id)}`);
      setMeta({ type: data.type, reloadMode: data.reloadMode, label: data.label });
      setEditorValue(data.raw);
      setBaseline(data.raw);
    } catch (err) {
      notifyError(formatAxiosError(err, 'Failed to load file'));
    } finally {
      setLoadingFile(false);
    }
  }, []);

  useEffect(() => { if (selectedId) loadFile(selectedId); }, [selectedId, loadFile]);

  // --- push validation errors into Monaco as inline markers -----------------
  const applyMarkers = useCallback((errs) => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    const markers = errs
      .filter((e) => e.line)  // only syntax errors carry a location
      .map((e) => ({
        startLineNumber: e.line,
        startColumn: e.col || 1,
        endLineNumber: e.line,
        endColumn: (e.col || 1) + 1,
        message: e.message,
        severity: monaco.MarkerSeverity.Error,
      }));
    monaco.editor.setModelMarkers(model, 'agc', markers);
  }, []);

  // --- validate (server: syntax + schema + placeholder), debounced ----------
  const validate = useCallback(async (id, raw) => {
    setValidating(true);
    try {
      const { data } = await apiClient.post(`${API}/files/${encodeURIComponent(id)}/validate`, { raw });
      setErrors(data.errors || []);
      applyMarkers(data.errors || []);
    } catch (err) {
      // Fall back to a client-side syntax check if the round-trip fails.
      try { JSON.parse(raw); setErrors([]); }
      catch (e) { setErrors([{ level: 'error', path: '(root)', message: `Invalid JSON: ${e.message}` }]); }
    } finally {
      setValidating(false);
    }
  }, [applyMarkers]);

  const onEditorChange = useCallback((value) => {
    const raw = value || '';
    setEditorValue(raw);
    setReload(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { if (selectedId) validate(selectedId, raw); }, 400);
  }, [selectedId, validate]);

  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  }, []);

  // --- save -----------------------------------------------------------------
  const handleSave = useCallback(async () => {
    // Client-side guard for instant feedback before the round-trip.
    try { JSON.parse(editorValue); }
    catch (e) { notifyError(`Invalid JSON — not saved: ${e.message}`); return; }

    setSaving(true);
    setReload(null);
    try {
      const { data } = await apiClient.post(`${API}/files/${encodeURIComponent(selectedId)}`, { raw: editorValue });
      // Sync editor + baseline to the server-normalized text so the "unsaved"
      // dot clears correctly (server rewrites as pretty 2-space JSON).
      const saved = typeof data.raw === 'string' ? data.raw : editorValue;
      setEditorValue(saved);
      setBaseline(saved);
      setErrors((data.warnings || []).length ? data.warnings : []);
      applyMarkers([]);
      (data.warnings || []).forEach((w) => { notifyWarning(w.message); });
      setReload(data.reload || null);
      if (data.reload?.mode === 'auto') {
        notifySuccess(data.reload.reloaded
          ? 'Saved — gateway reloaded the route automatically.'
          : 'Saved — route will reload within ~10s (gateway health not yet confirmed).');
      } else {
        notifySuccess('Saved. A restart is required to apply this change.');
      }
    } catch (err) {
      const body = err?.response?.data;
      if (body?.errors) {
        setErrors(body.errors);
        applyMarkers(body.errors);
        notifyError('Config has errors — not saved. See the list below.');
      } else {
        notifyError(formatAxiosError(err, 'Failed to save config'));
      }
    } finally {
      setSaving(false);
    }
  }, [selectedId, editorValue, applyMarkers]);

  const handleRevert = useCallback(() => {
    setEditorValue(baseline);
    setErrors([]);
    applyMarkers([]);
    setReload(null);
  }, [baseline, applyMarkers]);

  // --- one-click restart ----------------------------------------------------
  const handleRestart = useCallback(async () => {
    const targets = restartTargetsForType(meta?.type);
    const hitsBff = targets.includes('bff');
    setRestarting(true);
    try {
      await apiClient.post(`${API}/reload`, { id: selectedId });
      notifySuccess('Gateway restarted.');
      setReload(null);
    } catch (err) {
      // A scope-topology restart bounces the BFF itself, so this request may
      // never return — treat a network error as "restart in progress".
      if (hitsBff && !err?.response) {
        notifyWarning('Restarting the app server… reload this page in a few seconds.');
      } else {
        const body = err?.response?.data;
        notifyError(body?.manual
          ? `Restart failed. Run manually: ${body.manual}`
          : formatAxiosError(err, 'Restart failed'));
      }
    } finally {
      setRestarting(false);
    }
  }, [selectedId, meta]);

  const grouped = files.reduce((acc, f) => {
    (acc[f.group] = acc[f.group] || []).push(f);
    return acc;
  }, {});

  return (
    <div className="agc-embed">
      <p className="agc-intro">View, validate, and edit the gateway&apos;s JSON config files.
        Route files reload automatically (~10s); core &amp; scope-topology files need a restart.</p>

      <div className="agc-layout">
        {/* File picker */}
        <aside className="agc-sidebar">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="agc-group">
              <div className="agc-group-title">{group}</div>
              {items.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`agc-file${f.id === selectedId ? ' agc-file--active' : ''}`}
                  onClick={() => setSelectedId(f.id)}
                >
                  <span className="agc-file-label">{f.label}</span>
                  <span className={`agc-badge agc-badge--${f.reloadMode}`}>
                    {f.reloadMode === 'auto' ? 'auto-reload' : 'restart'}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* Editor + validation */}
        <main className="agc-main">
          <div className="agc-toolbar">
            <span className="agc-current">{meta?.label || '—'}</span>
            <span className="agc-spacer" />
            {validating && <span className="agc-muted">validating…</span>}
            {dirty && <span className="agc-dirty">● unsaved</span>}
            <button type="button" className="agc-btn" onClick={handleRevert} disabled={!dirty || saving}>
              Revert
            </button>
            <button
              type="button"
              className="agc-btn agc-btn--primary"
              onClick={handleSave}
              disabled={saving || hasErrors || !dirty || loadingFile}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          <div className="agc-editor">
            <Monaco
              language="json"
              value={editorValue}
              onChange={onEditorChange}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                formatOnPaste: true,
                fontSize: 13,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>

          {/* Validation panel */}
          {errors.length > 0 && (
            <div className="agc-panel">
              {errors.map((e, i) => (
                <div key={i} className={`agc-issue agc-issue--${e.level}`}>
                  <span className="agc-issue-badge">{e.level === 'warn' ? 'WARN' : 'ERROR'}</span>
                  <span className="agc-issue-path">{e.path}{e.line ? ` (line ${e.line})` : ''}</span>
                  <span className="agc-issue-msg">{e.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Restart banner */}
          {reload?.required && (
            <div className="agc-restart">
              <div className="agc-restart-text">
                <strong>Restart required.</strong> This file isn&apos;t hot-reloaded —
                restart {reload.targets?.includes('bff') ? 'the gateway and app server' : 'the gateway'} to apply.
                {!restartCaps.socket && (
                  <span className="agc-muted"> (Docker socket unavailable — one-click restart disabled.)</span>
                )}
              </div>
              <button
                type="button"
                className="agc-btn agc-btn--warn"
                onClick={handleRestart}
                disabled={restarting || !restartCaps.enabled || !restartCaps.socket}
              >
                {restarting ? 'Restarting…' : 'Restart gateway'}
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
