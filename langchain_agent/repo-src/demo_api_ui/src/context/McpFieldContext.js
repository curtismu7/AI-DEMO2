// demo_api_ui/src/context/McpFieldContext.js
import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';

/**
 * State shape: { [fieldKey]: { value: string, source: string|null } }
 */

// Split into two contexts so consumers of only `dispatch` don't re-render when state changes.
const McpFieldStateContext    = createContext(null);
const McpFieldDispatchContext = createContext(null);

function reducer(state, action) {
  switch (action.type) {
    case 'SET_FIELD':
      return {
        ...state,
        [action.key]: { value: action.value, source: action.source || null },
      };
    case 'CLEAR_FIELD':
      return { ...state, [action.key]: { value: '', source: null } };
    default:
      return state;
  }
}

/** @param {{ children: import('react').ReactNode }} props */
export function McpFieldProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, {});
  // Memoize so dispatch consumers don't re-render on every state change
  const stableDispatch = useMemo(() => dispatch, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <McpFieldDispatchContext.Provider value={stableDispatch}>
      <McpFieldStateContext.Provider value={state}>
        {children}
      </McpFieldStateContext.Provider>
    </McpFieldDispatchContext.Provider>
  );
}

/**
 * Low-level hook — returns field value/source and stable setValue/clear.
 * Prefer useMcpFieldState for components.
 */
export function useMcpField(fieldKey) {
  const state    = useContext(McpFieldStateContext);
  const dispatch = useContext(McpFieldDispatchContext);
  if (state === null || dispatch === null) {
    throw new Error('useMcpField must be used inside McpFieldProvider');
  }

  const entry = state[fieldKey] || { value: '', source: null };

  // dispatch is stable (memoised in provider); fieldKey is a string constant from MCP_FIELD_KEYS.
  const setValue = useCallback(
    (value, source) => dispatch({ type: 'SET_FIELD', key: fieldKey, value, source }),
    [dispatch, fieldKey]
  );

  const clear = useCallback(
    () => dispatch({ type: 'CLEAR_FIELD', key: fieldKey }),
    [dispatch, fieldKey]
  );

  return { value: entry.value, source: entry.source, setValue, clear };
}
