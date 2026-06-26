const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const router = express.Router();
const dataStore = require('../data/store');
const { requireAdmin, requireScopes, authenticateToken } = require('../middleware/auth');
const { controlPlaneVisible } = require('./appEventsStreamFilter');
const runtimeSettings = require('../config/runtimeSettings');
const {
  resolvePingOneUserForLookup,
  fetchPingOneUsersWithPhone,
} = require('../services/pingOneUserLookupService');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const {
  probeManagementApiAccess,
  getManagementWorkerConfigStatus,
  runPingOneBootstrap,
} = require('../services/pingoneBootstrapService');

/** When SETUP_MASTER_KEY is set, POST /setup/pingone-bootstrap-run must send matching X-Setup-Master-Key. */
function requireSetupMasterKeyIfConfigured(req, res, next) {
  const key = process.env.SETUP_MASTER_KEY;
  if (!key || !String(key).trim()) return next();
  if (req.headers['x-setup-master-key'] === String(key).trim()) return next();
  return res.status(403).json({
    error: 'setup_master_key_required',
    message: 'Set header X-Setup-Master-Key to match the SETUP_MASTER_KEY environment variable.',
  });
}

// Get system statistics
router.get('/stats', requireAdmin, requireScopes(['admin']), (req, res) => {
  try {
    const users = dataStore.getAllUsers();
    const accounts = dataStore.getAllAccounts();
    const transactions = dataStore.getAllTransactions();
    const activityLogs = dataStore.getAllActivityLogs();

    const totalBalance = accounts.reduce((sum, account) => sum + account.balance, 0);
    const averageBalance = accounts.length > 0 ? totalBalance / accounts.length : 0;

    // Group accounts by type and calculate balances
    const accountsByType = {};
    accounts.forEach(account => {
      const type = account.accountType || 'unknown';
      if (!accountsByType[type]) {
        accountsByType[type] = { count: 0, balance: 0 };
      }
      accountsByType[type].count += 1;
      accountsByType[type].balance += account.balance;
    });

    const stats = {
      totalUsers: users.length,
      activeUsers: users.filter(user => user.isActive).length,
      totalAccounts: accounts.length,
      activeAccounts: accounts.filter(account => account.isActive).length,
      totalTransactions: transactions.length,
      totalActivityLogs: activityLogs.length,
      totalBalance,
      averageBalance,
      balanceByType: accountsByType
    };

    res.json({ stats });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /users/hints — up to 5 users with a phone on file, for the customer lookup hint panel.
 * Tries PingOne (mobilePhone pr filter) first; falls back to local store.
 * Returns [{ username, phoneLast4 }].
 */
router.get('/users/hints', requireAdmin, requireScopes(['admin']), async (req, res) => {
  try {
    const { hints: p1Hints, error } = await fetchPingOneUsersWithPhone(5);
    if (p1Hints && p1Hints.length > 0) {
      return res.json({ hints: p1Hints, source: 'pingone' });
    }
    if (error) {
      console.warn('[admin] users/hints PingOne failed, using local fallback:', error);
    }
    const users = dataStore.getAllUsers();
    const hints = users
      .filter((u) => u.username && u.phone)
      .slice(0, 5)
      .map((u) => ({
        username: u.username,
        phoneLast4: String(u.phone).replace(/\D/g, '').slice(-4),
      }));
    res.json({ hints, source: 'local' });
  } catch (err) {
    console.error('[admin] users/hints error:', err.message);
    res.status(500).json({ error: 'hints_failed' });
  }
});

const TX_LOOKUP_LIMIT = 100;

/**
 * POST body: { username } — look up by username (PingOne first, local store fallback),
 * return merged profile, accounts with balances, and recent transactions. No phone verification.
 */
router.post('/transactions/lookup', requireAdmin, requireScopes(['admin']), async (req, res) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    // Try PingOne first; fall back to local store
    let pingOneResolved = { user: null, matchedBy: null, error: null };
    try {
      pingOneResolved = await resolvePingOneUserForLookup({ username });
    } catch (e) {
      console.warn('Admin lookup: PingOne resolve error:', e.message);
      pingOneResolved = { user: null, matchedBy: null, error: e.message || 'lookup_failed' };
    }

    const users = dataStore.getAllUsers();
    const user = users.find((u) => String(u.username || '').toLowerCase() === username.toLowerCase());
    if (!user && !pingOneResolved.user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const localUser = user || { id: username, username };
    const p1 = pingOneResolved?.user || null;

    const firstName = p1?.givenName || localUser.firstName || '';
    const lastName = p1?.familyName || localUser.lastName || '';
    const fullName = (p1?.fullName || `${firstName} ${lastName}`.trim() || localUser.username).trim();
    const email = p1?.email || localUser.email || '';
    const phoneOnRecord = p1?.mobilePhone || localUser.phone || '';

    let transactions = dataStore.getTransactionsByUserId(localUser.id);
    transactions = [...transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const slice = transactions.slice(0, TX_LOOKUP_LIMIT);

    const enriched = slice.map((tx) => {
      const fromAccount = tx.fromAccountId ? dataStore.getAccountById(tx.fromAccountId) : null;
      const toAccount = tx.toAccountId ? dataStore.getAccountById(tx.toAccountId) : null;
      let accountInfo = '—';
      if (fromAccount) {
        accountInfo = `${fromAccount.accountType} - ${fromAccount.accountNumber}`;
      } else if (toAccount) {
        accountInfo = `${toAccount.accountType} - ${toAccount.accountNumber}`;
      }
      return {
        ...tx,
        accountInfo,
        performedBy: fullName || localUser.username,
      };
    });

    const accounts = dataStore.getAccountsByUserId(localUser.id).map((a) => ({
      id: a.id,
      accountNumber: a.accountNumber,
      accountType: a.accountType,
      balance: a.balance,
      currency: a.currency || 'USD',
      isActive: a.isActive !== false,
    }));

    const pingOnePayload = p1
      ? {
          linked: true,
          userId: p1.id,
          matchedBy: pingOneResolved.matchedBy || null,
          lifecycleStatus: p1.lifecycleStatus || '',
          enabled: p1.enabled,
        }
      : {
          linked: false,
          reason: pingOneResolved?.error || 'not_found',
        };

    res.json({
      user: {
        id: localUser.id,
        username: localUser.username,
        firstName,
        lastName,
        fullName,
        email,
        phone: phoneOnRecord,
        phoneOnRecord,
      },
      pingOne: pingOnePayload,
      accounts,
      transactions: enriched,
      count: enriched.length,
      totalTransactions: transactions.length,
    });
  } catch (error) {
    console.error('Admin transactions lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all activity logs
router.get('/activity', authenticateToken, (req, res) => {
  try {
    const { page = 1, limit = 50, username, action, startDate, endDate } = req.query;
    
    let logs = dataStore.getAllActivityLogs();

    // Filter by username
    if (username) {
      logs = logs.filter(log => log.username && log.username.toLowerCase().includes(username.toLowerCase()));
    }

    // Filter by action
    if (action) {
      logs = logs.filter(log => log.action && log.action.toLowerCase().includes(action.toLowerCase()));
    }

    // Filter by date range
    if (startDate) {
      const start = new Date(startDate);
      logs = logs.filter(log => new Date(log.timestamp) >= start);
    }

    if (endDate) {
      const end = new Date(endDate);
      logs = logs.filter(log => new Date(log.timestamp) <= end);
    }

    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedLogs = logs.slice(startIndex, endIndex);

    const totalPages = Math.ceil(logs.length / limit);

    res.json({
      logs: paginatedLogs,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalLogs: logs.length,
        logsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get activity logs by username
router.get('/activity/user/:username', authenticateToken, (req, res) => {
  try {
    const { username } = req.params;
    const { page = 1, limit = 50 } = req.query;

    let logs = dataStore.getActivityLogsByUsername(username);

    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedLogs = logs.slice(startIndex, endIndex);

    const totalPages = Math.ceil(logs.length / limit);

    res.json({
      logs: paginatedLogs,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalLogs: logs.length,
        logsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get user activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get activity logs by user ID
router.get('/activity/userid/:userId', authenticateToken, (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    let logs = dataStore.getActivityLogsByUserId(userId);

    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedLogs = logs.slice(startIndex, endIndex);

    const totalPages = Math.ceil(logs.length / limit);

    res.json({
      logs: paginatedLogs,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalLogs: logs.length,
        logsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get user ID activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get recent activity (last 24 hours)
router.get('/activity/recent', authenticateToken, (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const cutoffTime = new Date(Date.now() - (hours * 60 * 60 * 1000));
    
    const logs = dataStore.getAllActivityLogs()
      .filter(log => new Date(log.timestamp) >= cutoffTime)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ logs });

  } catch (error) {
    console.error('Get recent activity error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get activity summary by action type
router.get('/activity/summary', authenticateToken, (req, res) => {
  try {
    const logs = dataStore.getAllActivityLogs();
    
    const summary = logs.reduce((acc, log) => {
      const action = log.action || 'UNKNOWN';
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {});

    // Convert to array and sort by count
    const summaryArray = Object.entries(summary)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ summary: summaryArray });

  } catch (error) {
    console.error('Get activity summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user activity summary
router.get('/activity/users/summary', authenticateToken, (req, res) => {
  try {
    const logs = dataStore.getAllActivityLogs();
    
    const userSummary = logs.reduce((acc, log) => {
      const username = log.username || 'Unknown';
      if (!acc[username]) {
        acc[username] = {
          username,
          totalActions: 0,
          actions: {}
        };
      }
      
      acc[username].totalActions++;
      const action = log.action || 'UNKNOWN';
      acc[username].actions[action] = (acc[username].actions[action] || 0) + 1;
      
      return acc;
    }, {});

    // Convert to array and sort by total actions
    const summaryArray = Object.values(userSummary)
      .sort((a, b) => b.totalActions - a.totalActions);

    res.json({ userSummary: summaryArray });

  } catch (error) {
    console.error('Get user activity summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear old activity logs (older than specified days)
router.delete('/activity/clear', requireAdmin, requireScopes(['admin']), (req, res) => {
  try {
    const { days = 30 } = req.query;
    const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    
    const logs = dataStore.getAllActivityLogs();
    const logsToKeep = logs.filter(log => new Date(log.timestamp) >= cutoffDate);
    const logsToDelete = logs.filter(log => new Date(log.timestamp) < cutoffDate);

    // Clear all logs and restore only the ones to keep
    dataStore.activityLogs.clear();
    logsToKeep.forEach(log => {
      dataStore.activityLogs.set(log.id, log);
    });

    res.json({ 
      message: `Cleared ${logsToDelete.length} old activity logs`,
      deletedCount: logsToDelete.length,
      remainingCount: logsToKeep.length
    });

  } catch (error) {
    console.error('Clear activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export activity logs (CSV format)
router.get('/activity/export', requireAdmin, requireScopes(['admin']), (req, res) => {
  try {
    const logs = dataStore.getAllActivityLogs()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Create CSV content
    const csvHeaders = 'ID,User ID,Username,Action,Endpoint,IP Address,User Agent,Response Status,Duration (ms),Timestamp\n';
    const csvRows = logs.map(log => {
      return [
        log.id,
        log.userId || '',
        log.username || '',
        log.action || '',
        log.endpoint || '',
        log.ipAddress || '',
        `"${(log.userAgent || '').replace(/"/g, '""')}"`,
        log.responseStatus || '',
        log.duration || '',
        log.timestamp
      ].join(',');
    }).join('\n');

    const csvContent = csvHeaders + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="activity_logs_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);

  } catch (error) {
    console.error('Export activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Runtime Settings ─────────────────────────────────────────────────────────

// GET /api/admin/settings — return current live settings
router.get('/settings', requireAdmin, requireScopes(['admin']), (req, res) => {
  res.json({
    settings: runtimeSettings.getAll(),
    history: runtimeSettings.getHistory(),
  });
});

// PUT /api/admin/settings — update one or more settings at runtime
router.put('/settings', requireAdmin, requireScopes(['admin']), (req, res) => {
  try {
    const changedBy = req.user?.email || req.user?.username || 'admin';
    const result = runtimeSettings.update(req.body, changedBy);

    if (!result.updated) {
      return res.status(400).json({ error: 'No valid settings fields provided.' });
    }

    console.log(`[Settings] Updated by ${changedBy}:`, req.body);
    res.json({ message: 'Settings updated successfully.', settings: result.settings });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── OAuth verbose log (admin UI; file / KV / memory — see oauthVerboseLogStore) ──

const oauthVerboseLogStore = require('../services/oauthVerboseLogStore');

router.get('/oauth-debug-log', requireAdmin, requireScopes(['admin']), async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), oauthVerboseLogStore.MAX_LINES);
    const { lines, backend } = await oauthVerboseLogStore.getRecentLines(limit);
    res.json({
      lines,
      backend,
      hint:
        backend === 'memory'
          ? 'Logs are in server memory only (typical on Vercel without KV). Connect Vercel KV for shared durable logs across instances.'
          : backend === 'kv'
            ? 'Logs stored in Vercel KV (shared across serverless instances).'
            : 'Logs stored under data/logs/oauth-verbose.log on the API host.',
    });
  } catch (error) {
    console.error('oauth-debug-log read error:', error);
    res.status(500).json({ error: 'log_read_failed', message: error.message });
  }
});

router.delete('/oauth-debug-log', requireAdmin, requireScopes(['admin']), async (req, res) => {
  try {
    await oauthVerboseLogStore.clear();
    res.json({ ok: true, message: 'OAuth verbose log cleared.' });
  } catch (error) {
    console.error('oauth-debug-log clear error:', error);
    res.status(500).json({ error: 'log_clear_failed', message: error.message });
  }
});

/**
 * Build JSON snapshot of in-memory banking data (Dates → ISO strings).
 */
function buildSerializableBootstrapSnapshot() {
  const snap = dataStore.getSnapshot();
  return JSON.parse(
    JSON.stringify(snap, (_key, value) => (value instanceof Date ? value.toISOString() : value))
  );
}

/**
 * GET downloadable seed file for committing as data/bootstrapData.json.
 */
router.get('/bootstrap/export', requireAdmin, requireScopes(['admin']), (req, res) => {
  try {
    const body = buildSerializableBootstrapSnapshot();
    const json = `${JSON.stringify(body, null, 2)}\n`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bootstrapData.json"');
    res.send(json);
  } catch (error) {
    console.error('bootstrap export error:', error);
    res.status(500).json({ error: 'bootstrap_export_failed', message: error.message });
  }
});

/**
 * POST writes seed file on disk (local dev only — never on Vercel).
 */
router.post('/bootstrap/export', requireAdmin, requireScopes(['admin']), async (req, res) => {
  const allowWrite =
    process.env.NODE_ENV !== 'production' || process.env.ALLOW_BOOTSTRAP_EXPORT_WRITE === 'true';
  if (!allowWrite) {
    return res.status(403).json({
      error: 'write_disabled',
      message:
        'Server file write is disabled in production unless ALLOW_BOOTSTRAP_EXPORT_WRITE=true. Use GET to download JSON.',
    });
  }
  try {
    const cwd = path.resolve(process.cwd());
    const rel = process.env.BANKING_BOOTSTRAP_FILE || path.join('data', 'bootstrapData.json');
    const outPath = path.resolve(cwd, rel);
    const relToCwd = path.relative(cwd, outPath);
    if (relToCwd.startsWith('..') || path.isAbsolute(relToCwd)) {
      return res.status(400).json({ error: 'invalid_path', message: 'Path must stay within the API project directory.' });
    }
    const body = buildSerializableBootstrapSnapshot();
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    res.json({ ok: true, path: outPath });
  } catch (error) {
    console.error('bootstrap write error:', error);
    res.status(500).json({ error: 'bootstrap_write_failed', message: error.message });
  }
});

/**
 * GET /banking/lookup?q= — find accounts whose number/id matches (substring + digit-only match).
 * Returns accounts and recent transactions touching those accounts (newest first).
 */
router.get('/banking/lookup', requireAdmin, requireScopes(['admin']), (req, res) => {
  try {
    const raw = String(req.query.q || '').trim();
    if (!raw) {
      return res.status(400).json({ error: 'invalid_query', message: 'Query parameter q is required.' });
    }
    const qLower = raw.toLowerCase();
    const qDigits = raw.replace(/\D/g, '');
    const allAccounts = dataStore.getAllAccounts();
    const accounts = allAccounts.filter((a) => {
      if (String(a.accountNumber).toLowerCase().includes(qLower)) return true;
      if (String(a.id).toLowerCase().includes(qLower)) return true;
      if (qDigits.length > 0) {
        const acctDigits = String(a.accountNumber).replace(/\D/g, '');
        if (acctDigits.includes(qDigits)) return true;
      }
      return false;
    });

    const txns = [];
    for (const acct of accounts) {
      for (const t of dataStore.getTransactionsByAccountId(acct.id)) {
        txns.push({
          ...t,
          _accountId: acct.id,
          _accountNumber: acct.accountNumber,
        });
      }
    }
    txns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      accounts,
      transactions: txns.slice(0, 200),
    });
  } catch (error) {
    console.error('banking lookup error:', error);
    res.status(500).json({ error: 'lookup_failed', message: error.message });
  }
});

/**
 * POST /banking/accounts/:accountId/seed-charges — add synthetic withdrawal rows (demo / QA).
 */
router.post('/banking/accounts/:accountId/seed-charges', requireAdmin, requireScopes(['admin']), async (req, res) => {
  try {
    const account = dataStore.getAccountById(req.params.accountId);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    const uid = account.userId;
    const samples = [
      { amount: 12.99, description: 'Card purchase — Retail' },
      { amount: 45.0, description: 'Debit — Fuel' },
      { amount: 8.25, description: 'Foreign transaction fee' },
      { amount: 2.5, description: 'ATM surcharge' },
    ];
    const created = [];
    for (const s of samples) {
      const t = await dataStore.createTransaction({
        fromAccountId: account.id,
        toAccountId: null,
        amount: s.amount,
        type: 'withdrawal',
        description: s.description,
        userId: uid,
        status: 'completed',
        performedBy: 'Admin seed',
        clientType: 'admin',
        tokenType: 'oauth',
      });
      await dataStore.updateAccountBalance(account.id, -s.amount);
      created.push(t);
    }
    const refreshed = dataStore.getAccountById(account.id);
    res.status(201).json({
      message: 'Fake bank charges added to account history',
      transactions: created,
      account: refreshed,
    });
  } catch (error) {
    console.error('seed-charges error:', error);
    res.status(500).json({ error: 'seed_failed', message: error.message });
  }
});

/**
 * GET /api/admin/setup/management-probe — list OIDC apps via PingOne Management API (read-only).
 * Requires admin session + bearer auth via authenticateToken on /api/admin.
 */
router.get('/setup/management-probe', requireAdmin, async (_req, res) => {
  try {
    const result = await probeManagementApiAccess();
    res.status(200).json(result);
  } catch (error) {
    console.error('management-probe error:', error);
    res.status(500).json({ ok: false, error: error.message || 'probe_failed' });
  }
});

/**
 * GET /api/admin/setup/worker-credentials — which server-side workers are configured (no secrets).
 */
router.get('/setup/worker-credentials', requireAdmin, (_req, res) => {
  res.status(200).json({
    management: getManagementWorkerConfigStatus(),
    authorizeWorkerReady: pingOneAuthorizeService.isWorkerCredentialReady(),
  });
});

/**
 * POST /api/admin/setup/pingone-bootstrap-run
 * Body: { publicBaseUrl: string, dryRun?: boolean, includeUsers?: boolean }
 */
router.post(
  '/setup/pingone-bootstrap-run',
  requireAdmin,
  requireSetupMasterKeyIfConfigured,
  async (req, res) => {
    try {
      const { publicBaseUrl, dryRun, includeUsers } = req.body || {};
      const result = await runPingOneBootstrap({
        publicBaseUrl,
        dryRun: !!dryRun,
        includeUsers: includeUsers !== false,
      });
      res.status(result.ok ? 200 : 422).json(result);
    } catch (error) {
      console.error('pingone-bootstrap-run error:', error);
      res.status(500).json({ ok: false, error: error.message || 'bootstrap_failed' });
    }
  }
);

/**
 * POST /api/admin/pingone/update-scopes
 * 
 * PingOne scope configuration update.
 * Enhanced with silent worker token acquisition - no manual credentials required.
 * Handles: agent:invoke -> ai:agent:read (Phase 69.1)
 */
router.post(
  '/pingone/update-scopes',
  requireAdmin,
  async (req, res) => {
    try {
      const PingOneScopeUpdateService = require('../services/pingoneScopeUpdateService');
      
      // Get environment ID from config
      const envId = process.env.PINGONE_ENVIRONMENT_ID;
      
      if (!envId) {
        return res.status(400).json({
          error: 'missing_environment',
          message: 'PingOne environment ID not configured. Set PINGONE_ENVIRONMENT_ID.'
        });
      }

      // Initialize service with silent worker token acquisition
      const service = new PingOneScopeUpdateService();
      
      // Validate credentials upfront
      const credentialStatus = service.validateCredentials();
      if (!credentialStatus.valid) {
        return res.status(400).json({
          error: 'credentials_not_configured',
          message: credentialStatus.message
        });
      }

      await service.initialize(envId); // No credentials needed - uses configStore

      // Run scope update
      const result = await service.fixScopeConfiguration();
      
      // Include credential status in response
      result.credentialStatus = credentialStatus;

      res.json(result);
    } catch (error) {
      console.error('Scope update error:', error);
      res.status(500).json({
        error: 'scope_update_failed',
        message: error.message || 'Failed to update scopes'
      });
    }
  }
);

/**
 * GET /api/admin/pingone/credential-status
 * 
 * Validate PingOne worker credentials without performing operations.
 * Returns credential status for UI display on component mount.
 */
router.get(
  '/pingone/credential-status',
  requireAdmin,
  async (req, res) => {
    try {
      const PingOneScopeUpdateService = require('../services/pingoneScopeUpdateService');
      const service = new PingOneScopeUpdateService();
      const credentialStatus = service.validateCredentials();
      
      res.json(credentialStatus);
    } catch (error) {
      console.error('Credential status check error:', error);
      res.status(500).json({
        error: 'credential_check_failed',
        message: error.message
      });
    }
  });

/**
 * AI Safety Red Button Kill Switch Endpoints
 * REQ-159-01/02/07/08: Kill switch accessible via API, token revoked at OAuth server
 */

const killSwitchService = require('../services/killSwitchService');
const auditLogService = require('../services/auditLogService');

/**
 * POST /api/admin/agent/:agentId/kill-switch
 * Kill switch endpoint: immediate agent revocation
 */
router.post(
  '/agent/:agentId/kill-switch',
  authenticateToken,
  async (req, res) => {
    try {
      const { agentId } = req.params;
      const { reason = 'manual_red_button' } = req.body;

      // Validation
      if (!agentId || typeof agentId !== 'string' || agentId.trim().length === 0) {
        return res.status(400).json({
          error: 'invalid_agent_id',
          message: 'agentId is required and must be a non-empty string',
        });
      }

      if (!reason || typeof reason !== 'string') {
        return res.status(400).json({
          error: 'invalid_reason',
          message: 'reason must be a string',
        });
      }

      // Check if already revoked
      const isRevoked = await killSwitchService.isAgentRevoked(agentId);
      if (isRevoked) {
        return res.status(403).json({
          error: 'agent_already_revoked',
          message: `Agent ${agentId} is already revoked`,
        });
      }

      // Execute kill switch — pass userId and session tokens for revocation at PingOne
      const userId = req.session?.user?.oauthId || req.session?.user?.id || null;
      const oauthTokens = req.session?.oauthTokens || null;
      const result = await killSwitchService.killAgent(agentId, reason, userId, oauthTokens);

      // Destroy admin session — token is revoked, session is now invalid
      req.session.destroy(() => {});

      // Return 401: the session/token is gone, UI must redirect to PingOne login
      return res.status(401).json({
        error: 'agent_killed',
        need_auth: true,
        revoked_at: result.revoked_at,
        state_snapshot_id: result.state_snapshot_id,
        time_to_revoke_ms: result.time_to_revoke_ms,
        message: `Agent stopped. Session revoked. Please sign in again.`,
      });

    } catch (error) {
      console.error('[admin] Kill switch error:', error.message);
      return res.status(500).json({
        error: 'kill_switch_failed',
        message: `Failed to execute kill switch: ${error.message}`,
      });
    }
  }
);

/**
 * GET /api/admin/agent/:agentId/status
 * Get current agent status (running or revoked)
 */
router.get(
  '/agent/:agentId/status',
  requireAdmin,
  requireScopes(['admin']),
  async (req, res) => {
    try {
      const { agentId } = req.params;

      const isRevoked = await killSwitchService.isAgentRevoked(agentId);

      return res.status(200).json({
        agent_id: agentId,
        status: isRevoked ? 'revoked' : 'running',
        revoked_at: isRevoked ? new Date().toISOString() : null,
      });

    } catch (error) {
      console.error('[admin] Agent status error:', error.message);
      return res.status(500).json({
        error: 'status_check_failed',
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/audit-trail
 * Forensic audit trail: kill events and rate limit violations
 */
router.get(
  '/audit-trail',
  requireAdmin,
  requireScopes(['admin']),
  async (req, res) => {
    try {
      const { agentId, hours = 24, limit = 100 } = req.query;

      if (!agentId || typeof agentId !== 'string' || agentId.trim().length === 0) {
        return res.status(400).json({
          error: 'invalid_agent_id',
          message: 'agentId query parameter is required',
        });
      }

      const hoursBack = Math.min(parseInt(hours) || 24, 720); // Max 30 days
      const eventLimit = Math.min(parseInt(limit) || 100, 500); // Max 500 per query

      const events = await auditLogService.getAuditTrail(agentId, hoursBack, eventLimit);

      return res.status(200).json({
        agent_id: agentId,
        query_hours: hoursBack,
        events_count: events.length,
        events,
      });

    } catch (error) {
      console.error('[admin] Audit trail error:', error.message);
      return res.status(500).json({
        error: 'audit_trail_failed',
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/audit-event/:auditId
 * Get detailed information about a specific audit event
 */
router.get(
  '/audit-event/:auditId',
  requireAdmin,
  requireScopes(['admin']),
  async (req, res) => {
    try {
      const { auditId } = req.params;

      const event = await auditLogService.getAuditEventById(auditId);

      if (!event) {
        return res.status(404).json({
          error: 'audit_event_not_found',
          message: `Audit event ${auditId} not found`,
        });
      }

      return res.status(200).json(event);

    } catch (error) {
      console.error('[admin] Audit event detail error:', error.message);
      return res.status(500).json({
        error: 'audit_event_failed',
        message: error.message,
      });
    }
  }
);


module.exports = router;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 161: App Event Service Routes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const appEventService = require('../services/appEventService');
const { clearAllTokenChains } = require('../services/tokenChainService');
const mcpToolAuditStore = require('../services/mcpToolAuditStore');
const apiCallTracker = require('../services/apiCallTrackerService');

/**
 * POST /api/admin/reset-demo — Clear all in-memory demo state for a fresh start.
 * Clears: app events, token chain, MCP audit, API call tracker, pending consents.
 * Auth: authenticateToken only — any logged-in user can reset the demo.
 */
router.post('/reset-demo', authenticateToken, async (req, res) => {
  try {
    appEventService.clearEvents();
    clearAllTokenChains();
    mcpToolAuditStore.clearToolCalls();
    apiCallTracker.clearApiCalls('default');
    if (global.pendingConsents) global.pendingConsents = {};

    // Clear MCP server's own in-memory audit log (fire-and-forget, non-fatal)
    try {
      const mcpWsUrl = process.env.MCP_SERVER_URL || 'ws://localhost:8080';
      const mcpHttpBase = mcpWsUrl.replace(/^ws(s?):/, 'http$1:');
      await fetch(`${mcpHttpBase}/audit`, { method: 'DELETE', signal: AbortSignal.timeout(2000) }).catch(() => {});
    } catch (_) {}

    console.log('[admin] Demo state reset by:', req.session?.user?.email || 'unknown');
    res.json({ ok: true, message: 'Demo state cleared. Reload the browser to start fresh.' });
  } catch (error) {
    console.error('[admin] reset-demo error:', error);
    res.status(500).json({ error: 'reset_failed', message: error.message });
  }
});

/**
 * GET /api/admin/app-events — Get curated app events (OAuth, token exchange, session, JWKS)
 * Supports filtering by category, severity, limit, and time range
 */
router.get('/app-events', requireAdmin, requireScopes(['admin']), (req, res) => {
  try {
    const { category, severity, limit = 100, since } = req.query;
    
    const events = appEventService.getEvents({
      category,
      severity,
      limit: Math.min(parseInt(limit) || 100, 500),
      since,
    });

    const categories = appEventService.getEventsByCategory();

    res.json({
      events,
      total: events.length,
      categories,
    });
  } catch (error) {
    console.error('Get app-events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/app-events/categories — Get summary of events by category
 */
router.get('/app-events/categories', requireAdmin, requireScopes(['admin']), (req, res) => {
  try {
    const categories = appEventService.getEventsByCategory();
    res.json({ categories });
  } catch (error) {
    console.error('Get app-events categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/app-events/stream — Server-Sent Events stream of app events.
 *
 * Multiplexes cleanly over HTTP/2 (one TCP connection serves many SSE streams).
 * Replaces polling /app-events every N seconds.
 *
 * Query params:
 *   ?category=<oauth|token_exchange|...>  — only emit events of this category
 */
// Open to ANY authenticated user so the AI Control Plane push notice reaches
// non-admins. Admins still receive every category; non-admins receive only
// 'control_plane' events (see appEventsStreamFilter — never admin-only telemetry).
router.get('/app-events/stream', authenticateToken, (req, res) => {
  const { category } = req.query;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  res.write(`event: hello\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);

  const unsubscribe = appEventService.subscribe((event) => {
    if (!controlPlaneVisible(req.user, event)) return; // access gate (admin = all; others = control_plane only)
    if (category && event.category !== category) return;
    try {
      res.write(`event: app-event\ndata: ${JSON.stringify(event)}\n\n`);
    } catch (_) { /* connection closed mid-write */ }
  });

  // Heartbeat keeps proxies/load balancers from idle-closing the stream.
  const heartbeat = setInterval(() => {
    try { res.write(': hb\n\n'); } catch (_) {}
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/**
 * POST /api/admin/app-events — Accept a frontend-emitted app event
 * Auth: authenticateToken only (valid session, any role) — per D-05
 * Body: { category, severity, message, tag?, metadata? }
 */
router.post('/app-events', authenticateToken, (req, res) => {
  try {
    const { category, severity, message, tag, metadata } = req.body;

    if (!category || !severity || !message) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'category, severity, and message are required',
      });
    }

    const event = appEventService.logEvent(category, severity, message, { tag, metadata });
    res.status(201).json({ event });
  } catch (error) {
    console.error('[admin] POST /app-events error:', error);
    res.status(500).json({ error: 'internal_server_error' });
  }
});
