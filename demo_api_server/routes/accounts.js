const express = require('express');
const router = express.Router();
const dataStore = require('../data/store');
const { authenticateToken, requireScopes, requireNotBankDelegate, requireNotAdmin } = require('../middleware/auth');
const { blockInDemoMode } = require('../middleware/demoMode');
const demoScenarioStore = require('../services/demoScenarioStore');
const posthog = require('../services/posthog');
const { verticalManifest } = require('../services/verticalManifest');
const verticalAccountSnapshots = require('../services/verticalAccountSnapshots');
const { BANKING_ACCOUNT_SPECS, SPEC_BY_TYPE, buildBankingAccount } = require('../data/bankingAccountSpecs');

/**
 * Rebuild a user's accounts from a snapshot saved in demoScenarioStore (Redis/KV).
 * Called on cold-start when the in-memory store is empty so restored accounts
 * (e.g. investment accounts added via /demo-data) aren't lost.
 * Returns the restored accounts array, or [] if no snapshot exists.
 */
async function restoreAccountsFromSnapshot(userId) {
  try {
    const scenario = await demoScenarioStore.load(userId);
    if (!Array.isArray(scenario.accountSnapshot) || scenario.accountSnapshot.length === 0) return [];
    const restored = await Promise.all(
      scenario.accountSnapshot.map((snap) => {
        const existing = dataStore.getAccountById(snap.id);
        if (existing) return existing;
        return dataStore.createAccount({ ...snap, userId, createdAt: new Date() });
      })
    );
    return restored;
  } catch (e) {
    console.warn('[accounts] restoreAccountsFromSnapshot failed:', e.message);
    return [];
  }
}

/**
 * Save current user accounts to demoScenarioStore (Redis/KV) for cold-start recovery.
 * Called after any account creation, update, or deletion.
 * Prevents "From account not found" errors when Vercel lambda is recycled.
 */
async function saveAccountSnapshot(userId) {
  try {
    const accounts = dataStore.getAccountsByUserId(userId);
    const scenario = await demoScenarioStore.load(userId);
    await demoScenarioStore.save(userId, {
      ...scenario,
      accountSnapshot: accounts || []
    });
    console.log(`[accounts] saved snapshot for userId=${userId} with ${(accounts || []).length} accounts`);
  } catch (e) {
    console.warn('[accounts] saveAccountSnapshot failed:', e.message);
  }
}

/**
 * Add a secondary banking account (loan, credit card, …) if the user has
 * checking+savings but not this account. Builds from the shared bankingAccountSpecs
 * so the deterministic ID matches what provisionDemoAccounts assigns — a subsequent
 * full reprovision stays idempotent.
 */
async function addMissingBankingAccount(userId, existingAccounts, spec) {
  const account = buildBankingAccount(userId, spec);
  const already = dataStore.getAccountById(account.id);
  if (already) return [...existingAccounts, already];

  const created = await dataStore.createAccount(account);
  await saveAccountSnapshot(userId);
  return [...existingAccounts, created];
}

// Named (not inline) so the OpenAPI introspection in lib/openapiFromRoutes.js
// can see it via AUTH_MIDDLEWARE and document this route as admin-gated —
// an inline `if (req.user.role !== 'admin')` check is invisible to it.
function requireAdminRole(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin role required.' });
  }
  next();
}

// Get all accounts (admin only)
router.get('/', authenticateToken, requireScopes(['read']), requireAdminRole, async (req, res) => {
  try {
    const allAccounts = dataStore.getAllAccounts();
    const total = allAccounts.length;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || total || 1));
    const accounts = (req.query.limit || req.query.offset)
      ? allAccounts.slice(offset, offset + limit)
      : allAccounts;
    const allUsers = dataStore.getAllUsers();
    const userMap = {};
    for (const u of allUsers) {
      userMap[u.id] = u;
    }
    const enriched = accounts.map((acct) => {
      const owner = acct.userId ? userMap[acct.userId] : null;
      return {
        ...acct,
        ownerUsername: owner?.username || acct.userId || 'unknown',
        ownerEmail: owner?.email || null,
        ownerName: owner ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim() : null,
      };
    });
    res.json({ accounts: enriched, total });
  } catch (error) {
    console.error('Error getting accounts:', error?.stack || String(error));
    res.status(500).json({ error: 'Failed to get accounts' });
  }
});

