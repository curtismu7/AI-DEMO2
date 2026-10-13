'use strict';

const PF_OAUTH_CALLBACK_PATH = '/api/pf-ai-agent/cimd/callback';
const AIC_OAUTH_CALLBACK_PATH = '/api/aic-demo/callback';

function safeRequestLogUrl(req = {}) {
  const requestUrl = String(req.originalUrl || req.url || '');
  try {
    const parsed = new URL(requestUrl, 'http://local.invalid');
    if (parsed.pathname === PF_OAUTH_CALLBACK_PATH || parsed.pathname === AIC_OAUTH_CALLBACK_PATH) return parsed.pathname;
    if (parsed.pathname === '/api/pf-ai-agent/rar/start') {
      parsed.searchParams.delete('userKey');
      return `${parsed.pathname}${parsed.search}`;
    }
    return requestUrl;
  } catch {
    for (const path of [PF_OAUTH_CALLBACK_PATH, AIC_OAUTH_CALLBACK_PATH]) {
      if (requestUrl.startsWith(`${path}?`)) return path;
    }
    return requestUrl;
  }
}

module.exports = safeRequestLogUrl;
