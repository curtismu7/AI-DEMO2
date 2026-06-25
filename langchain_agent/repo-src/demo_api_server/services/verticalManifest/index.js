'use strict';

const path = require('path');
const { createLoader } = require('./loader');
const { createOverlay } = require('./overlay');
const { createResolver } = require('./resolver');
const { createScope } = require('./scope');
const { createEvents } = require('./events');
const { createSnapshot } = require('./snapshot');
const { createPlugins } = require('./plugins');
const store = require('../lmdb/verticalStore.lmdb');

// admin-console: deprecated; admin: role-based overlay; oauth-teaching: reached
// exclusively via its dedicated /oauth-academy page (pinned per-request through
// the demo-agent `vertical` param), not the vertical switcher.
const HIDDEN_IDS = new Set(['admin-console', 'admin', 'oauth-teaching']);

function build() {
  const root = process.env.VERTICAL_SEED_ROOT
    || path.join(__dirname, '..', '..', 'config', 'verticals');
  const loader = createLoader(root);
  const plugins = createPlugins(root);

  // Events is created early because the resolver fires through it.
  // getInitialActiveId is a thunk so it reads the current value on every
  // new connection.
  const events = createEvents({ getInitialActiveId: () => store.getActiveId() });

  const overlay = createOverlay(store, loader);
  const resolver = createResolver(loader, overlay, store, {
    onEvent: (type, payload) => events.emit(type, payload),
  });
  const scope = createScope(resolver);

  const snapshot = createSnapshot(store, resolver.overlay, {
    getActiveId: () => resolver.activeId(),
    setActiveId: (id) => resolver.setActive(id),
    onRestoredId: (id) => events.emit('vertical-edited', { id }),
    onRestoredActive: (id) => events.emit('vertical-switched', { activeId: id }),
  });

  let initialized = false;
  function init() {
    if (initialized) return;
    loader.loadAll();
    initialized = true;
  }

  // Test helper: re-read seeds + wipe in-memory init flag. Not for production.
  function _reset() {
    initialized = false;
    loader.loadAll();
  }

  function list() {
    return loader.list().filter((v) => !HIDDEN_IDS.has(v.id));
  }

  function listAll() { return loader.list(); }

  return {
    init, _reset,
    list, listAll,
    loader,
    plugins,
    overlay: resolver.overlay,
    resolver,
    scope,
    events,
    snapshot,
    store,
    HIDDEN_IDS,
  };
}

const verticalManifest = build();

module.exports = { verticalManifest };
