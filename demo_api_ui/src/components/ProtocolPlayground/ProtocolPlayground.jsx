import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import protocolFlows from '../../data/protocolFlows.json';
import ProtocolSidebar from './ProtocolSidebar';
import ProtocolViewer from './ProtocolViewer';
import './ProtocolPlayground.css';

/** Shape ExecutionEngine.getState() returns — the viewer and activity panel read it directly. */
const EMPTY_EXECUTION_STATE = {
  currentStep: null,
  results: [],
  error: null,
};

// Sidebar drag-to-resize, persisted — same pattern as shared/InspectorShell.jsx.
const SIDEBAR_WIDTH_KEY = 'pp-sidebar-width';
const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 480;
const DEFAULT_SIDEBAR = 260;

function loadSidebarWidth() {
  try {
    const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= MIN_SIDEBAR && saved <= MAX_SIDEBAR) return saved;
  } catch {
    // Unavailable storage (private browsing, quota) — use the default.
  }
  return DEFAULT_SIDEBAR;
}

const ProtocolPlayground = () => {
  // Convert protocolFlows object to array of protocol objects
  const protocolArray = useMemo(() => Object.values(protocolFlows || {}), []);

  const [selectedProtocol, setSelectedProtocol] = useState(null);
  const [executionState, setExecutionState] = useState(EMPTY_EXECUTION_STATE);
  const [dark, setDark] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const dragRef = useRef(null);

  const onDragMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = Math.min(
      Math.max(drag.startWidth + e.clientX - drag.startX, MIN_SIDEBAR),
      MAX_SIDEBAR,
    );
    setSidebarWidth(next);
  }, []);

  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    setSidebarWidth((w) => {
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
      } catch {
        // Ignore write failures (private browsing, quota).
      }
      return w;
    });
  }, [onDragMove]);

  const onDragStart = useCallback((e) => {
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }, [sidebarWidth, onDragMove, onDragEnd]);

  // Drop the document listeners if we unmount mid-drag (route change with the
  // mouse button still held) so they don't linger for the rest of the session.
  useEffect(() => () => {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }, [onDragMove, onDragEnd]);

  // Set first protocol as default on mount
  useEffect(() => {
    if (protocolArray && protocolArray.length > 0) {
      setSelectedProtocol(protocolArray[0]);
    }
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
        <button className="pp-theme-toggle" onClick={() => setDark(d => !d)}>
          {dark ? 'Light' : 'Dark'}
        </button>
        <aside
          className="protocol-playground__sidebar"
          style={{ flex: `0 0 ${sidebarWidth}px` }}
        >
          <ProtocolSidebar
            protocols={protocolArray.map(p => ({ id: p.id, name: p.name }))}
            selectedProtocol={selectedProtocol?.id}
            onSelectProtocol={handleProtocolSelect}
          />
        </aside>
        <div
          className="protocol-playground__resize-handle"
          onMouseDown={onDragStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize protocol list column"
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
