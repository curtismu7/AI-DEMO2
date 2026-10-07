'use strict';

/**
 * Push-notification (webhook) guard for the A2A specialists.
 *
 * A caller-supplied callback URL is the classic SSRF vector, so a callback is
 * accepted only when ALL hold: https, the hostname is on A2A_PUSH_ALLOWED_HOSTS
 * (exact names, comma separated), and every address it resolves to is public.
 * The check runs when the callback is registered AND again when a notification
 * is about to be sent, so a hostname that later resolves to a private address
 * (DNS rebinding) is dropped. With the allowlist empty, nothing is delivered and
 * the card does not advertise pushNotifications.
 */

const dns = require('node:dns').promises;
const net = require('node:net');
const { InMemoryPushNotificationStore } = require('@a2a-js/sdk/server');

function allowedHosts() {
  return String(process.env.A2A_PUSH_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/** True when the specialists may deliver push notifications at all. */
function pushEnabled() {
  return allowedHosts().length > 0;
}

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateIPv4(mapped[1]);
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return true;
}

async function assertPushUrlAllowed(rawUrl, { lookup = dns.lookup, hosts = allowedHosts() } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('push notification url is not a valid URL');
  }
  if (url.protocol !== 'https:') throw new Error('push notification url must be https');
  const host = url.hostname.toLowerCase();
  if (!hosts.includes(host)) throw new Error(`push notification host "${host}" is not on the allowlist`);
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('push notification url resolves to a private address');
    return url;
  }
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('push notification url resolves to a private address');
  }
  return url;
}

/** Wraps the SDK's in-memory push store so no unsafe callback is stored or read back. */
function createGuardedPushStore(inner = new InMemoryPushNotificationStore(), check = assertPushUrlAllowed) {
  const safeOnly = async (entries, urlOf) => {
    const kept = [];
    for (const entry of entries) {
      try {
        await check(urlOf(entry));
        kept.push(entry);
      } catch (err) {
        console.warn('[a2a-push] dropped callback at send time: %s', err.message);
      }
    }
    return kept;
  };
  return {
    async save(taskId, context, config) {
      await check(config?.url);
      return inner.save(taskId, context, config);
    },
    async load(taskId, context) {
      return safeOnly(await inner.load(taskId, context), (config) => config.url);
    },
    async loadWithMetadata(taskId, context) {
      return safeOnly(await inner.loadWithMetadata(taskId, context), (stored) => stored.config.url);
    },
    delete: (taskId, context, configId) => inner.delete(taskId, context, configId),
  };
}

module.exports = { allowedHosts, pushEnabled, isPrivateAddress, assertPushUrlAllowed, createGuardedPushStore };
