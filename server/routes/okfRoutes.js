/**
 * OKF REST API Routes
 *
 * Provides endpoints for client-side citation resolution.
 *
 * Routes:
 *   GET /api/okf/assertions/:domain        — all assertions for a domain
 *   GET /api/okf/assertions/:domain/:id    — single assertion by ID
 *   GET /api/okf/domains                    — list available domains
 *   GET /api/okf/status                     — injection status (admin/debug)
 *
 * Usage:
 *   const express = require('express');
 *   const router = express.Router();
 *   require('./okfRoutes')(router);
 *   app.use('/api/okf', router);
 */

const okfLoader = require('../services/okfLoaderService');
const { getInjectionStatus } = require('../services/okfPromptInjector');

/**
 * Registers OKF routes on the given Express router.
 * @param {import('express').Router} router
 */
function registerOkfRoutes(router) {
  // Ensure loader is initialized before handling requests
  if (!okfLoader.isInitialized()) {
    okfLoader.initialize();
  }

  /**
   * GET /api/okf/domains
   * Returns list of all loaded domain slugs.
   */
  router.get('/domains', (req, res) => {
    const domains = okfLoader.listDomains();
    res.json({
      domains,
      count: domains.length,
    });
  });

  /**
   * GET /api/okf/assertions/:domain
   * Returns all assertions for a domain, optionally filtered by tags.
   *
   * Query params:
   *   ?tags=fraud,holds — comma-separated tag filter (OR logic)
   */
  router.get('/assertions/:domain', (req, res) => {
    const { domain } = req.params;
    const { tags } = req.query;

    const opts = {};
    if (tags) {
      opts.tags = tags.split(',').map(t => t.trim()).filter(Boolean);
    }

    const assertions = okfLoader.getAssertions(domain, opts);

    if (assertions.length === 0 && !okfLoader.listDomains().includes(domain)) {
      return res.status(404).json({
        error: 'Domain not found',
        domain,
        availableDomains: okfLoader.listDomains(),
      });
    }

    const meta = okfLoader.getBundleMeta(domain);

    res.json({
      domain,
      version: meta ? meta.version : null,
      title: meta ? meta.title : null,
      assertionCount: assertions.length,
      assertions,
    });
  });

  /**
   * GET /api/okf/assertions/:domain/:id
   * Returns a single assertion by domain and ID (e.g., K1).
   */
  router.get('/assertions/:domain/:id', (req, res) => {
    const { domain, id } = req.params;

    // Validate ID format
    if (!/^K\d{1,2}$/.test(id)) {
      return res.status(400).json({
        error: 'Invalid assertion ID format. Expected K1–K50.',
        id,
      });
    }

    const assertions = okfLoader.getAssertions(domain);
    const assertion = assertions.find(a => a.id === id);

    if (!assertion) {
      return res.status(404).json({
        error: 'Assertion not found',
        domain,
        id,
        availableIds: assertions.map(a => a.id),
      });
    }

    res.json({
      domain,
      assertion,
    });
  });

  /**
   * GET /api/okf/status
   * Returns current OKF injection status (for admin/debug panel).
   */
  router.get('/status', (req, res) => {
    const { domain } = req.query;
    const status = getInjectionStatus({ domain });

    res.json({
      ...status,
      availableDomains: okfLoader.listDomains(),
      loaderInitialized: okfLoader.isInitialized(),
    });
  });

  /**
   * POST /api/okf/reload
   * Hot-reloads bundles from disk (admin action).
   */
  router.post('/reload', (req, res) => {
    const result = okfLoader.initialize(); // Re-initialize from default dir
    res.json({
      success: result.loaded > 0 || result.errors.length === 0,
      loaded: result.loaded,
      errors: result.errors,
      domains: okfLoader.listDomains(),
    });
  });
}

module.exports = registerOkfRoutes;