// Provision demo accounts + sample history for a user. Idempotent — always resets balances.
// Single-flight per userId: two overlapping first-load requests for the same
// brand-new user (two tabs, a double-invoked mount effect) would otherwise both
// observe zero accounts and both run this, each inserting its own full set of
// sample transactions (createTransaction mints a fresh random id — nothing dedups
// or cleans those up). A second overlapping caller now awaits the first call's
// result instead of re-running the provision-and-seed sequence.
const _provisionInflight = new Map(); // userId -> Promise<Account[]>

async function provisionDemoAccounts(userId) {
  const inflight = _provisionInflight.get(userId);
  if (inflight) return inflight;

  const promise = _provisionDemoAccountsUnguarded(userId).finally(() => {
    _provisionInflight.delete(userId);
  });
  _provisionInflight.set(userId, promise);
  return promise;
}

async function _provisionDemoAccountsUnguarded(userId) {
  // Remove existing accounts for this user so we can reset balances cleanly
  const existing = dataStore.getAccountsByUserId(userId);
  const deletedAccountIds = new Set(existing.map((a) => a.id));
  await Promise.all(existing.map((acct) => dataStore.deleteAccount(acct.id)));
  // Remove only transactions tied to deleted accounts (do not wipe all user txns when existing.length === 0)
  const existingTxns = dataStore.getTransactionsByUserId(userId);
  const txnsToDelete = existingTxns.filter(
    (txn) =>
      (txn.fromAccountId && deletedAccountIds.has(txn.fromAccountId)) ||
      (txn.toAccountId && deletedAccountIds.has(txn.toAccountId))
  );
  await Promise.all(txnsToDelete.map((txn) => dataStore.deleteTransaction(txn.id)));

  // Build the full 4-account set from the shared specs (single source of truth;
  // the agent's mcpLocalTools.ensureAccounts builds from the same specs).
  // Sequential to keep each persist ordered.
  const provisioned = [];
  for (const spec of BANKING_ACCOUNT_SPECS) {
    provisioned.push(await dataStore.createAccount(buildBankingAccount(userId, spec)));
  }
  const [checking, savings, carLoan, creditCard] = provisioned;

  // Use the ACTUAL IDs from the created accounts (not hardcoded patterns)
  // so sample transactions always reference valid account IDs regardless of
  // how buildBankingAccount generates them.
  const checkingId = checking.id;
  const savingsId  = savings.id;
  const loanId     = carLoan.id;
  const creditId   = creditCard.id;

  // Save snapshot for cold-start recovery
  await saveAccountSnapshot(userId);

  const sampleTxns = [
    { fromAccountId: null,        toAccountId: checkingId, amount: 3500.00, type: 'deposit',    description: 'Direct deposit – Payroll',    createdAt: new Date('2024-03-01T09:00:00Z') },
    { fromAccountId: checkingId,  toAccountId: savingsId,  amount:  500.00, type: 'transfer',   description: 'Monthly savings transfer',    createdAt: new Date('2024-03-03T11:15:00Z') },
    { fromAccountId: checkingId,  toAccountId: null,       amount:  120.00, type: 'withdrawal', description: 'ATM withdrawal',              createdAt: new Date('2024-03-07T14:30:00Z') },
    { fromAccountId: null,        toAccountId: savingsId,  amount:  250.00, type: 'deposit',    description: 'Tax refund deposit',          createdAt: new Date('2024-03-10T10:00:00Z') },
    { fromAccountId: checkingId,  toAccountId: null,       amount:   85.50, type: 'withdrawal', description: 'Grocery store',              createdAt: new Date('2024-03-14T17:45:00Z') },
    { fromAccountId: checkingId,  toAccountId: null,       amount:  200.00, type: 'withdrawal', description: 'Utility bill – Electric',    createdAt: new Date('2024-03-18T08:00:00Z') },
    { fromAccountId: null,        toAccountId: checkingId, amount:   75.00, type: 'deposit',    description: 'Reimbursement',              createdAt: new Date('2024-03-20T13:00:00Z') },
    { fromAccountId: checkingId,  toAccountId: loanId,     amount:  450.00, type: 'payment',    description: 'Car loan payment',           createdAt: new Date('2024-03-05T08:00:00Z') },
    { fromAccountId: checkingId,  toAccountId: loanId,     amount:  450.00, type: 'payment',    description: 'Car loan payment',           createdAt: new Date('2024-02-05T08:00:00Z') },
    { fromAccountId: checkingId,  toAccountId: creditId,   amount:  300.00, type: 'payment',    description: 'Credit card payment',        createdAt: new Date('2024-03-12T08:00:00Z') },
    { fromAccountId: creditId,    toAccountId: null,       amount:  129.99, type: 'purchase',   description: 'Online purchase',            createdAt: new Date('2024-03-16T19:20:00Z') },
  ];
  await Promise.all(sampleTxns.map((txn) => dataStore.createTransaction({ ...txn, userId, status: 'completed' })));

  return [checking, savings, carLoan, creditCard];
}

