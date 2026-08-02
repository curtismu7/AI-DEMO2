import React from 'react';
import '../TokenTopologyPanel.css';

/**
 * Protocol hops rendered in the Token Topology visual language — node cards
 * with an icon, name, description and lane chip, joined by a labelled
 * connector. One row per step, so a repeated actor still reads as its own hop.
 */

const ACTOR_META = {
  'client-app': { icon: '🪟', name: 'Client App', lane: 'BROWSER', desc: 'Browser / UI app' },
  'auth-server': { icon: '🔐', name: 'Auth Server', lane: 'PINGONE', desc: 'PingOne authorization server' },
  'human-approver': { icon: '👤', name: 'Human Approver', lane: 'CHAT', desc: 'Out-of-band approval' },
  gateway: { icon: 'GW', name: 'Gateway', lane: 'GATEWAY', desc: 'Token validation + routing' },
  'token-exchanger': { icon: 'TX', name: 'Token Exchanger', lane: 'BFF', desc: 'RFC 8693 subject + actor' },
};

const FALLBACK_META = { icon: 'M', lane: 'API', desc: 'Protocol participant' };

function titleCase(actor) {
  return String(actor || 'actor')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function actorMeta(actor) {
  return ACTOR_META[actor] || { ...FALLBACK_META, name: titleCase(actor) };
}

/** done / error / active / pending for the step at this position. */
function hopStatus(index, results, currentStep, stepId) {
  const result = results?.[index];
  if (result) {
    if (result.error) return 'error';
    const status = result.response?.status;
    return typeof status === 'number' && status >= 400 ? 'error' : 'done';
  }
  return currentStep === stepId ? 'active' : 'pending';
}

function NodeCard({ actor, status }) {
  const meta = actorMeta(actor);
  const isDone = status === 'done';
  const isError = status === 'error';
  const isPending = status === 'pending';

  return (
    <div className="ttp-node">
      <div className={`ttp-box${status === 'active' ? ' active' : ''}${isPending ? ' pulsing' : ''}`}>
        <div className={`ttp-status ${isDone ? 'ok' : isError ? 'err' : isPending ? 'pend' : 'nd'}`}>
          {isDone ? '✓' : isError ? '✕' : isPending ? <span className="ttp-pulse-dot" /> : '—'}
        </div>
        <div className="ttp-icon">{meta.icon}</div>
        <div className="ttp-name">{meta.name}</div>
        <div className="ttp-desc">{meta.desc}</div>
        <span className={`ttp-lane ttp-lane--${meta.lane.toLowerCase()}`}>{meta.lane}</span>
      </div>
    </div>
  );
}

export default function SequenceDiagram({ flowSpec, currentStep, results = [] }) {
  const steps = flowSpec?.steps || [];
  if (!steps.length) return null;

  return (
    <div className="pp-topology">
      <div className="ttp-label">Protocol hops — each row is one request</div>
      {steps.map((step, index) => {
        const status = hopStatus(index, results, currentStep, step.id);
        const from = step.fromActor || step.actor;
        const to = step.toActor || step.actor;
        return (
          <div className="ttp-row pp-topology__hop" key={step.id || index}>
            <NodeCard actor={from} status={status === 'pending' ? 'pending' : 'done'} />
            <div className={`ttp-conn${status === 'error' ? ' blocked' : ''}${status === 'pending' ? ' ghost' : ''}`}>
              <div className="ttp-line" />
              <span className="ttp-arrowhead">▶</span>
              <div className="ttp-conn-label">{step.label || step.action || step.endpoint}</div>
            </div>
            <NodeCard actor={to} status={status} />
          </div>
        );
      })}
    </div>
  );
}
