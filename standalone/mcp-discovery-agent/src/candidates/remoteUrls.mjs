import { normalizeCandidate } from '../inventory.mjs';
import { evaluateTarget } from '../policy.mjs';

export async function discoverRemoteUrls(urls = []) {
  const candidates = [];
  const diagnostics = [];
  for (const value of urls) {
    const policy = evaluateTarget(value, { scope: 'remote' });
    if (!policy.allowed) {
      diagnostics.push({ target: value, reason: policy.reason });
      continue;
    }
    candidates.push(normalizeCandidate({
      displayName: new URL(policy.normalizedUrl).hostname,
      source: 'remote-url', confidence: 'configured', location: 'remote', transport: 'streamable-http',
      endpoint: policy.normalizedUrl,
    }));
  }
  return { candidates, diagnostics };
}
