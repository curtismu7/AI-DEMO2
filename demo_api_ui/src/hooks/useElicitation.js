import { useState, useCallback, useRef, useEffect } from 'react';
import bffAxios from '../services/bffAxios';

/**
 * Hook for handling MCP client elicitation.
 * Listens for elicitation events from the MCP tool pipeline SSE stream
 * and manages the submit/cancel flow.
 */
function useElicitation() {
  const [elicitation, setElicitation] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const elicitationTimeoutRef = useRef(null);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (elicitationTimeoutRef.current) {
        clearTimeout(elicitationTimeoutRef.current);
      }
    };
  }, []);

  // Handle elicitation event from SSE (called by the tool pipeline listener)
  const handleElicitationRequest = useCallback((event) => {
    setElicitation({
      elicitationId: event.elicitationId,
      mode: event.mode,
      message: event.message,
      requestedSchema: event.requestedSchema,
      url: event.url,
    });

    // Set timeout to auto-cancel if no response within 5 minutes
    if (elicitationTimeoutRef.current) {
      clearTimeout(elicitationTimeoutRef.current);
    }
    elicitationTimeoutRef.current = setTimeout(() => {
      setElicitation(null);
    }, 5 * 60 * 1000);
  }, []);

  // Submit elicitation response to BFF
  const submitElicitation = useCallback(async (response) => {
    if (!elicitation || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await bffAxios.post('/api/mcp/elicit/response', {
        elicitationId: elicitation.elicitationId,
        action: response.action,
        content: response.content || undefined,
      });

      // Clear the elicitation dialog
      setElicitation(null);
      if (elicitationTimeoutRef.current) {
        clearTimeout(elicitationTimeoutRef.current);
      }
    } catch (err) {
      console.error('Failed to submit elicitation response:', err);
      // Keep dialog open on error so user can retry
    } finally {
      setIsSubmitting(false);
    }
  }, [elicitation, isSubmitting]);

  const cancel = useCallback(() => {
    setElicitation(null);
    if (elicitationTimeoutRef.current) {
      clearTimeout(elicitationTimeoutRef.current);
    }
  }, []);

  return {
    elicitation,
    isSubmitting,
    handleElicitationRequest,
    submitElicitation,
    cancel,
  };
}

export default useElicitation;