// Get user's own accounts — auto-provisions demo accounts on first load
// Uses authenticated session only (scope-independent) so customer dashboard always hydrates.
router.get('/my', authenticateToken, requireNotAdmin, async (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store' });
  try {
    let userAccounts = dataStore.getAccountsByUserId(req.user.id);

    // Session-scoped: this session's chosen vertical (falls back to the global
    // default for sessions that never switched).
    const activeVertical = verticalManifest.resolver.activeIdFor(req) || 'banking';
    // Primary accountType derived from active vertical's manifest
    // (was hardcoded VERTICAL_PRIMARY_TYPE map; now read from manifest.terminology.accountTypes[0]).
    const activeManifestEntry = verticalManifest.loader.get(activeVertical);
    const expectedPrimaryType = activeManifestEntry?.manifest?.terminology?.accountTypes?.[0];

    // For the banking vertical, also check the legacy loan completeness guard.
    const hasChecking = () => userAccounts.some(a => (a.accountType || a.type) === 'CHECKING' || (a.accountType || a.type) === 'checking');
    const hasSavings  = () => userAccounts.some(a => (a.accountType || a.type) === 'SAVINGS'  || (a.accountType || a.type) === 'savings');
    const hasLoan     = () => userAccounts.some(a => (a.accountType || a.type) === 'loan');
    const hasCreditCard = () => userAccounts.some(a => ['credit_card', 'credit'].includes(String(a.accountType || a.type || '').toLowerCase()));

    // Case-insensitive mismatch: provisionDemoAccounts writes lowercase 'checking'/'savings'
    // while the banking seed file uses 'CHECKING'/'SAVINGS' — normalise before comparing.
    const primaryType = (userAccounts[0]?.accountType || '').toLowerCase();
    const expectedLower = (expectedPrimaryType || '').toLowerCase();
    const verticalMismatch = userAccounts.length > 0 && expectedLower && primaryType !== expectedLower;

    if (req.user.id && (userAccounts.length === 0 || verticalMismatch)) {
      if (userAccounts.length === 0) {
        // On cold-start the in-memory store is empty. Try to restore from the persisted
        // account snapshot (Redis/KV) before falling back to fresh provisioning.
        userAccounts = await restoreAccountsFromSnapshot(req.user.id);
      }

      // After restore, re-check for vertical mismatch (case-insensitive).
      const restoredPrimary = (userAccounts[0]?.accountType || '').toLowerCase();
      const stillMismatched = userAccounts.length === 0 ||
        (expectedLower && restoredPrimary !== expectedLower);

      if (stillMismatched) {
        // Session-scoped: move ONLY this user to THEIR session's vertical.
        // Accounts are per-user, so other sessions' users are untouched — two
        // sessions on different verticals (banking + healthcare) coexist. This
        // replaces the former all-customers reseed, which clobbered every
        // session whenever any one detected a mismatch (the cross-session bleed).
        //
        // switchUserVertical (not a bare reseed) so the outgoing vertical's
        // accounts AND transactions are snapshotted first and restored on the
        // way back. A bare reseed silently destroyed built-up demo state —
        // transfers, HITL approvals, step-ups — with no way to recover it.
        await verticalAccountSnapshots.switchUserVertical(req.user.id, activeVertical);
        const accts = dataStore.getAccountsByUserId(req.user.id);
        const snap = accts.map(a => ({
          id: a.id, accountType: a.accountType, accountNumber: a.accountNumber,
          name: a.name || '', balance: a.balance, currency: a.currency || 'USD', isActive: true,
        }));
        await demoScenarioStore.save(req.user.id, { accountSnapshot: snap });
        userAccounts = accts;
      }
    }

    // For the banking vertical only: top up to the full 4-account set (checking,
    // savings, car loan, credit card) if missing, without wiping existing accounts/balances.
    if (req.user.id && activeVertical === 'banking' && hasChecking() && hasSavings()) {
      if (!hasLoan()) {
        userAccounts = await addMissingBankingAccount(req.user.id, userAccounts, SPEC_BY_TYPE.loan);
      }
      if (!hasCreditCard()) {
        userAccounts = await addMissingBankingAccount(req.user.id, userAccounts, SPEC_BY_TYPE.credit_card);
      }
    }
    // Banking identifiers (SWIFT/IBAN/branch, masked account number) are only
    // meaningful for the banking vertical. Fabricating them for healthcare /
    // retail / workforce accounts stamped banking-shaped defaults onto records
    // that have no such fields. Emit them with defaults for banking (output
    // byte-identical to before); for every other vertical, surface these fields
    // only when the account genuinely carries them — never invented.
    const isBanking = activeVertical === 'banking';
    res.json({
      accounts: userAccounts.map(account => {
        const holderName = (req.user && (req.user.name || (req.user.given_name ? req.user.given_name + ' ' + (req.user.family_name || '') : null) || req.user.sub)) || '';
        if (isBanking) {
          return {
            id: account.id,
            accountType: account.accountType,
            name: account.name,
            balance: account.balance,
            currency: account.currency,
            status: account.status || 'active',
            accountNumber: account.accountNumber || ('****' + (account.accountNumberFull || '').slice(-4)),
            swiftCode: account.swiftCode || 'CHASUS33',
            iban: account.iban || '',
            branchName: account.branchName || 'Super Banking Main Branch',
            branchCode: account.branchCode || '001',
            openedDate: account.openedDate || null,
            accountHolderName: holderName,
            createdAt: account.createdAt,
            notes: account.notes || null,
          };
        }
        const acct = {
          id: account.id,
          accountType: account.accountType,
          name: account.name,
          balance: account.balance,
          currency: account.currency,
          status: account.status || 'active',
          openedDate: account.openedDate || null,
          accountHolderName: holderName,
          createdAt: account.createdAt,
          notes: account.notes || null,
        };
        if (account.accountNumber) acct.accountNumber = account.accountNumber;
        if (account.swiftCode) acct.swiftCode = account.swiftCode;
        if (account.iban) acct.iban = account.iban;
        if (account.branchName) acct.branchName = account.branchName;
        if (account.branchCode) acct.branchCode = account.branchCode;
        return acct;
      }),
    });
  } catch (error) {
    console.error('Error getting user accounts:', error?.stack || String(error));
    res.status(500).json({ error: 'Failed to get your accounts' });
  }
});

