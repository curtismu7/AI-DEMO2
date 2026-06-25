// demo_api_ui/src/hooks/useMcpFieldState.js
import { useEffect } from 'react';
import { useMcpField } from '../context/McpFieldContext';

/**
 * Public hook for components. Adds defaultValue seeding on mount.
 *
 * @param {string} fieldKey - Key from MCP_FIELD_KEYS
 * @param {object} [options]
 * @param {string} [options.defaultValue] - Seed value written on mount (e.g. from data.config.*)
 * @param {string} [options.source] - Source label for the chip (e.g. 'auto-filled', 'Step 2')
 * @returns {{ value: string, setValue: Function, source: string|null, clear: Function }}
 */
export function useMcpFieldState(fieldKey, options = {}) {
  const { defaultValue, source: defaultSource } = options;
  const { value, source, setValue, clear } = useMcpField(fieldKey);

  // Seed from defaultValue on mount — only if field is still empty
  useEffect(() => {
    if (defaultValue !== undefined && defaultValue !== '' && value === '') {
      setValue(defaultValue, defaultSource || 'auto-filled');
    }
    // setValue is stable (memoised via useCallback in McpFieldContext) — safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue]); // only re-run if defaultValue changes (e.g. after data load)

  return { value, setValue, source, clear };
}
