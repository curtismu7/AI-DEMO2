import React, { useState, useEffect, useMemo } from 'react';
import bffAxios from '../../services/bffAxios';
import protocolFlows from '../../data/protocolFlows.json';
import ProtocolSidebar from './ProtocolSidebar';
import ProtocolViewer from './ProtocolViewer';
import useDividerDrag from '../../hooks/useDividerDrag';
import { useThemeOptional } from '../../context/ThemeContext';
import './ProtocolPlayground.css';

/** Shape ExecutionEngine.getState() returns — the viewer and activity panel read it directly. */
const EMPTY_EXECUTION_STATE = {
  currentStep: null,
  results: [],
  error: null,
};


const IDPS = [
  { id: 'pingone', label: 'PingOne' },
  { id: 'pingfederate', label: 'PingFederate' },
];

const IDP_LABEL = { pingone: 'PingOne', pingfederate: 'PingFederate' };

const ProtocolPlayground = ({ user = null }) => {
  const [idp, setIdp] = useState('pingone');
  // The BFF's live answer: which server signed this session in, and whether a PingFederate token exists.
  const [live, setLive] = useState({ provider: null, pfSignedIn: false });
  const allProtocols = useMemo(() => Object.values(protocolFlows || {}), []);
  // A flow tagged for the other provider is hidden. Provider-independent ("any") flows are simulations: they show
  // under both, except under PingFederate once the real `<id>-pf` flow exists.
  const protocolArray = useMemo(() => {
    const ids = new Set(allProtocols.map(p => p.id));
    return allProtocols.filter(p => (!p.idp || p.idp === 'any'
      ? !(idp === 'pingfederate' && ids.has(`${p.id}-pf`))
      : p.idp === idp));
  }, [allProtocols, idp]);

  const [selectedProtocol, setSelectedProtocol] = useState(null);
  const [executionState, setExecutionState] = useState(EMPTY_EXECUTION_STATE);
  // The app owns the theme (`data-theme` on the root). The diagrams are drawn with --th-* tokens that flip with it,
  // so a private copy of the switch here left them light on a dark page.
  const { darkMode: dark, toggleDarkMode } = useThemeOptional();
  const { size: sidebarWidth, handleProps: sidebarHandleProps } = useDividerDrag({
    min: 180,
    max: 480,
    initial: 260,
    storageKey: 'pp-sidebar-width',
  });

  // Open on the provider this session signed in with; no session or no answer keeps PingOne.
  useEffect(() => {
    let cancelled = false;
    bffAxios.get('/api/pf-ai-agent/status')
      .then(({ data }) => {
        if (cancelled) return;
        setLive({ provider: IDP_LABEL[data?.sessionProvider] ? data.sessionProvider : null, pfSignedIn: !!data?.pfSignedIn });
        if (data?.sessionProvider === 'pingfederate') setIdp('pingfederate');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // The live session wins over the stored user record's copy of the provider.
  const sessionProvider = live.provider || (IDP_LABEL[user?.oauthProvider] ? user.oauthProvider : null);
  const sessionName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || user?.email || null;
  const mismatch = sessionProvider && sessionProvider !== idp;


  // Keep the selection valid for the active provider (first protocol by default).
  useEffect(() => {
    setSelectedProtocol(prev => protocolArray.find(p => p.id === prev?.id) || protocolArray[0] || null);
    setExecutionState(EMPTY_EXECUTION_STATE);
  }, [protocolArray]);

  // Handle protocol selection - convert ID back to protocol object
  const handleProtocolSelect = (protocolId) => {
    const protocol = protocolArray.find(p => p.id === protocolId);
    if (protocol) {
      setSelectedProtocol(protocol);
    }
    // Reset execution state when switching protocols
    setExecutionState(EMPTY_EXECUTION_STATE);
  };

  // Handle execution state updates
  const handleExecutionStateChange = (newState) => {
    setExecutionState((prevState) => ({
      ...prevState,
      ...newState,
    }));
  };

  return (
    <div className={`protocol-playground${dark ? ' dark' : ''}`}>
      <div
        className={`pp-sso${!sessionProvider || mismatch ? ' pp-sso--warn' : ''}`}
        role="status"
        aria-label="Signed-in session"
      >
        {sessionProvider ? (
          <>
            <strong>{sessionName || 'Signed in'}</strong> signed in with <strong>{IDP_LABEL[sessionProvider]} SSO</strong>
          </>
        ) : (
          <strong>Not signed in</strong>
        )}
        {!sessionProvider && ' — sign in to run the flows that act on your session.'}
        {mismatch && (
          <>
            {` ⚠️ ${IDP_LABEL[idp]} flows that act on your session (such as RFC 8693) need a ${IDP_LABEL[idp]} sign-in.`}
            {idp === 'pingfederate' && ' The sign-in flows (PKCE, PAR, DPoP, RAR) open a PingFederate sign-in in a new tab instead.'}
            {idp === 'pingfederate' && live.pfSignedIn && ' A PingFederate token from the CIMD page exists, which the XAA flow can use.'}
          </>
        )}
      </div>
      <header className="pp-intro">
        <h1 className="pp-intro__title">Protocol Playground</h1>
        <p className="pp-intro__lede">
          Run the identity protocols this demo depends on, one request at a time, against
          the live backend. Pick a protocol, step through its hops, and read the real
          request and response for each — including the decoded token where one comes back.
        </p>
        <div className="pp-intro__cols">
          <div>
            <h2 className="pp-intro__h">Why use it</h2>
            <p>
              Specs describe these flows in prose. Here you watch one execute: which call
              goes first, what it returns, what the next call needs from it, and what a
              failure actually looks like on the wire.
            </p>
          </div>
          <div>
            <h2 className="pp-intro__h">Why it matters for AI</h2>
            <p>
              An agent acts on a person's behalf without a browser and without a human
              watching each call. These four protocols are how that stays safe: approve a
              specific action (CIBA), bind the token to its holder (DPoP), narrow it to one
              call and record who delegated it (RFC 8693), and declare intent before acting
              on it (PAR).
            </p>
          </div>
        </div>
      </header>
      <div className="protocol-playground__container">
        <button
          className="pp-theme-toggle"
          onClick={toggleDarkMode}
          title="Switch the app between light and dark"
          aria-pressed={dark}
        >
          {dark ? '☀️ Light mode' : '🌙 Dark mode'}
        </button>
        <aside
          className="protocol-playground__sidebar"
          style={{ flex: `0 0 ${sidebarWidth}px` }}
        >
          <div className="pp-idp-toggle" role="group" aria-label="Identity provider">
            {IDPS.map(({ id, label }) => (
              <button
                key={id}
                className={`pp-idp-toggle__btn${idp === id ? ' active' : ''}`}
                aria-pressed={idp === id}
                onClick={() => setIdp(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <ProtocolSidebar
            protocols={protocolArray.map(p => ({ id: p.id, name: p.name, simulated: !p.idp || p.idp === 'any' }))}
            selectedProtocol={selectedProtocol?.id}
            onSelectProtocol={handleProtocolSelect}
          />
        </aside>
        <div
          className="protocol-playground__resize-handle"
          aria-label="Resize protocol list column"
          {...sidebarHandleProps}
        />

        <main className="protocol-playground__viewer">
          {selectedProtocol ? (
            <ProtocolViewer
              flowSpec={selectedProtocol}
              executionState={executionState}
              onExecutionStateChange={handleExecutionStateChange}
              dark={dark}
            />
          ) : (
            <div className="protocol-playground__empty-state">
              <p>No protocols available</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default ProtocolPlayground;
