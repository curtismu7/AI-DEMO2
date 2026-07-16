/**
 * Citation Parser Utility
 *
 * Parses message text containing [K1]–[K50] citation references and splits
 * it into structured segments for rendering.
 *
 * Usage:
 *   import { parseCitations, useCitationResolver } from './parseCitations';
 *
 *   const segments = parseCitations('Balance is calculated per policy [K1] and limits [K2].');
 *   // → [
 *   //   { type: 'text', content: 'Balance is calculated per policy ' },
 *   //   { type: 'citation', id: 'K1', raw: '[K1]' },
 *   //   { type: 'text', content: ' and limits ' },
 *   //   { type: 'citation', id: 'K2', raw: '[K2]' },
 *   //   { type: 'text', content: '.' },
 *   // ]
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pattern for matching [K1] through [K50] */
const CITATION_PATTERN = '\\[K(\\d{1,2})\\]';

/** Max valid assertion ID number (matches schema maxItems: 50) */
const MAX_ASSERTION_NUM = 50;

/**
 * Creates a fresh regex instance (avoids stateful /g lastIndex issues with
 * shared module-level regex). Each function call gets its own regex.
 * @returns {RegExp}
 */
function createCitationRegex() {
  return new RegExp(CITATION_PATTERN, 'g');
}

// ---------------------------------------------------------------------------
// Core Parser
// ---------------------------------------------------------------------------

/**
 * Parses a message string into an array of text and citation segments.
 *
 * @param {string} text - The message text to parse
 * @returns {Array<{type: 'text'|'citation', content?: string, id?: string, raw?: string}>}
 */
function parseCitations(text) {
  if (!text || typeof text !== 'string') return [{ type: 'text', content: '' }];

  const segments = [];
  let lastIndex = 0;
  const regex = createCitationRegex();

  let match;
  while ((match = regex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);

    // Only treat as citation if within valid range
    if (num < 1 || num > MAX_ASSERTION_NUM) {
      continue;
    }

    // Add preceding text segment (if any)
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }

    // Add citation segment
    segments.push({
      type: 'citation',
      id: `K${num}`,
      raw: match[0],
    });

    lastIndex = match.index + match[0].length;
  }

  // Add trailing text
  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  // Edge case: no segments at all (empty or whitespace-only input already handled)
  if (segments.length === 0) {
    segments.push({ type: 'text', content: text });
  }

  return segments;
}

/**
 * Extracts unique citation IDs from a message string.
 *
 * @param {string} text
 * @returns {string[]} Sorted array of unique IDs, e.g. ['K1', 'K3', 'K7']
 */
function extractCitationIds(text) {
  if (!text || typeof text !== 'string') return [];

  const ids = new Set();
  const regex = createCitationRegex();

  let match;
  while ((match = regex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= MAX_ASSERTION_NUM) {
      ids.add(`K${num}`);
    }
  }

  return Array.from(ids).sort((a, b) => {
    const na = parseInt(a.slice(1), 10);
    const nb = parseInt(b.slice(1), 10);
    return na - nb;
  });
}

/**
 * Checks whether a message contains any valid OKF citations.
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasCitations(text) {
  return extractCitationIds(text).length > 0;
}

// ---------------------------------------------------------------------------
// Citation Resolver (for client-side fetching)
// ---------------------------------------------------------------------------

/**
 * Creates a citation resolver that fetches assertion metadata from the API.
 * Caches results per domain to avoid redundant network calls.
 *
 * @param {string} [apiBase='/api/okf'] - Base URL for OKF API
 * @returns {object} Resolver with resolve(domain, id) method
 */
function createCitationResolver(apiBase = '/api/okf') {
  const cache = new Map(); // domain -> Map<id, assertion>

  return {
    /**
     * Resolves a citation ID to its full assertion metadata.
     *
     * @param {string} domain - e.g. 'banking-domain'
     * @param {string} id - e.g. 'K1'
     * @returns {Promise<object|null>} The assertion object or null
     */
    async resolve(domain, id) {
      // Check cache first
      if (cache.has(domain)) {
        const domainCache = cache.get(domain);
        if (domainCache.has(id)) {
          return domainCache.get(id);
        }
      }

      // Fetch all assertions for the domain (more efficient than per-id calls)
      try {
        const response = await fetch(`${apiBase}/assertions/${domain}`);
        if (!response.ok) return null;

        const data = await response.json();
        const assertions = data.assertions || [];

        // Populate cache
        const domainCache = new Map();
        assertions.forEach(a => domainCache.set(a.id, a));
        cache.set(domain, domainCache);

        return domainCache.get(id) || null;
      } catch {
        return null;
      }
    },

    /**
     * Resolves all citation IDs in a message at once.
     *
     * @param {string} domain
     * @param {string[]} ids - Array of citation IDs
     * @returns {Promise<Map<string, object>>} Map of id -> assertion
     */
    async resolveAll(domain, ids) {
      const results = new Map();
      // Trigger cache population with first resolve
      for (const id of ids) {
        const assertion = await this.resolve(domain, id);
        if (assertion) results.set(id, assertion);
      }
      return results;
    },

    /** Clears the resolver cache */
    clearCache() {
      cache.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// React Hook (for components)
// ---------------------------------------------------------------------------

/**
 * React hook factory — returns a useCitationResolver hook.
 * Separated to avoid requiring React in non-React contexts.
 *
 * Usage in a React component:
 *   import { createUseCitationHook } from '../utils/parseCitations';
 *   import { useState, useEffect, useRef } from 'react';
 *   const useCitations = createUseCitationHook({ useState, useEffect, useRef });
 *   // In component:
 *   const { assertions, loading } = useCitations('banking-domain', messageText);
 */
function createUseCitationHook({ useState, useEffect, useRef }) {
  const resolver = createCitationResolver();

  return function useCitations(domain, messageText) {
    const [assertions, setAssertions] = useState(new Map());
    const [loading, setLoading] = useState(false);
    const resolverRef = useRef(resolver);

    useEffect(() => {
      const ids = extractCitationIds(messageText);
      if (ids.length === 0) {
        setAssertions(new Map());
        return;
      }

      let cancelled = false;
      setLoading(true);

      resolverRef.current.resolveAll(domain, ids).then(result => {
        if (!cancelled) {
          setAssertions(result);
          setLoading(false);
        }
      });

      return () => { cancelled = true; };
    }, [domain, messageText]);

    return { assertions, loading };
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parseCitations,
  extractCitationIds,
  hasCitations,
  createCitationResolver,
  createUseCitationHook,
  // Exported for testing
  CITATION_PATTERN,
  MAX_ASSERTION_NUM,
  createCitationRegex,
};
