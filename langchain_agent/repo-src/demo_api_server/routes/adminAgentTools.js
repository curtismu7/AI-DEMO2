const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { requireAdmin, requireScopes } = require('../middleware/auth');
const adminAuditService = require('../services/adminAuditService');

// GET /api/admin/agent/lookup?q=
router.get('/lookup', requireAdmin, requireScopes(['admin:read']), async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q) return res.status(400).json({ error: 'missing_query', message: 'q is required' });

    const users = store.getAllUsers();
    const matches = users
      .filter((u) => {
        const fullName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
        return (
          fullName.includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.username || '').toLowerCase().includes(q)
        );
      })
      .map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        isActive: u.isActive,
      }));

    res.json({ users: matches, count: matches.length });
  } catch (err) {
    console.error('[adminAgentTools] GET /lookup error:', err.message);
    res.status(500).json({ error: 'lookup_error', message: err.message });
  }
});

// GET /api/admin/agent/users/:userId
router.get('/users/:userId', requireAdmin, requireScopes(['admin:read']), async (req, res) => {
  try {
    const user = store.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    const { password, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error('[adminAgentTools] GET /users/:userId error:', err.message);
    res.status(500).json({ error: 'get_user_error', message: err.message });
  }
});

// GET /api/admin/agent/users/:userId/accounts
router.get('/users/:userId/accounts', requireAdmin, requireScopes(['admin:read']), async (req, res) => {
  try {
    const accounts = store.getAccountsByUserId(req.params.userId);
    res.json({ accounts, count: accounts.length });
  } catch (err) {
    console.error('[adminAgentTools] GET /users/:userId/accounts error:', err.message);
    res.status(500).json({ error: 'get_accounts_error', message: err.message });
  }
});

// GET /api/admin/agent/users/:userId/transactions?limit=5
router.get('/users/:userId/transactions', requireAdmin, requireScopes(['admin:read']), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 50);
    const allTx = store.getTransactionsByUserId(req.params.userId);
    const sorted = allTx
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
    res.json({ transactions: sorted, count: sorted.length });
  } catch (err) {
    console.error('[adminAgentTools] GET /users/:userId/transactions error:', err.message);
    res.status(500).json({ error: 'get_transactions_error', message: err.message });
  }
});

// PATCH /api/admin/agent/accounts/:accountId/freeze
router.patch('/accounts/:accountId/freeze', requireAdmin, requireScopes(['admin:write']), async (req, res) => {
  try {
    const { freeze } = req.body;
    if (typeof freeze !== 'boolean') {
      return res.status(400).json({ error: 'invalid_body', message: 'freeze (boolean) is required' });
    }
    const account = store.getAccountById(req.params.accountId);
    if (!account) return res.status(404).json({ error: 'account_not_found' });

    const updated = await store.updateAccount(req.params.accountId, { isActive: !freeze });

    res.json({
      success: true,
      accountId: updated.id,
      isActive: updated.isActive,
      frozen: freeze,
    });
  } catch (err) {
    console.error('[adminAgentTools] PATCH /accounts/:accountId/freeze error:', err.message);
    res.status(500).json({ error: 'freeze_error', message: err.message });
  }
});

// POST /api/admin/agent/users/:userId/reset-password
router.post('/users/:userId/reset-password', requireAdmin, requireScopes(['admin:write']), async (req, res) => {
  try {
    const user = store.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    await store.updateUser(req.params.userId, { passwordResetRequired: true });

    res.json({ success: true, userId: req.params.userId, passwordResetRequired: true });
  } catch (err) {
    console.error('[adminAgentTools] POST /users/:userId/reset-password error:', err.message);
    res.status(500).json({ error: 'reset_password_error', message: err.message });
  }
});

// POST /api/admin/agent/accounts/:accountId/adjust
router.post('/accounts/:accountId/adjust', requireAdmin, requireScopes(['admin:write']), async (req, res) => {
  try {
    const { amount, description } = req.body;
    if (typeof amount !== 'number' || !isFinite(amount)) {
      return res.status(400).json({ error: 'invalid_body', message: 'amount must be a finite number' });
    }
    const MAX_ADJUSTMENT = 1_000_000;
    if (Math.abs(amount) > MAX_ADJUSTMENT) {
      return res.status(400).json({ error: 'invalid_body', message: `amount magnitude cannot exceed ${MAX_ADJUSTMENT}` });
    }
    const account = store.getAccountById(req.params.accountId);
    if (!account) return res.status(404).json({ error: 'account_not_found' });

    const newBalance = (account.balance || 0) + amount;
    if (newBalance < 0) {
      return res.status(400).json({ error: 'insufficient_funds', message: 'Adjustment would result in negative balance' });
    }
    const updated = await store.updateAccount(req.params.accountId, { balance: newBalance });

    const tx = await store.createTransaction({
      userId: account.userId,
      fromAccountId: amount < 0 ? account.id : null,
      toAccountId: amount >= 0 ? account.id : null,
      amount: Math.abs(amount),
      type: amount >= 0 ? 'deposit' : 'withdrawal',
      description: description || 'Admin balance adjustment',
      category: 'admin',
      status: 'completed',
    });

    res.json({ success: true, accountId: updated.id, newBalance: updated.balance, transaction: tx });
  } catch (err) {
    console.error('[adminAgentTools] POST /accounts/:accountId/adjust error:', err.message);
    res.status(500).json({ error: 'adjust_error', message: err.message });
  }
});

// DELETE /api/admin/agent/users/:userId
router.delete('/users/:userId', requireAdmin, requireScopes(['admin:delete']), async (req, res) => {
  try {
    const { confirm } = req.body;
    if (confirm !== true) {
      return res.status(400).json({ error: 'confirmation_required', message: 'confirm: true is required' });
    }
    const user = store.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const accounts = store.getAccountsByUserId(req.params.userId);
    for (const account of accounts) {
      const transactions = store.getTransactionsByAccountId(account.id);
      for (const tx of transactions) {
        await store.deleteTransaction(tx.id);
      }
      await store.deleteAccount(account.id);
    }

    await store.deleteUser(req.params.userId);

    adminAuditService.logAdminUserManagement({
      adminSub: req.user?.sub || req.user?.id,
      targetUserSub: req.params.userId,
      action: 'delete',
      resource: 'user',
      result: 'success',
      details: { confirm: true }
    }, req);

    res.json({ success: true, deleted: { userId: req.params.userId } });
  } catch (err) {
    console.error('[adminAgentTools] DELETE /users/:userId error:', err.message);
    res.status(500).json({ error: 'delete_error', message: err.message });
  }
});

module.exports = router;
