import { useEffect } from 'react';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { isEducationalPath } from '../utils/educationalPages';

/**
 * Hook to prefetch the agent CC token (client credentials) once on component mount.
 * Appends the agent actor token event to the token chain display so it's visible
 * before any MCP tool call fires.
 *
 * Silent operation — no loading state, no error toast. Logs failures to console only.
 */
export function useAgentCCTokenPrefetch() {
  const tokenChain = useTokenChainOptional();

  useEffect(() => {
    if (!tokenChain) return;
    // Skip on documentation-only pages — they don't need agent-context tokens
    // and the BFF returns 401 there, producing noisy DevTools warnings.
    if (isEducationalPath()) return;

    let isMounted = true;

    const prefetchAgentCC = async () => {
      try {
        const res = await fetch('/api/tokens/agent-cc-preview', { credentials: 'include' });
        if (!isMounted || !res.ok) return;
 
        const data = await res.json();
        if (!isMounted) return;

        // Extract tokenEvents from response
        if (!Array.isArray(data.tokenEvents) || data.tokenEvents.length === 0) return;

        const newEvents = data.tokenEvents;

        // Check if agent-actor-token event already exists to avoid duplicates
        // (might be added by a prior MCP call or prefetch)
        const sessionToken = tokenChain.events && tokenChain.events.length > 0 
          ? tokenChain.events[0] 
          : null;
        
        const alreadyHasAgent = (tokenChain.events || []).some(e => 
          e?.id?.startsWith('agent-actor-token') || e?.id === 'agent-cc-not-configured'
        );

        if (alreadyHasAgent) {
          console.debug('[useAgentCCTokenPrefetch] Agent CC token already in chain, skipping');
          return;
        }

        // Prepend agent CC events to existing session token (if any)
        const eventsToAdd = sessionToken ? [...newEvents, sessionToken] : newEvents;
        
        // Use setTokenEvents to add to the chain
        // We use a special tool name to indicate this is a prefetch, not a tool call
        if (tokenChain.setTokenEvents) {
          tokenChain.setTokenEvents('agent-cc-prefetch', eventsToAdd);
        }
      } catch (err) {
        console.warn('[useAgentCCTokenPrefetch] Failed to prefetch agent CC token:', err?.message);
      }
    };

    prefetchAgentCC();

    return () => {
      isMounted = false;
    };
  }, [tokenChain]);
}
