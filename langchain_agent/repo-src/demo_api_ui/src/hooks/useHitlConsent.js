import { useCallback } from 'react';

export default function useHitlConsent({ hitlPending, runId }) {
  const showConsentModal = Boolean(hitlPending);
  const consentData = hitlPending || null;

  const submitConsent = useCallback(
    async (approved) => {
      const rid = hitlPending?.runId || runId;
      if (!rid) return;

      await fetch(`/api/agent/consent/${rid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
        credentials: 'include',
      });
    },
    [hitlPending, runId]
  );

  return { showConsentModal, consentData, submitConsent };
}
