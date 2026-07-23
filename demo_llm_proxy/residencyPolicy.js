// demo_llm_proxy/residencyPolicy.js
'use strict';

/**
 * Host RAM policy for llama.cpp residency.
 *
 * - Dual (8091+8096): needs headroom for phi + gpt-oss (~11GB GGUF) + Docker/OS.
 * - Low-RAM (< dualMinGb, e.g. 24GB Air): refuse dual → pin phi (:8091) only.
 * - Explicit empty LLM_PROXY_RESIDENT_TIERS: classic one-tier swap (honored).
 * - LLM_PROXY_FORCE_DUAL=1: keep dual even on low RAM (may OOM).
 *
 * PingAWS / k8s uses tier-manager-k8 swap (one Deployment) — this policy is
 * for local host llama-server via run-docker.sh only.
 */

const { parseResidentPorts } = require('./ensureArgs');

const DEFAULT_DUAL = '8091,8096';
const DEFAULT_PIN = '8091';
/** Total physical RAM below this → refuse multi-port residency. */
const DUAL_MIN_TOTAL_GB = 32;

/**
 * Read total physical RAM in GiB (0 if unknown).
 * @returns {number}
 */
function readTotalRamGb() {
  try {
    if (process.platform === 'darwin') {
      const { execFileSync } = require('child_process');
      const bytes = Number(execFileSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' }).trim());
      if (Number.isFinite(bytes) && bytes > 0) return Math.round(bytes / (1024 ** 3));
    }
    if (process.platform === 'linux') {
      const fs = require('fs');
      const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemTotal:\s+(\d+)\s+kB/m);
      if (m) return Math.round(Number(m[1]) / (1024 * 1024));
    }
  } catch (_) {
    /* unknown */
  }
  return 0;
}

/**
 * @param {object} opts
 * @param {number} opts.totalRamGb
 * @param {boolean} opts.residentTiersExplicit  true if LLM_PROXY_RESIDENT_TIERS is set in env
 * @param {string} [opts.residentTiersEnv]
 * @param {string} [opts.pinTierEnv]
 * @param {boolean} [opts.forceDual]
 * @param {number} [opts.dualMinGb]
 * @returns {{ mode: string, residentTiers: string, pinTier: string, reason: string }}
 */
function resolveResidencyPolicy(opts) {
  const dualMin = opts.dualMinGb ?? DUAL_MIN_TOTAL_GB;
  const forceDual = !!opts.forceDual;
  const pinEnv = String(opts.pinTierEnv || '').trim();
  const total = Number(opts.totalRamGb) || 0;
  const lowRam = total > 0 && total < dualMin;

  let requested;
  if (opts.residentTiersExplicit) {
    requested = String(opts.residentTiersEnv ?? '').trim();
  } else {
    requested = DEFAULT_DUAL;
  }

  const ports = parseResidentPorts(requested);
  const wantsMulti = ports.length >= 2;

  if (wantsMulti && lowRam && !forceDual) {
    return {
      mode: 'pin-phi',
      residentTiers: '',
      pinTier: pinEnv || DEFAULT_PIN,
      reason:
        `total RAM ${total}GB < ${dualMin}GB — dual residency refused; `
        + `pinning :${pinEnv || DEFAULT_PIN} (set LLM_PROXY_FORCE_DUAL=1 to override)`,
    };
  }

  if (ports.length >= 2) {
    return {
      mode: 'dual',
      residentTiers: ports.join(','),
      pinTier: pinEnv,
      reason: total
        ? `dual residency ${ports.join(',')} (${total}GB RAM)`
        : `dual residency ${ports.join(',')}`,
    };
  }

  if (ports.length === 1) {
    return {
      mode: 'resident-one',
      residentTiers: ports[0],
      pinTier: pinEnv,
      reason: `single resident :${ports[0]}`,
    };
  }

  // Empty resident set (explicit classic, or unset already handled as DEFAULT_DUAL)
  if (opts.residentTiersExplicit) {
    return {
      mode: pinEnv ? 'pin' : 'classic',
      residentTiers: '',
      pinTier: pinEnv,
      reason: pinEnv
        ? `classic swap with pin :${pinEnv}`
        : 'classic one-tier swap (LLM_PROXY_RESIDENT_TIERS empty)',
    };
  }

  // Unset + unknown RAM → keep historical dual default
  return {
    mode: 'dual',
    residentTiers: DEFAULT_DUAL,
    pinTier: pinEnv,
    reason: 'dual residency (RAM unknown — default)',
  };
}

/**
 * Policy from process.env + live RAM.
 * @returns {{ totalRamGb: number, mode: string, residentTiers: string, pinTier: string, reason: string }}
 */
function resolveFromEnv(env = process.env) {
  const totalRamGb = readTotalRamGb();
  const policy = resolveResidencyPolicy({
    totalRamGb,
    residentTiersExplicit: Object.prototype.hasOwnProperty.call(env, 'LLM_PROXY_RESIDENT_TIERS'),
    residentTiersEnv: env.LLM_PROXY_RESIDENT_TIERS,
    pinTierEnv: env.LLM_PROXY_PIN_TIER || '',
    forceDual: env.LLM_PROXY_FORCE_DUAL === '1' || env.LLM_PROXY_FORCE_DUAL === 'true',
  });
  return { totalRamGb, ...policy };
}

if (require.main === module) {
  const result = resolveFromEnv();
  if (process.argv.includes('--shell')) {
    // Safe for: eval "$(node residencyPolicy.js --shell)"
    const q = (s) => `'${String(s).replace(/'/g, `'\"'\"'`)}'`;
    process.stdout.write(`_LLM_RESIDENT_TIERS=${q(result.residentTiers)}\n`);
    process.stdout.write(`_LLM_PIN_TIER=${q(result.pinTier)}\n`);
    process.stdout.write(`_LLM_RESIDENCY_MODE=${q(result.mode)}\n`);
    process.stdout.write(`_LLM_RESIDENCY_REASON=${q(result.reason)}\n`);
    process.stdout.write(`_LLM_TOTAL_RAM_GB=${q(String(result.totalRamGb))}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

module.exports = {
  DUAL_MIN_TOTAL_GB,
  DEFAULT_DUAL,
  DEFAULT_PIN,
  readTotalRamGb,
  resolveResidencyPolicy,
  resolveFromEnv,
};
