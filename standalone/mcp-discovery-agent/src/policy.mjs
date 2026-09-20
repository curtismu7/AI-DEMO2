import dns from 'node:dns/promises';
import net from 'node:net';

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
];

function hasCredentials(url) {
  return Boolean(url.username || url.password);
}

function isPrivateIp(hostname) {
  if (net.isIPv4(hostname)) return PRIVATE_IPV4.some((pattern) => pattern.test(hostname));
  if (net.isIPv6(hostname)) return hostname === '::1' || hostname.toLowerCase().startsWith('fe80:') || hostname.toLowerCase().startsWith('fc');
  return false;
}

export function evaluateTarget(target, { scope = 'remote', allowRemotePrivate = false } = {}) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return { allowed: false, reason: 'invalid_url', normalizedUrl: null };
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { allowed: false, reason: 'unsupported_scheme', normalizedUrl: null };
  if (hasCredentials(url)) return { allowed: false, reason: 'credentials_not_allowed', normalizedUrl: null };
  if (scope === 'remote' && !allowRemotePrivate && (isPrivateIp(url.hostname) || url.hostname === 'localhost')) {
    return { allowed: false, reason: 'private_remote_target', normalizedUrl: null };
  }
  url.hash = '';
  return { allowed: true, reason: null, normalizedUrl: url.toString() };
}

export async function resolveAndEvaluateTarget(target, options = {}) {
  const initial = evaluateTarget(target, options);
  if (!initial.allowed || options.scope !== 'remote') return initial;
  const hostname = new URL(initial.normalizedUrl).hostname;
  if (net.isIP(hostname)) return initial;
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!options.allowRemotePrivate && addresses.some(({ address }) => isPrivateIp(address))) {
      return { allowed: false, reason: 'private_remote_resolution', normalizedUrl: null };
    }
  } catch {
    return { allowed: false, reason: 'dns_resolution_failed', normalizedUrl: null };
  }
  return initial;
}
