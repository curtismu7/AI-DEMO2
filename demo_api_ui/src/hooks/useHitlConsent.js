import { useCallback } from 'react';

export default function useHitlConsent({ hitlPending, runId }) {
  const showConsentModal = Boolean(hitlPending);
  const consentData = hitlPending || null;

  const submitConsent = useCallback(
    async (approved) => {
      const rid = hitlPending?.runId || runId;
      if (!rid) return;

      const res = await fetch(`/api/agent/consent/${rid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`HITL consent request failed: ${res.status}`);
      }
    },
    [hitlPending, runId]
  );

  return { showConsentModal, consentData, submitConsent };
}
