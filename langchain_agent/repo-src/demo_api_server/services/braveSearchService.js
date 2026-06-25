// banking_api_server/services/braveSearchService.js
/**
 * BFF-side Brave Search API wrapper.
 * The API key stays server-side only — results (not the key) are returned to the UI.
 * OWASP A3: Sensitive data (BRAVE_SEARCH_API_KEY) never reaches the client.
 */
'use strict';

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

/**
 * @param {string} query  Search terms
 * @param {{ count?: number }} [options]
 * @returns {Promise<{ query: string, results: { title: string, url: string, description: string }[] }>}
 */
async function search(query, { count = 5 } = {}) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) {
    throw {
      code: 'BRAVE_NOT_CONFIGURED',
      message: 'Brave Search is not configured. Set BRAVE_SEARCH_API_KEY in your environment.',
    };
  }

  const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: {
      'X-Subscription-Token': key,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    throw {
      code: 'BRAVE_API_ERROR',
      status: res.status,
      message: 'Brave Search API error',
    };
  }

  const data = await res.json();
  return {
    query,
    results: (data.web?.results || []).map((r) => ({
      title: r.title || '',
      url: r.url || '',
      description: r.description || '',
    })),
  };
}

function isConfigured() {
  return !!process.env.BRAVE_SEARCH_API_KEY;
}

module.exports = { search, isConfigured };
