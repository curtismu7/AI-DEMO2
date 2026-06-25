'use strict';

const { Router } = require('express');
const { validateResources } = require('../services/resourceValidationService');
const { auditResourceScopes } = require('../services/scopeAuditService');

const router = Router();

/**
 * GET /api/pingone/audit
 * Unified endpoint: validates resource servers + audits scopes
 * Requires: authenticated user (session)
 */
router.get('/', async (req, res) => {
  try {
    // Require authentication
    if (!req.session || !req.session.user || !req.session.user.id) {
      return res.status(401).json({ error: 'Unauthorized - authentication required' });
    }

    // Step 1: Validate resource servers
    const resourceValidation = await validateResources();

    if (resourceValidation.status !== 'success') {
      // Return 200 with error payload — lets the UI render a helpful message instead of throwing
      return res.status(200).json({
        status: 'error',
        error: resourceValidation.error || 'Failed to validate PingOne resources',
        auditedAt: new Date().toISOString(),
        resourceValidation: [],
        scopeAudit: [],
      });
    }

    // Step 2: Audit scopes on correctly found resources
    const validatedResources = resourceValidation.resourceValidation.filter((r) => r.status !== 'MISSING');
    const scopeAudit = await auditResourceScopes(validatedResources);

    if (scopeAudit.status !== 'success') {
      return res.status(200).json({
        status: 'error',
        error: scopeAudit.error || 'Failed to audit PingOne resource scopes',
        auditedAt: new Date().toISOString(),
        resourceValidation: resourceValidation.resourceValidation,
        scopeAudit: [],
      });
    }

    // Return combined results
    return res.status(200).json({
      status: 'success',
      auditedAt: new Date().toISOString(),
      resourceValidation: resourceValidation.resourceValidation,
      scopeAudit: scopeAudit.scopeAudit,
    });
  } catch (error) {
    console.error('Error in /api/pingone/audit:', error.message);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

module.exports = router;