// Reset demo — restore accounts to $5,000 starting balances with fresh sample history
router.post('/reset-demo', authenticateToken, async (req, res) => {
  try {
    const accounts = await provisionDemoAccounts(req.user.id);
    // Clear the account snapshot so cold-start restores the fresh 2-account defaults,
    // not the old custom configuration that was just reset.
    const snapshot = accounts.map(a => ({
      id: a.id, accountType: a.accountType, accountNumber: a.accountNumber,
      name: a.name || '', balance: a.balance, currency: a.currency || 'USD', isActive: true,
    }));
    await demoScenarioStore.save(req.user.id, { accountSnapshot: snapshot });
    posthog.capture({ distinctId: req.user.id, event: 'demo_reset' });
    res.json({ message: 'Demo reset successfully', accounts });
  } catch (error) {
    console.error('Error resetting demo:', error?.stack || String(error));
    res.status(500).json({ error: 'Failed to reset demo' });
  }
});

// Admin: reset ALL demo-provisioned OAuth accounts back to $5,000 starting balances
router.post('/reset-all-demo', authenticateToken, requireScopes(['write']), async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required.' });
    }
    // Find all OAuth-provisioned accounts (deterministic IDs start with chk- or sav-)
    const allAccounts = dataStore.getAllAccounts();
    const demoAccounts = allAccounts.filter(a => a.id.startsWith('chk-') || a.id.startsWith('sav-'));
    // Collect the userIds so we can also clear their transactions
    const demoUserIds = [...new Set(demoAccounts.map(a => a.userId))];
    await Promise.all(demoAccounts.map((acct) => dataStore.deleteAccount(acct.id)));
    await Promise.all(
      demoUserIds.map(async (uid) => {
        const txns = dataStore.getTransactionsByUserId(uid);
        await Promise.all(txns.map((txn) => dataStore.deleteTransaction(txn.id)));
        // Save empty snapshot for cold-start recovery
        await saveAccountSnapshot(uid);
      })
    );
    res.json({ message: `Reset ${demoUserIds.length} demo user(s). Fresh accounts will be provisioned on next login.` });
  } catch (error) {
    console.error('Error resetting all demo accounts:', error?.stack || String(error));
    res.status(500).json({ error: 'Failed to reset demo accounts' });
  }
});

