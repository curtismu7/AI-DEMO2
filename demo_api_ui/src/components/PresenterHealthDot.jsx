/**
 * Presenter-only stack-health dot (demo hardening Phase 4). Polls the BFF's
 * /api/health/services aggregate and shows green/amber/red. Rendered only in
 * AgentDemoGuide presenter mode — the audience-facing chat UI never shows
 * degradation (locked spec decision: silent fallback).
 */
import React, { useEffect, useState } from 'react';
import { getCachedStatus } from '../services/cachedStatusService';
import './PresenterHealthDot.css';

const LLM_PATH = ['agent_service', 'mcp_server', 'mcp_gateway', 'llm_proxy'];
const POLL_MS = 10000;

function classify(payload) {
  const services = payload?.services || {};
  const down = LLM_PATH.filter((k) => !services[k]?.up);
  if (down.length) return { level: 'err', detail: `Down: ${down.join(', ')}` };
  const prompts = services.agent_service?.checks?.prompts;
  if (prompts && prompts !== 'primary') return { level: 'warn', detail: `Agent prompts degraded: ${prompts}` };
  if (!services.hitl_service?.up) return { level: 'warn', detail: 'Down: hitl_service' };
  return { level: 'ok', detail: 'All demo services healthy' };
}

export default function PresenterHealthDot() {
  const [state, setState] = useState({ level: 'warn', detail: 'Checking…' });

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const payload = await getCachedStatus('/api/health/services');
        if (!cancelled) setState(classify(payload));
      } catch (_e) {
        if (!cancelled) setState({ level: 'err', detail: 'Health endpoint unreachable' });
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <span
      className={`phd-dot phd-${state.level}`}
      title={state.detail}
      aria-label={`Stack health: ${state.level} — ${state.detail}`}
    />
  );
}
