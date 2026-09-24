import { useEffect, useRef } from 'react';
import {
  ID_JAG_USE_CASE_ID,
  RUN_MODES,
  completeIdJagRunHandoff,
  requestLiveIdJagRun,
} from '../utils/idJagRunMode';

const REPLAYED_KEY = 'bx_id_jag_replayed';
const isLaunchPhrase = (text) => /^(?:run (?:the )?demo|run (?:the )?id[- ]jag demo|enterprise[- ]managed mcp(?: authorization)?|show my balance)[.!?]*$/i.test(text.trim());

/** Each agent supplies its own active-use-case reader; launch and replay policy stay shared. */
export function useIdJagAgentLauncher({ pathname, readUseCaseId }) {
  const replayedRef = useRef(false);

  useEffect(() => {
    const onLaunch = () => {
      replayedRef.current = false;
      try { sessionStorage.removeItem(REPLAYED_KEY); } catch { /* storage unavailable */ }
    };
    const onAuthenticated = (event) => {
      const detail = event.detail;
      if (detail?.idJagCallbackValidated !== true || detail.useCaseId !== ID_JAG_USE_CASE_ID
        || detail.mode !== RUN_MODES.LIVE_ID_JAG || !detail.message || replayedRef.current) return;
      try {
        if (sessionStorage.getItem(REPLAYED_KEY) === '1') return;
        sessionStorage.setItem(REPLAYED_KEY, '1');
      } catch { /* the in-memory guard still handles duplicate events */ }
      replayedRef.current = true;
      completeIdJagRunHandoff();
      window.dispatchEvent(new CustomEvent('banking-agent-prefill', { detail: {
        message: detail.message,
        autoSend: true,
        useCaseId: ID_JAG_USE_CASE_ID,
        mode: RUN_MODES.LIVE_ID_JAG,
      } }));
    };
    window.addEventListener('id-jag-run-requested', onLaunch);
    window.addEventListener('userAuthenticated', onAuthenticated);
    return () => {
      window.removeEventListener('id-jag-run-requested', onLaunch);
      window.removeEventListener('userAuthenticated', onAuthenticated);
    };
  }, []);

  const launchDemoStep = (uc) => {
    if (uc?.id !== 'UC40' || uc.useCaseId !== ID_JAG_USE_CASE_ID) return false;
    requestLiveIdJagRun({
      mode: RUN_MODES.LIVE_ID_JAG,
      message: 'show my balance',
      returnTo: pathname === '/pingfederate-id-jag/demo' ? pathname : '/dashboard',
    });
    return true;
  };

  const launchPhrase = (text) => {
    const inContext = readUseCaseId() === ID_JAG_USE_CASE_ID
      || pathname === '/pingfederate-id-jag/demo'
      || pathname === '/demo/enterprise-mcp';
    if (!inContext || !isLaunchPhrase(text)) return false;
    requestLiveIdJagRun({
      mode: RUN_MODES.LIVE_ID_JAG,
      message: 'show my balance',
      returnTo: pathname === '/dashboard' ? '/dashboard' : '/pingfederate-id-jag/demo',
    });
    return true;
  };

  return { launchDemoStep, launchPhrase };
}