// Get account by ID (admin only)
router.get('/:id', authenticateToken, requireScopes(['read']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const account = dataStore.getAccountById(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ account });
  } catch (error) {
    console.error('Error getting account:', error?.stack || String(error));
    res.status(500).json({ error: 'Failed to get account' });
  }
});

// Get account balance (admin or account owner)
router.get('/:id/balance', authenticateToken, requireScopes(['read']), async (req, res) => {
  try {
    let account = dataStore.getAccountById(req.params.id);
    // Fallback: resolve type-name IDs like "checking"/"savings" (UI uses these before liveAccounts loads)
    if (!account && req.user) {
      const userAccounts = dataStore.getAccountsByUserId(req.user.id);
      const typeName = req.params.id.toLowerCase().replace(/^(my|the|primary|main)\s+/, '');
      account = userAccounts.find(a =>
        String(a.accountType || '').toLowerCase() === typeName ||
        String(a.name || '').toLowerCase().includes(typeName)
      );
    }
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    // Check if user is admin or account owner
    if (req.user.role !== 'admin' && account.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied. You can only check your own account balance.' });
    }
    
    const balance = dataStore.getAccountBalance(account.id);
    res.json({ balance });
  } catch (error) {
    console.error('Error getting account balance:', error?.stack || String(error));
    res.status(500).json({ error: 'Failed to get account balance' });
  }
});

