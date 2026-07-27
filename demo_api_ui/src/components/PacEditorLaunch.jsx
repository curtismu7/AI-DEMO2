import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  PAC_EDITOR_URL,
  PAC_EDITOR_COMMAND,
  probePacEditor,
} from './pacEditorStatus';

const S = {
  wrap: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexWrap: 'wrap' },
  status: { color: '#475569', whiteSpace: 'nowrap' },
  dot: (on) => ({
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginRight: 6,
    background: on ? '#16a34a' : '#94a3b8',
  }),
  hint: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    background: '#e2e8f0',
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    padding: '2px 6px',
    color: '#334155',
    whiteSpace: 'nowrap',
  },
};

// Local-only: this control probes the presenter's own loopback address and
// advertises a shell command that must not be run against a shared cluster
// (see scripts/pac-edit.sh's own header). On a shared deployment (e.g. the SE
// AWS cluster at ai-demo.ping-devops.com) that probe would just hit each
// viewer's own machine and the command would be actively wrong, so the
// control renders nothing outside local hostnames.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', 'local.ping-devops.com']);

function isLocalHost() {
  return (
    typeof window !== 'undefined' &&
    LOCAL_HOSTNAMES.has(window.location.hostname)
  );
}

// Status + launcher for the local Policy-as-Code editor.
//
// The link is always enabled. A failed probe cannot distinguish "nothing is
// listening" from "this browser blocked the mixed-content request", so
// disabling on failure would block a working editor in browsers that block the
// probe. Better to let the click through and let the new tab tell the truth.
export default function PacEditorLaunch({ probe = probePacEditor }) {
  const local = isLocalHost();
  const [status, setStatus] = useState('unknown');
  const aliveRef = useRef(true);

  const check = useCallback(() => {
    Promise.resolve(probe())
      .then((next) => {
        if (aliveRef.current) setStatus(next);
      })
      .catch(() => {});
  }, [probe]);

  useEffect(() => {
    if (!local) return undefined;
    aliveRef.current = true;
    check();
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => {
      aliveRef.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [check, local]);

  // Nothing to render on a shared deployment — see the LOCAL_HOSTNAMES note
  // above.
  if (!local) return null;

  const running = status === 'running';

  return (
    <div style={S.wrap}>
      <span style={S.status}>
        <span style={S.dot(running)} />
        {`Policy editor: ${running ? 'Running' : 'Not detected'}`}
      </span>
      {!running && <code style={S.hint}>{PAC_EDITOR_COMMAND}</code>}
      <a
        className="inspector-shell-topbar__btn"
        href={PAC_EDITOR_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open editor
      </a>
    </div>
  );
}
