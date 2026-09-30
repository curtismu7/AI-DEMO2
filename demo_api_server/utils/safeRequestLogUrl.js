'use strict';

const PF_OAUTH_CALLBACK_PATH = '/api/pf-ai-agent/cimd/callback';

function safeRequestLogUrl(req = {}) {
  const requestUrl = String(req.originalUrl || req.url || '');
  try {
    const parsed = new URL(requestUrl, 'http://local.invalid');
    if (parsed.pathname === PF_OAUTH_CALLBACK_PATH) return parsed.pathname;
    if (parsed.pathname === '/api/pf-ai-agent/rar/start') {
      parsed.searchParams.delete('userKey');
      return `${parsed.pathname}${parsed.search}`;
    }
    return requestUrl;
  } catch {
    return requestUrl.startsWith(`${PF_OAUTH_CALLBACK_PATH}?`)
      ? PF_OAUTH_CALLBACK_PATH
      : requestUrl;
  }
}

module.exports = safeRequestLogUrl;