// Create new account (admin only)
router.post('/', blockInDemoMode('account creation'), authenticateToken, requireScopes(['write']), requireNotBankDelegate('account creation'), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    const account = await dataStore.createAccount(req.body);
    // Save snapshot for cold-start recovery
    await saveAccountSnapshot(account.userId);
    res.status(201).json({ message: 'Account created successfully', account });
  } catch (error) {
    console.error('Error creating account:', error?.stack || String(error));
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Update account (admin only)
router.put('/:id', blockInDemoMode('account update'), authenticateToken, requireScopes(['write']), requireNotBankDelegate('account update'), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    const account = await dataStore.updateAccount(req.params.id, req.body);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    // Save snapshot for cold-start recovery
    await saveAccountSnapshot(account.userId);
    res.json({ message: 'Account updated successfully', account });
  } catch (error) {
    console.error('Error updating account:', error?.stack || String(error));
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// Delete account (admin only)
router.delete('/:id', blockInDemoMode('account deletion'), authenticateToken, requireScopes(['write']), requireNotBankDelegate('account deletion'), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    // Get account before deletion to know which user to update snapshot for
    const account = dataStore.getAccountById(req.params.id);
    const deleted = await dataStore.deleteAccount(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Account not found' });
    }
    // Save snapshot for cold-start recovery
    if (account) {
      await saveAccountSnapshot(account.userId);
    }
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting account:', error?.stack || String(error));
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

/**
 * PATCH /api/accounts/:id/contact-email
 *
 * Update the contact email for the authenticated user's own account.
 * The resource ownership check here is defence-in-depth; the primary gate is the
 * simulated (or live) PingOne Authorize pre-flight that fires before the MCP server
 * ever calls this endpoint — it DENYs any request where the token subject does not
 * match the account owner (the Meta-chatbot attack pattern).
 */
router.patch('/:id/contact-email', authenticateToken, requireScopes(['write']), async (req, res) => {
  try {
    // Require authenticated user with valid sub claim
    if (!req.user || !req.user.sub) {
      return res.status(401).json({ error: 'Unauthorized: missing or invalid user identity' });
    }
    const account = dataStore.getAccountById(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    // Authorization: only the account owner (userId) can update their own account
    if (account.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Forbidden',
        reason: 'resource_owner_mismatch',
        message: 'You can only update contact details for your own accounts.',
      });
    }
    const { new_email } = req.body;
    if (!new_email || typeof new_email !== 'string') {
      return res.status(400).json({ error: 'new_email is required' });
    }
    const updated = await dataStore.updateUser(req.user.sub, { email: new_email });
    if (!updated) {
      return res.status(404).json({ error: 'User record not found' });
    }
    res.json({ success: true, accountId: req.params.id, email: new_email });
  } catch (error) {
    console.error('Error updating contact email:', error?.stack || String(error));
    res.status(500).json({ error: 'Failed to update contact email' });
  }
});

router.post('/:id/fee-waiver-request', authenticateToken, requireScopes(['write']), async (req, res) => {
  // Require authenticated user with valid sub claim
  if (!req.user || !req.user.sub) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid user identity' });
  }
  const account = dataStore.getAccountById(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== req.user.sub) return res.status(403).json({ error: 'Forbidden' });
  const requestId = `fwr-${Date.now()}`;
  // Sanitize reason to prevent log injection: allow only alphanumeric, spaces, and basic punctuation
  const reason = (req.body.reason || 'none').replace(/[^\w\s\-.,!?]/g, '_').slice(0, 200);
  console.log(`[FeeWaiver] Request ${requestId} logged for account ${req.params.id} — reason: ${reason}`);
  res.status(201).json({
    submitted: true,
    requestId,
    accountId: req.params.id,
    note: 'Your fee waiver request has been logged for review. A human agent will respond within 2 business days.',
  });
});

router.provisionDemoAccounts = provisionDemoAccounts;
module.exports = router;
