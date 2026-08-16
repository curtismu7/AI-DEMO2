'use strict';

// Per-vertical theme-zone overrides.
//
// Stores a single JSON blob per vertical in configStore under
// `vertical_theme_overrides_<id>` → { "--brand-…": "#hex", … }. The server is a
// blind merge: it validates that keys are theme brand vars and values are colors,
// then stores whatever the client sends. Zone semantics live entirely in the
// frontend registry (themeZones.js). See skill: vertical-theme-zones.
//
// Fully public — no auth mount in server.js (deliberate; see server.js's mount
// comment). Overrides are GLOBAL per vertical — any visitor's pick changes what
// everyone sees for that vertical (last write wins).

const express = require('express');
const router = express.Router();
const configStore = require('../services/configStore');
const { verticalManifest } = require('../services/verticalManifest');

const ID_RE = /^[a-z][a-z0-9-]*$/;
// Only brand/app/theme custom properties may be overridden. Case-sensitive: CSS
// custom-property names are case-sensitive and the client only ever sends the
// canonical lowercase names from themeZones.js, so an uppercase key would store
// an entry that could never be matched/applied.
const VAR_RE = /^--(?:brand|app|theme)[a-z0-9-]*$/;
// Accept #rgb / #rrggbb / #rrggbbaa or rgb()/rgba().
const COLOR_RE =
  /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$|^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

const storeKey = (id) => `vertical_theme_overrides_${id}`;

// A vertical id is writable only if it is a known vertical (listAll includes
// hidden ones like the admin overlay). Rejects phantom/typo ids that would
// otherwise pollute the store with overrides that are never served.
const isKnownVertical = (id) => verticalManifest.listAll().some((v) => v.id === id);

function readBlob(id) {
  const raw = configStore.get(storeKey(id));
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// GET all verticals' overrides → { [verticalId]: { cssVar: hex } }
router.get('/vertical-themes', (_req, res) => {
  const out = {};
  for (const v of verticalManifest.list()) {
    const blob = readBlob(v.id);
    if (Object.keys(blob).length) out[v.id] = blob;
  }
  res.json(out);
});

// PUT — merge the provided cssVars into the vertical's blob (per-zone updates
// never clobber other zones).
router.put('/vertical-themes/:verticalId', async (req, res) => {
  const id = req.params.verticalId;
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid vertical id' });
  if (!isKnownVertical(id)) return res.status(404).json({ error: 'unknown vertical' });

  const incoming = req.body && req.body.cssVars;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'cssVars object required' });
  }

  const clean = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (!VAR_RE.test(k) || typeof v !== 'string' || !COLOR_RE.test(v.trim())) {
      return res.status(400).json({ error: `invalid override: ${k}` });
    }
    clean[k] = v.trim();
  }

  const merged = { ...readBlob(id), ...clean };
  await configStore.setRaw({ [storeKey(id)]: JSON.stringify(merged) }, { persist: true });
  res.json({ ok: true, cssVars: merged });
});

// DELETE — remove specific vars (body.vars: string[]) or clear all overrides.
router.delete('/vertical-themes/:verticalId', async (req, res) => {
  const id = req.params.verticalId;
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid vertical id' });
  if (!isKnownVertical(id)) return res.status(404).json({ error: 'unknown vertical' });

  const varsToRemove = Array.isArray(req.body && req.body.vars) ? req.body.vars : null;
  if (varsToRemove) {
    const blob = readBlob(id);
    for (const k of varsToRemove) delete blob[k];
    await configStore.setRaw({ [storeKey(id)]: JSON.stringify(blob) }, { persist: true });
    return res.json({ ok: true, cssVars: blob });
  }

  await configStore.setRaw({ [storeKey(id)]: '' }, { persist: true });
  res.json({ ok: true, cssVars: {} });
});

module.exports = router;
