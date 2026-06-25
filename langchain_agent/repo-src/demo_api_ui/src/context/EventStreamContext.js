// demo_api_ui/src/context/EventStreamContext.js
import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react';

/**
 * @typedef {object} StreamEvent
 * @property {string} id          - Unique event id (caller-supplied or auto-generated)
 * @property {string} type        - e.g. 'user_request' | 'agent_thinking' | 'tool_call' | 'token_exchange' | 'result' | 'error'
 * @property {string} timestamp   - ISO 8601 string
 * @property {string} message     - Plain-English summary shown to user
 * @property {string} [requestId] - Groups events belonging to the same request
 * @property {*}      [details]   - Raw technical payload (collapsed by default in EventCard)
 */

// Restore mode preference from localStorage, default to 'float' so panel is draggable
function getInitialMode() {
  if (typeof window === 'undefined') return 'float';
  try {
    const saved = localStorage.getItem('esp-mode');
    if (saved && ['embedded', 'float', 'bottom'].includes(saved)) return saved;
  } catch {}
  return 'float'; // Default to float (draggable)
}

const INITIAL_STATE = {
  events: [],
  isOpen: false,
  mode: getInitialMode(), // 'embedded' | 'float' | 'bottom'
  autoScrollEnabled: true,
};

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_EVENT':
      return { ...state, events: [...state.events, action.event] };
    case 'CLEAR_HISTORY':
      return { ...state, events: [] };
    case 'TOGGLE_PANEL':
      return { ...state, isOpen: !state.isOpen };
    case 'SET_OPEN':
      return { ...state, isOpen: action.isOpen };
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    case 'SET_AUTO_SCROLL':
      return { ...state, autoScrollEnabled: action.enabled };
    default:
      return state;
  }
}

const EventStreamContext = createContext({
  events: [],
  isOpen: false,
  mode: 'embedded',
  autoScrollEnabled: true,
  addEvent: () => {},
  clearHistory: () => {},
  togglePanel: () => {},
  openPanel: () => {},
  setMode: () => {},
  pauseAutoScroll: () => {},
  resumeAutoScroll: () => {},
});

let _autoId = 0;

export function EventStreamProvider({ children, initialState = {} }) {
  const [state, dispatch] = useReducer(reducer, { ...INITIAL_STATE, ...initialState });

  // Ref lets action creators always see the latest state without re-rendering
  const stateRef = useRef(state);
  stateRef.current = state;

  const addEvent = useCallback((event) => {
    const id = event.id ?? `evt-${++_autoId}`;
    const timestamp = event.timestamp ?? new Date().toISOString();
    dispatch({ type: 'ADD_EVENT', event: { ...event, id, timestamp } });
  }, []);

  const clearHistory = useCallback(() => dispatch({ type: 'CLEAR_HISTORY' }), []);
  const togglePanel = useCallback(() => dispatch({ type: 'TOGGLE_PANEL' }), []);
  const openPanel = useCallback(() => dispatch({ type: 'SET_OPEN', isOpen: true }), []);

  const setMode = useCallback((mode) => {
    dispatch({ type: 'SET_MODE', mode });
    try {
      localStorage.setItem('esp-mode', mode);
    } catch {}
  }, []);

  const pauseAutoScroll = useCallback(() => {
    dispatch({ type: 'SET_AUTO_SCROLL', enabled: false });
  }, []);

  const resumeAutoScroll = useCallback(() => {
    dispatch({ type: 'SET_AUTO_SCROLL', enabled: true });
  }, []);

  const value = useMemo(
    () => ({
      events: state.events,
      isOpen: state.isOpen,
      mode: state.mode,
      autoScrollEnabled: state.autoScrollEnabled,
      addEvent,
      clearHistory,
      togglePanel,
      openPanel,
      setMode,
      pauseAutoScroll,
      resumeAutoScroll,
    }),
    [
      state.events,
      state.isOpen,
      state.mode,
      state.autoScrollEnabled,
      addEvent,
      clearHistory,
      togglePanel,
      openPanel,
      setMode,
      pauseAutoScroll,
      resumeAutoScroll,
    ]
  );

  return (
    <EventStreamContext.Provider value={value}>{children}</EventStreamContext.Provider>
  );
}

export function useEventStream() {
  return useContext(EventStreamContext);
}
