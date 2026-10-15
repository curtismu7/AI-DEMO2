import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DotMemoryPanel from '../components/DotMemoryPanel';
import PageAgentModeToggle, { usePageAgentMode } from '../components/shared/PageAgentModeToggle';
import DotToolCard from '../components/dot/DotToolCard';
import DotPersonaCard from '../components/dot/DotPersonaCard';
import DotGovernsPanel from '../components/dot/DotGovernsPanel';
import { useDotPersona } from '../components/dot/useDotPersona';
import { mapInvokeResult } from '../utils/dotChat';
import { DOT_SUGGESTIONS } from '../config/dotSuggestions';
import { useThemeOptional } from '../context/ThemeContext';
import { openSignIn } from '../utils/signInService';
// Same workbench shell sheet as /privilege-a2a (cur-ide / cur-titlebar), plus Dot's own.
import './PrivilegeMcpClientPage.css';
import '../components/dot/DotWorkbench.css';

const SKINS = [['privilege', 'Privilege'], ['claude', 'Claude'], ['gpt', 'ChatGPT'], ['gemini', 'Gemini']];

export default function DotWorkbenchPage({ user }) {
  const persona = useDotPersona();
  const [agentMode, setAgentMode] = usePageAgentMode('personal-agent');
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('cur_priv_theme') || 'dark'; } catch { return 'dark'; }
  });
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [memNonce, setMemNonce] = useState(0);
  const identity = user?.email || user?.username || user?.name || '';

  // Follow the main top bar's light/dark switch after mount (same as /privilege-a2a); stored choice wins on load.
  const { darkMode } = useThemeOptional();
  const seenDarkMode = useRef(darkMode);
  useEffect(() => {
    if (seenDarkMode.current === darkMode) return;
    seenDarkMode.current = darkMode;
    setTheme(darkMode ? 'dark' : 'light');
  }, [darkMode]);
  useEffect(() => {
    try { localStorage.setItem('cur_priv_theme', theme); } catch { /* storage disabled */ }
  }, [theme]);
  const flipTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  async function send(text) {
    const prompt = (text ?? input).trim();
    if (!prompt || busy) return;
    setInput('');
    setBusy(true);
    setSignedOut(false);
    setItems((prev) => [...prev, { kind: 'user', text: prompt }]);
    let mapped;
    try {
      const res = await fetch('/api/agent/invoke', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, vertical: 'airlines', agentMode }),
      });
      mapped = mapInvokeResult(res.status, await res.json().catch(() => null));
    } catch {
      mapped = mapInvokeResult(0, null);
    }
    if (mapped.signedOut) setSignedOut(true);
    // dotMemories ride on the Dot bubble so the chip sits under the reply that learned it.
    const withMemories = mapped.items.map((i) => (i.kind === 'dot' && mapped.memories.length ? { ...i, memories: mapped.memories } : i));
    setItems((prev) => [...prev, ...withMemories]);
    if (mapped.memories.length) setMemNonce((n) => n + 1);
    setBusy(false);
  }

  const cards = items.filter((i) => i.kind === 'tool');
  return (
    <div className="cur-ide dot-wb" data-cur-theme={theme} data-testid="dot-workbench-page" style={{ minHeight: 0 }}>
      <header className="cur-titlebar">
        <div className="cur-titlebar-left"><span className="cur-titlebar-title">Digital Assistant</span></div>
        <nav className="cur-titlebar-center" aria-label="Agent skins">
          {SKINS.map(([id, label]) => <Link key={id} className="cur-flow-trigger" to={`/personal-agent?skin=${id}`}>{label}</Link>)}
          <span className="cur-flow-trigger" aria-current="page">Persona Agent (Dot)</span>
        </nav>
        <div className="cur-titlebar-right">
          <PageAgentModeToggle mode={agentMode} onChange={setAgentMode} />
          <button type="button" className="cur-flow-trigger" onClick={flipTheme}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
        </div>
      </header>

      <main className="dot-wb__main">
        <div>
          <DotPersonaCard persona={persona} identity={identity} />
          <div className="dot-card dot-chat">
            <div className="dot-msgs" aria-live="polite">
              {items.map((i, n) => {
                if (i.kind === 'tool') return <DotToolCard key={n} item={i} />;
                if (i.kind === 'user') return <div key={n} className="dot-m dot-m--user">{i.text}</div>;
                if (i.kind === 'error') return <div key={n} className="dot-m dot-m--error">{i.text}</div>;
                return (
                  <div key={n} className="dot-m dot-m--dot">
                    {i.text}
                    {i.memories?.length > 0 && <div>{i.memories.map((m) => <span key={m} className="dot-remembered">remembered: {m}</span>)}</div>}
                  </div>
                );
              })}
            </div>
            {signedOut && (
              <div className="dot-signin" role="alert">
                <h3>Sign in to use Dot</h3>
                <p>Dot acts on your behalf under your own identity, so it needs you signed in first.</p>
                <button type="button" className="dot-chip" onClick={() => openSignIn({ returnTo: '/personal-agent/dot' })}>Sign in</button>
              </div>
            )}
            {items.length === 0 && (
              <div className="dot-chips" role="group" aria-label="Suggested prompts">
                {DOT_SUGGESTIONS.map((s) => <button key={s} type="button" className="dot-chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            <form className="dot-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input aria-label="Message Dot" placeholder="Ask Dot anything about your account…" value={input} onChange={(e) => setInput(e.target.value)} />
              <button type="submit" disabled={busy || !input.trim()}>Send</button>
            </form>
          </div>
        </div>
        <aside className="dot-aside">
          <section className="dot-card"><DotMemoryPanel refreshNonce={memNonce} /></section>
          <DotGovernsPanel cards={cards} persona={persona} mode={agentMode} />
        </aside>
      </main>
    </div>
  );
}
