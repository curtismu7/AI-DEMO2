/**
 * OKF Loader Service
 *
 * Reads, validates, and serves Open Knowledge Format (OKF) bundles from disk.
 * Bundles are indexed by domain slug and served to consumers (e.g., the demo
 * agent's system prompt builder) via `getAssertions(domain)` and `formatForPrompt(domain)`.
 *
 * Usage:
 *   const okfLoader = require('./okfLoaderService');
 *   await okfLoader.initialize();  // or initialize('/custom/path')
 *   const assertions = okfLoader.getAssertions('banking-domain');
 *   const promptBlock = okfLoader.formatForPrompt('banking-domain');
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_BUNDLE_DIR = path.resolve(__dirname, '../../graphify-out');
const REQUIRED_CONTEXT = 'https://okf.ping.dev/v0.1';
const MAX_ASSERTIONS = 50;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Map<string, object>} domain -> parsed bundle */
const bundleIndex = new Map();

/** @type {boolean} */
let initialized = false;

/** @type {string|null} */
let loadedFromDir = null;

// ---------------------------------------------------------------------------
// Validation (lightweight — no runtime ajv dependency)
// ---------------------------------------------------------------------------

/**
 * Validates a parsed bundle object against OKF v0.1 requirements.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
function validateBundle(bundle, filename) {
  const errors = [];

  if (!bundle || typeof bundle !== 'object') {
    return { valid: false, errors: [`${filename}: not a valid JSON object`] };
  }

  // Envelope required fields
  if (bundle['@context'] !== REQUIRED_CONTEXT) {
    errors.push(`${filename}: @context must be "${REQUIRED_CONTEXT}", got "${bundle['@context']}"`);
  }
  if (typeof bundle.id !== 'string' || !/^urn:okf:[a-z0-9\-]+:[a-z0-9\-]+:[0-9a-f\-]{36}$/.test(bundle.id)) {
    errors.push(`${filename}: id must match urn:okf:<org>:<domain>:<uuid> pattern`);
  }
  if (typeof bundle.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(bundle.version)) {
    errors.push(`${filename}: version must be semver (e.g., "1.0.0")`);
  }
  if (typeof bundle.domain !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(bundle.domain)) {
    errors.push(`${filename}: domain must be kebab-case slug`);
  }
  if (typeof bundle.title !== 'string' || bundle.title.length === 0) {
    errors.push(`${filename}: title is required`);
  }
  if (!Array.isArray(bundle.assertions) || bundle.assertions.length === 0) {
    errors.push(`${filename}: assertions must be a non-empty array`);
  }
  if (Array.isArray(bundle.assertions) && bundle.assertions.length > MAX_ASSERTIONS) {
    errors.push(`${filename}: assertions exceeds max ${MAX_ASSERTIONS}`);
  }

  // Validate each assertion
  if (Array.isArray(bundle.assertions)) {
    const seenIds = new Set();
    bundle.assertions.forEach((a, i) => {
      const prefix = `${filename} assertions[${i}]`;
      if (typeof a.id !== 'string' || !/^K([1-9]|[1-4]\d|50)$/.test(a.id)) {
        errors.push(`${prefix}: id must match K1–K50 (got "${a.id}")`);
      } else if (seenIds.has(a.id)) {
        errors.push(`${prefix}: duplicate assertion id "${a.id}" — each id must be unique within a bundle`);
      } else {
        seenIds.add(a.id);
      }
      if (typeof a.claim !== 'string' || a.claim.length < 10) {
        errors.push(`${prefix}: claim must be a string of at least 10 chars`);
      }
      if (typeof a.claim === 'string' && a.claim.length > 500) {
        errors.push(`${prefix}: claim exceeds max length of 500 chars (got ${a.claim.length})`);
      }
      if (typeof a.source !== 'string' || a.source.length === 0) {
        errors.push(`${prefix}: source is required`);
      }
      if (typeof a.source === 'string' && a.source.length > 300) {
        errors.push(`${prefix}: source exceeds max length of 300 chars (got ${a.source.length})`);
      }
      if (typeof a.confidence !== 'number' || a.confidence < 0 || a.confidence > 1) {
        errors.push(`${prefix}: confidence must be a number between 0 and 1`);
      }
    });
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Initializes the loader by scanning a directory for .okf.json files.
 * Safe to call multiple times (re-initializes / hot-reloads).
 *
 * @param {string} [bundleDir] - Path to the bundle directory. Defaults to graphify-out/
 * @returns {{ loaded: number, errors: string[] }}
 */
