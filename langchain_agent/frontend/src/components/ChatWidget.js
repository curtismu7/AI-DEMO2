import React, { useState, useEffect, useCallback } from 'react';
import ChatInterface from './ChatInterface';
import './ChatWidget.css';

const ChatWidget = ({
    isOpen = false,
    onToggle,
    position = 'bottom-right',
    theme = 'light',
    title = 'AI Banking Assistant',
    minimized = false,
    apiUrl = 'ws://localhost:8082/ws',
    onDashboardRefresh
}) => {
    const [isMinimized, setIsMinimized] = useState(minimized);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    // LangChain provider badge + settings
    const [activeProvider, setActiveProvider] = useState('groq');
    const [activeModel, setActiveModel] = useState('');
    const [keySet, setKeySet] = useState({});
    const [providerModels, setProviderModels] = useState({});
    const [showSettings, setShowSettings] = useState(false);
    const [settingsKeyInput, setSettingsKeyInput] = useState('');
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsMsg, setSettingsMsg] = useState('');

    const handleMinimize = () => {
        setIsMinimized(!isMinimized);
    };

    const handleClose = () => {
        if (onToggle) onToggle(false);
    };

    const handleMouseDown = (e) => {
        setIsDragging(true);
        const rect = e.currentTarget.getBoundingClientRect();
        setDragOffset({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        });
    };

    const handleMouseMove = useCallback(
        (e) => {
            const widget = document.querySelector('.chat-widget');
            if (widget) {
                widget.style.left = `${e.clientX - dragOffset.x}px`;
                widget.style.top = `${e.clientY - dragOffset.y}px`;
                widget.style.position = 'fixed';
            }
        },
        [dragOffset]
    );

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    useEffect(() => {
        if (!isDragging) return undefined;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, handleMouseMove, handleMouseUp]);

    // Load LangChain provider status on mount
    useEffect(() => {
        fetch('/api/langchain/config/status')
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (!d) return;
                setActiveProvider(d.provider || 'groq');
                setActiveModel(d.model || '');
                setKeySet(d.key_set || {});
                setProviderModels(d.provider_models || {});
            })
            .catch(() => null);
    }, []);


    const PROVIDER_LABELS = {
        groq: 'Groq', openai: 'OpenAI', anthropic: 'Anthropic',
        google: 'Gemini', ollama: 'Ollama',
    };

    const handleSettingsSave = async () => {
        setSettingsSaving(true);
        setSettingsMsg('');
        try {
            const body = { provider: activeProvider, model: activeModel };
            if (settingsKeyInput.trim() && activeProvider !== 'ollama') {
                body.key_type = activeProvider;
                body.key = settingsKeyInput.trim();
            }
            const r = await fetch('/api/langchain/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const d = await r.json();
            if (d.ok) {
                setActiveProvider(d.provider);
                setActiveModel(d.model);
                setKeySet(d.key_set);
                setSettingsKeyInput('');
                setSettingsMsg('✓ Applied');
            } else {
                setSettingsMsg('✗ ' + (d.error || 'Error'));
            }
        } catch { setSettingsMsg('✗ Network error'); }
        finally { setSettingsSaving(false); }
    };

    if (!isOpen) return null;

    return (
        <div className={`chat-widget chat-widget--${position} chat-widget--${theme} ${isMinimized ? 'chat-widget--minimized' : ''}`}>
            <div className="chat-widget__header" onMouseDown={handleMouseDown}>
                <div className="chat-widget__title">
                    <span className="chat-widget__icon">💬</span>
                    {title}
                </div>
                <button
                    type="button"
                    className="lc-badge"
                    onClick={(e) => { e.stopPropagation(); setShowSettings(s => !s); }}
                    title="LangChain provider settings"
                >
                    ⚡ {PROVIDER_LABELS[activeProvider] || activeProvider}{activeModel ? ` · ${activeModel}` : ''}
                </button>
                <div className="chat-widget__controls">
                    <button
                        className="chat-widget__control-btn chat-widget__minimize"
                        onClick={handleMinimize}
                        title={isMinimized ? 'Expand' : 'Minimize'}
                    >
                        {isMinimized ? '□' : '−'}
                    </button>
                    <button
                        className="chat-widget__control-btn chat-widget__close"
                        onClick={handleClose}
                        title="Close"
                    >
                        ×
                    </button>
                </div>
            </div>

            {showSettings && (
                <div className="lc-settings-panel">
                    <div className="lc-settings-panel__row">
                        <label>Provider</label>
                        <select value={activeProvider}
                            onChange={e => {
                                const p = e.target.value;
                                setActiveProvider(p);
                                const models = providerModels[p] || [];
                                setActiveModel(models[0] || '');
                                setSettingsKeyInput('');
                            }}>
                            {Object.keys(PROVIDER_LABELS).map(p => (
                                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                            ))}
                        </select>
                    </div>
                    <div className="lc-settings-panel__row">
                        <label>Model</label>
                        <select value={activeModel} onChange={e => setActiveModel(e.target.value)}>
                            {(providerModels[activeProvider] || []).map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>
                    {activeProvider !== 'ollama' && (
                        <div className="lc-settings-panel__row">
                            <label>API Key</label>
                            {keySet[activeProvider]
                                ? <span className="lc-key-set">🔒 key set</span>
                                : <input type="password" placeholder="Paste key…"
                                    value={settingsKeyInput}
                                    onChange={e => setSettingsKeyInput(e.target.value)}
                                    autoComplete="off" />
                            }
                        </div>
                    )}
                    <div className="lc-settings-panel__row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <a href="/langchain" className="lc-learn-more">Learn more about LangChain →</a>
                        <button type="button" className="lc-btn-save" onClick={handleSettingsSave} disabled={settingsSaving}>
                            {settingsSaving ? '…' : 'Apply'}
                        </button>
                    </div>
                    {settingsMsg && <span style={{ fontSize: 11, color: settingsMsg.startsWith('✓') ? '#2e7d32' : '#c62828', padding: '0 8px' }}>{settingsMsg}</span>}
                </div>
            )}

            {!isMinimized && (
                <div className="chat-widget__content">
                    <ChatInterface apiUrl={apiUrl} onDashboardRefresh={onDashboardRefresh} />
                </div>
            )}
        </div>
    );
};

export default ChatWidget;