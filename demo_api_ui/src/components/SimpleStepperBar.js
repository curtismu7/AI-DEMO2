// demo_api_ui/src/components/SimpleStepperBar.js
import React, { useCallback, useState } from 'react';
import { useTokenChainOptional } from '../context/TokenChainContext';
import SimpleStepperPanel from './SimpleStepperPanel';
import './SimpleStepperBar.css';

/**
 * Compact Simple Stepper bar — replaces the old wrapping InlineTokenChainView
 * pill flow. Shows title + live step count; the toggle pops out
 * SimpleStepperPanel (floating, draggable, resizable table). Renders null
 * outside the TokenChainContext provider (SSR / tests without provider).
 */
export default function SimpleStepperBar() {
  const ctx = useTokenChainOptional();
  const [open, setOpen] = useState(false);

  const setOpenPersist = useCallback((next) => {
    setOpen(next);
  }, []);

  if (!ctx) return null;

  const events = ctx.events ?? [];

  return (
    <div className="ssb-bar" aria-label="Simple Stepper">
      <span className="ssb-title">Simple Stepper</span>
      {events.length > 0 && (
        <span
          className="ssb-count"
          aria-label={`${events.length} step${events.length === 1 ? '' : 's'}`}
        >
          {events.length}
        </span>
      )}
      <button
        type="button"
        className="ssb-toggle"
        onClick={() => setOpenPersist(!open)}
        aria-expanded={open}
      >
        {open ? 'Hide' : 'Show'}
      </button>
      <SimpleStepperPanel isOpen={open} onClose={() => setOpenPersist(false)} />
    </div>
  );
}