function initialize(bundleDir) {
  const dir = bundleDir || DEFAULT_BUNDLE_DIR;
  const result = { loaded: 0, errors: [] };

  bundleIndex.clear();

  // Graceful handling: directory doesn't exist
  if (!fs.existsSync(dir)) {
    result.errors.push(`Bundle directory not found: ${dir}`);
    initialized = true;
    loadedFromDir = dir;
    return result;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.okf.json'));

  if (files.length === 0) {
    result.errors.push(`No .okf.json files found in ${dir}`);
    initialized = true;
    loadedFromDir = dir;
    return result;
  }

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const bundle = JSON.parse(raw);
      const validation = validateBundle(bundle, file);

      if (!validation.valid) {
        result.errors.push(...validation.errors);
        continue;
      }

      // Index by domain
      if (bundleIndex.has(bundle.domain)) {
        result.errors.push(`${file}: duplicate domain "${bundle.domain}" (already loaded)`);
        continue;
      }

      bundleIndex.set(bundle.domain, bundle);
      result.loaded++;
    } catch (err) {
      result.errors.push(`${file}: ${err.message}`);
    }
  }

  initialized = true;
  loadedFromDir = dir;
  return result;
}

/**
 * Returns all assertions for a given domain, or an empty array if not found.
 *
 * @param {string} domain - The domain slug (e.g., "banking-domain")
 * @param {object} [opts] - Optional filters
 * @param {string[]} [opts.tags] - Only return assertions containing at least one of these tags
 * @returns {object[]} Array of assertion objects
 */
function getAssertions(domain, opts = {}) {
  if (!initialized) {
    initialize();
  }

  const bundle = bundleIndex.get(domain);
  if (!bundle) return [];

  let assertions = bundle.assertions;

  // Tag filtering
  if (opts.tags && opts.tags.length > 0) {
    assertions = assertions.filter(a =>
      a.tags && a.tags.some(t => opts.tags.includes(t))
    );
  }

  // Return a shallow copy to prevent consumers from mutating the bundle index
  return assertions === bundle.assertions ? [...assertions] : assertions;
}

/**
 * Formats assertions for injection into an LLM system prompt.
 * Returns the formatted <knowledge> block, or an empty string if no assertions found.
 *
 * @param {string} domain - The domain slug
 * @param {object} [opts] - Same filter options as getAssertions
 * @returns {string} Prompt-ready knowledge block
 */
function formatForPrompt(domain, opts = {}) {
  const assertions = getAssertions(domain, opts);
  if (assertions.length === 0) return '';

  const bundle = bundleIndex.get(domain);
  const lines = assertions.map(a => {
    // Sanitize claims: strip only known dangerous patterns that could break
    // the <knowledge> block structure or inject LLM control sequences.
    // Preserves legitimate angle brackets (e.g., "< $5,000", "<IBAN>").
    const safeClaim = a.claim
      .replace(/<\/?knowledge[^>]*>/gi, '')    // strip </knowledge> injection attempts
      .replace(/<\|[^|]*\|>/g, '');            // strip <|im_end|>, <|system|> etc.
    const safeSource = a.source
      .replace(/<\/?knowledge[^>]*>/gi, '')
      .replace(/<\|[^|]*\|>/g, '');
    return `[${a.id}] ${safeClaim} Source: ${safeSource}`;
  });

  return [
    `<knowledge domain="${domain}" version="${bundle.version}">`,
    ...lines,
    '</knowledge>',
    '',
    'INSTRUCTIONS: When answering questions covered by a [Kn] assertion above, cite it inline (e.g., "...per policy [K4]"). Do not contradict these assertions — they are ground truth. If a question falls outside the knowledge block, answer normally without fabricating citations.',
  ].join('\n');
}

/**
 * Returns a list of all loaded domain slugs.
 * @returns {string[]}
 */
function listDomains() {
  if (!initialized) initialize();
  return Array.from(bundleIndex.keys());
}

/**
 * Returns metadata about a loaded bundle (without assertions).
 * @param {string} domain
 * @returns {object|null}
 */
function getBundleMeta(domain) {
  if (!initialized) initialize();
  const bundle = bundleIndex.get(domain);
  if (!bundle) return null;

  return {
    id: bundle.id,
    domain: bundle.domain,
    version: bundle.version,
    title: bundle.title,
    description: bundle.description || null,
    assertionCount: bundle.assertions.length,
    created: bundle.created || null,
    updated: bundle.updated || null,
    authors: bundle.authors || [],
  };
}

/**
 * Returns whether the loader has been initialized.
 * @returns {boolean}
 */
function isInitialized() {
  return initialized;
}

/**
 * Resets internal state (for testing).
 */
function reset() {
  bundleIndex.clear();
  initialized = false;
  loadedFromDir = null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  initialize,
  getAssertions,
  formatForPrompt,
  listDomains,
  getBundleMeta,
  isInitialized,
  reset,
  // Exported for testing
  _validateBundle: validateBundle,
  _bundleIndex: bundleIndex,
};
