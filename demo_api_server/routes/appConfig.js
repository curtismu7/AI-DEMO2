const express = require('express');
const router = express.Router();
const configStore = require('../services/configStore');
const { getAppConfig, fixLogoutUrls, auditAppConfig } = require('../services/pingoneAppConfigService');

// GET /api/admin/app-config/:appType — get PingOne app config (admin or user)
router.get('/:appType', async (req, res) => {
  try {
    const { appType } = req.params;
    let appId;
    if (appType === 'admin') {
      appId = configStore.getEffective('admin_client_id') || configStore.getEffective('pingone_client_id');
    } else if (appType === 'user') {
      appId = configStore.getEffective('user_client_id');
    } else {
      return res.status(400).json({ error: 'Invalid appType. Use "admin" or "user".' });
    }
    if (!appId) {
      return res.status(404).json({ error: `${appType}_client_id not configured` });
    }
    const config = await getAppConfig(appId);
    res.json({ appType, appId, config });
  } catch (err) {
    console.error(`[appConfig] GET /${req.params.appType} error:`, err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// POST /api/admin/fix-logout-urls — fix logout URLs on both apps
router.post('/fix-logout-urls', async (req, res) => {
  try {
    const publicAppUrl = req.body?.publicAppUrl || configStore.getEffective('public_app_url');
    const results = [];

    const adminId = configStore.getEffective('admin_client_id') || configStore.getEffective('pingone_client_id');
    const userId = configStore.getEffective('user_client_id');

    if (adminId) {
      results.push(await fixLogoutUrls(adminId, publicAppUrl));
    } else {
      results.push({ appType: 'admin', skipped: true, reason: 'admin_client_id not configured' });
    }

    if (userId) {
      results.push(await fixLogoutUrls(userId, publicAppUrl));
    } else {
      results.push({ appType: 'user', skipped: true, reason: 'user_client_id not configured' });
    }

    res.json({ results, publicAppUrl });
  } catch (err) {
    console.error('[appConfig] fix-logout-urls error:', err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/admin/app-config/audit/all — audit both apps
router.get('/audit/all', async (_req, res) => {
  try {
    const reports = [];

    const adminId = configStore.getEffective('admin_client_id') || configStore.getEffective('pingone_client_id');
    const userId = configStore.getEffective('user_client_id');

    if (adminId) {
      reports.push({ appType: 'admin', ...await auditAppConfig(adminId) });
    }
    if (userId) {
      reports.push({ appType: 'user', ...await auditAppConfig(userId) });
    }

    const totalIssues = reports.reduce((sum, r) => sum + (r.issueCount || 0), 0);
    res.json({ reports, totalIssues, allHealthy: totalIssues === 0 });
  } catch (err) {
    console.error('[appConfig] audit error:', err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

module.exports = router;
