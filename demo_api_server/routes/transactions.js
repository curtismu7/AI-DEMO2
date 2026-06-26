const express = require('express');
const router = express.Router();
const dataStore = require('../data/store');
const { authenticateToken, requireScopes, requireNotAdmin } = require('../middleware/auth');
const { blockInDemoMode } = require('../middleware/demoMode');
const runtimeSettings = require('../config/runtimeSettings');
const transactionAuthorizationService = require('../services/transactionAuthorizationService');
const configStore = require('../services/configStore');
const { sendTransactionConfirmation } = require('../services/emailService');
const txConsent = require('../services/transactionConsentChallenge');
const demoScenarioStore = require('../services/demoScenarioStore');
const { resolveAccountId } = require('../utils/accountUtils');
const { logEvent: logAppEvent, EVENT_CATEGORIES } = require('../services/appEventService');
const posthog = require('../services/posthog');
const { BANKING_SCOPES } = require('../config/scopes');
const { roundToCents } = require('../utils/money');

/**
 * Re-hydrate a user's accounts from the Redis snapshot on cold-start.
 * Prevents 404 "From account not found" when a Vercel lambda is recycled
 * between challenge creation and the consent-confirm POST.
 */
async function restoreAccountsFromSnapshot(userId) {
  try {
    const scenario = await demoScenarioStore.load(userId);
    if (!Array.isArray(scenario.accountSnapshot) || scenario.accountSnapshot.length === 0) return;
    for (const snap of scenario.accountSnapshot) {
      if (!dataStore.getAccountById(snap.id)) {
        await dataStore.createAccount({ ...snap, userId, createdAt: new Date() });
      }
    }
  } catch (e) {
    console.warn('[transactions] restoreAccountsFromSnapshot failed:', e.message);
  }
}

/**
 * Re-hydrate a user's transactions from the Redis snapshot on cold-start.
 * Prevents transaction loss when a Vercel lambda is recycled.
 */
async function restoreTransactionsFromSnapshot(userId) {
  try {
    const scenario = await demoScenarioStore.load(userId);
    if (!Array.isArray(scenario?.transactionSnapshot) || scenario.transactionSnapshot.length === 0) return;
    for (const snap of scenario.transactionSnapshot) {
      if (!dataStore.getTransactionById(snap.id)) {
        await dataStore.createTransaction(snap);
      }
    }
  } catch (e) {
    console.warn('[transactions] restoreTransactionsFromSnapshot failed:', e.message);
  }
}

/**
 * Persist transaction snapshot to Redis/KV for serverless cold-start recovery.
 * Keeps most recent transactions only to avoid large payloads.
 */
async function saveTransactionSnapshot(userId) {
  try {
    const existing = await demoScenarioStore.load(userId);
    const allTx = dataStore.getTransactionsByUserId(userId).slice(-50); // Keep 50 most recent
    await demoScenarioStore.save(userId, {
      ...existing,
      transactionSnapshot: allTx
    });
  } catch (e) {
    console.warn('[transactions] saveTransactionSnapshot failed:', e.message);
  }
}

// Get all transactions (admin only)
router.get('/', authenticateToken, requireScopes(['read']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const transactions = dataStore.getAllTransactions();
    const allUsers = dataStore.getAllUsers();
    const userMap = {};
    for (const u of allUsers) { userMap[u.id] = u; }
    const transactionsWithNames = transactions.map(transaction => {
      const owner = transaction.userId ? userMap[transaction.userId] : null;
      return {
        ...transaction,
        performedBy: owner ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim() : transaction.userId,
        ownerUsername: owner?.username || transaction.userId || 'unknown',
        ownerEmail: owner?.email || null,
      };
    });
    res.json({ transactions: transactionsWithNames });
  } catch (error) {
    console.error('Error getting transactions:', error);
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});



// Get user's own transactions (end users)
// No read scope required — standard PingOne tokens without a custom resource server
// only carry openid/profile/email. Once a resource server is configured in PingOne and
// ENDUSER_AUDIENCE is set, restore: requireScopes(['transactions:read', 'read'])
router.get('/my', authenticateToken, requireNotAdmin, async (req, res) => {
  try {
    // Re-hydrate transactions from Redis snapshot in case this Lambda was cold-started.
    if (req.user.role !== 'admin') {
      await restoreTransactionsFromSnapshot(req.user.id);
    }

    // Log RFC 8693 delegated access for audit/demo visibility
    if (req.user.isDelegated) {
      console.log(`[transactions] Delegated access — sub=${req.user.id} act.sub=${req.user.actor?.sub}`);
    }

    res.set({ 'Cache-Control': 'no-store' });
    
    const userTransactions = dataStore.getTransactionsByUserId(req.user.id);
    const user = dataStore.getUserById(req.user.id);
    const fullName = user ? `${user.firstName} ${user.lastName}` : req.user.username;
    
    // Add username and account information to each transaction
    const transactionsWithUsername = userTransactions.map(transaction => {
      // Get account information
      let accountInfo = 'Unknown';
      if (transaction.fromAccountId) {
        const fromAccount = dataStore.getAccountById(transaction.fromAccountId);
        if (fromAccount) {
          accountInfo = `${fromAccount.accountType} - ${fromAccount.accountNumber}`;
        }
      } else if (transaction.toAccountId) {
        const toAccount = dataStore.getAccountById(transaction.toAccountId);
        if (toAccount) {
          accountInfo = `${toAccount.accountType} - ${toAccount.accountNumber}`;
        }
      }
      
      return {
        ...transaction,
        accountId: transaction.fromAccountId || transaction.toAccountId || null,
        performedBy: fullName,
        accountInfo: accountInfo
      };
    });
    
    res.json({ 
      transactions: transactionsWithUsername,
      timestamp: new Date().toISOString(),
      count: transactionsWithUsername.length
    });
  } catch (error) {
    console.error('Error getting user transactions:', error);
    res.status(500).json({ error: 'Failed to get your transactions' });
  }
});

// Session-bound consent challenge for high-value transactions (HITL). Registered before /:id so "consent-challenge" is not captured as an id.
// No write scope required — same reasoning as POST /; session ownership is enforced inside txConsent.
router.post(
  '/consent-challenge',
  authenticateToken,
  async (req, res) => {
    // Re-hydrate accounts from Redis snapshot in case this Lambda was cold-started.
    if (req.user.role !== 'admin') {
      await restoreAccountsFromSnapshot(req.user.id);
    }
    const result = txConsent.createChallenge(req, req.body);
    if (!result.ok) return res.status(result.status).json(result.json);
    // Explicitly save session to Redis before responding — on Vercel the next
    // GET /consent-challenge/:id may land on a different Lambda and must find
    // the challenge already persisted (auto-save races with the next request).
    req.session.save((saveErr) => {
      if (saveErr) console.error('[ConsentChallenge] session save error:', saveErr);
      posthog.capture({
        distinctId: req.user.id,
        event: 'consent_challenge_created',
        properties: {
          challenge_id: result.challengeId,
          transaction_type: req.body.type,
          amount: req.body.amount,
        },
      });
      return res.status(201).json({
        challengeId: result.challengeId,
        expiresAt: result.expiresAt,
        snapshot: result.snapshot,
      });
    });
  },
);

router.post(
  '/consent-challenge/:challengeId/confirm',
  authenticateToken,
  async (req, res) => {
    const result = await txConsent.confirmChallenge(req, req.params.challengeId);
    if (!result.ok) return res.status(result.status).json(result.json);
    req.session.save((saveErr) => {
      if (saveErr) console.error('[ConsentChallenge] session save error (confirm):', saveErr);
      posthog.capture({
        distinctId: req.user.id,
        event: 'consent_challenge_confirmed',
        properties: { challenge_id: result.challengeId, otp_sent: result.otpSent },
      });
      let responseBody;
      if (result.mfaRequired) {
        responseBody = { challengeId: result.challengeId, mfaRequired: true, devices: result.devices };
      } else if (result.needsContact) {
        responseBody = { challengeId: result.challengeId, needsContact: true };
      } else {
        responseBody = {
          challengeId: result.challengeId,
          otpSent: result.otpSent,
          otpExpiresAt: result.otpExpiresAt,
          ...(result.maskedContact ? { maskedContact: result.maskedContact } : {}),
          ...(result.otpCodeFallback ? { otpCodeFallback: result.otpCodeFallback } : {}),
        };
      }
      return res.status(200).json(responseBody);
    });
  },
);

router.post(
  '/consent-challenge/:challengeId/confirm-contact',
  authenticateToken,
  async (req, res) => {
    const { email, phone } = req.body || {};
    const result = await txConsent.confirmOnetimeContact(req, req.params.challengeId, { email, phone });
    if (!result.ok) return res.status(result.status).json(result.json);
    req.session.save((saveErr) => {
      if (saveErr) console.error('[ConsentChallenge] session save error (confirm-contact):', saveErr);
      return res.status(200).json({
        challengeId: result.challengeId,
        otpSent: result.otpSent,
        otpExpiresAt: result.otpExpiresAt,
        ...(result.maskedContact ? { maskedContact: result.maskedContact } : {}),
      });
    });
  },
);

router.post(
  '/consent-challenge/:challengeId/verify-otp',
  authenticateToken,
  async (req, res) => {
    const challengeId = req.params.challengeId;
    const path = txConsent.getChallengePath(req, challengeId);
    let result;
    if (path === 'mfa' || path === 'onetime') {
      // The onetime path (PingOne email OTP, no device picker) UI sends the code
      // as `otpCode`; the device-picker UI sends `otp`. Accept either, or a valid
      // code is dropped as missing_credential before PingOne is ever called.
      const { deviceId, otp, otpCode, fido2Assertion } = req.body || {};
      const host = req.get('host') || null;
      const origin = host ? `${req.protocol}://${host}` : `https://demo-api-server:3001`;
      result = await txConsent.verifyMfa(req, challengeId, { deviceId, otp: otp || otpCode, fido2Assertion }, origin);
    } else {
      const { otpCode } = req.body || {};
      result = txConsent.verifyOtp(req, challengeId, otpCode);
    }
    if (!result.ok) return res.status(result.status).json(result.json);
    req.session.save((saveErr) => {
      if (saveErr) console.error('[ConsentChallenge] session save error (verify-otp):', saveErr);
      return res.status(200).json({
        challengeId: result.challengeId,
        confirmExpiresAt: result.confirmExpiresAt,
      });
    });
  },
);

router.post(
  '/consent-challenge/:challengeId/verify-recognize',
  authenticateToken,
  express.json(),
  async (req, res) => {
    const { challengeId } = req.params;
    const result = await txConsent.verifyRecognize(req, challengeId, req.body.result || req.body);
    if (!result.ok) {
      return res.status(result.status || 400).json({ ...result.json, fallback: result.fallback || false });
    }
    req.session.save((saveErr) => {
      if (saveErr) console.error('[ConsentChallenge] session save error (verify-recognize):', saveErr);
      return res.json({ ok: true });
    });
  },
);

router.post(
  '/consent-challenge/:challengeId/recognize-fallback',
  authenticateToken,
  express.json(),
  async (req, res) => {
    const { challengeId } = req.params;
    const result = await txConsent.recognizeFallback(req, challengeId);
    if (!result.ok) return res.status(result.status || 400).json(result.json);
    req.session.save((saveErr) => {
      if (saveErr) console.error('[ConsentChallenge] session save error (recognize-fallback):', saveErr);
      return res.json(result);
    });
  },
);

router.post(
  '/consent-challenge/:challengeId/select-device',
  authenticateToken,
  async (req, res) => {
    const { deviceId } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'missing_device_id', message: 'deviceId is required.' });
    const result = await txConsent.selectMfaDevice(req, req.params.challengeId, deviceId);
    if (!result.ok) return res.status(result.status).json(result.json);
    req.session.save((saveErr) => {
      if (saveErr) console.error('[ConsentChallenge] session save error (select-device):', saveErr);
      return res.status(200).json({ otpSent: true, otpExpiresAt: result.otpExpiresAt });
    });
  },
);

/** Read pending challenge snapshot for the consent UI (must be registered before GET /:id). */
router.get(
  '/consent-challenge/:challengeId',
  authenticateToken,
  (req, res) => {
    const result = txConsent.getChallenge(req, req.params.challengeId);
    if (!result.ok) return res.status(result.status).json(result.json);
    return res.json({
      challengeId: result.challengeId,
      snapshot: result.snapshot,
      status: result.status,
      expiresAt: result.expiresAt,
    });
  },
);

// Get transaction by ID (admin or transaction owner)
router.get('/:id', authenticateToken, requireScopes(['read']), async (req, res) => {
  try {
    const transaction = dataStore.getTransactionById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    // Check if user is admin or transaction owner
    if (req.user.role !== 'admin' && transaction.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied. You can only view your own transactions.' });
    }
    
    res.json({ transaction });
  } catch (error) {
    console.error('Error getting transaction:', error);
    res.status(500).json({ error: 'Failed to get transaction' });
  }
});

// Create new transaction (admin or end user)
// No write scope required — standard PingOne tokens without a custom resource server
// only carry openid/profile/email. Once a resource server is configured in PingOne and
// ENDUSER_AUDIENCE is set, restore requireScopes(['transactions:write', 'write']).
// Ownership is enforced below (non-admin users can only act on their own accounts).
router.post('/', authenticateToken, async (req, res) => {
  try {
    let { fromAccountId, toAccountId, amount, type, description, userId } = req.body;

    // Re-hydrate accounts from Redis snapshot in case this Lambda was cold-started.
    // Must run before any getAccountById lookup below.
    if (req.user.role !== 'admin') {
      await restoreAccountsFromSnapshot(req.user.id);
    }

    // Customer-only gate: admin sessions must not initiate customer transactions
    if (req.user.role === 'admin') {
      return res.status(403).json({
        error: 'forbidden',
        error_description: 'Transactions must be initiated with a customer account. Sign in as a bank customer to proceed.',
      });
    }

    // Delegate-user gate: demoDelegate can deposit but cannot transfer,
    // withdraw, or pay. Read-only ops (GET balances, GET account details)
    // are unaffected by this — they're already gated by `read` scope.
    if (req.user.isBankDelegate === true) {
      const requestedType = String(req.body.type || '').toLowerCase();
      const ALLOWED_FOR_DELEGATE = new Set(['deposit']);
      if (!ALLOWED_FOR_DELEGATE.has(requestedType)) {
        return res.status(403).json({
          error: 'forbidden_for_delegate',
          message: `Delegated users cannot perform '${requestedType}' transactions. Allowed: deposit.`,
          code: 'DELEGATE_RESTRICTED',
          allowed: ['deposit'],
          restricted: ['transfer', 'withdrawal', 'payment'],
        });
      }
    }

    // Resolve account type names (e.g., "checking") to account IDs before lookups
    const userAccounts = dataStore.getAccountsByUserId(req.user.id);
    if (fromAccountId) {
      fromAccountId = resolveAccountId(fromAccountId, userAccounts);
      req.body.fromAccountId = fromAccountId;
    }
    if (toAccountId) {
      toAccountId = resolveAccountId(toAccountId, userAccounts);
      req.body.toAccountId = toAccountId;
    }

    // Validate amount
    const parsedAmount = parseFloat(req.body.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'invalid_amount', message: 'Amount must be a positive number.' });
    }
    if (parsedAmount > 1_000_000) {
      return res.status(400).json({ error: 'amount_exceeds_limit', message: 'Transaction amount cannot exceed $1,000,000.' });
    }

    // ── Hard transaction limit gate ──────────────────────────────────────
    // Block ALL transactions exceeding the absolute maximum (applies to all user types)
    const MAX_TRANSACTION_AMOUNT = parseFloat(configStore.getEffective('max_transaction_amount')) || 1000;
    if (parseFloat(amount) > MAX_TRANSACTION_AMOUNT) {
      // Also check if the source account has insufficient funds, so the error message can surface both reasons.
      let insufficientFundsAlso = false;
      if (fromAccountId && (type === 'withdrawal' || type === 'transfer')) {
        const srcAccount = dataStore.getAccountById(fromAccountId);
        if (srcAccount && srcAccount.balance < parseFloat(amount)) insufficientFundsAlso = true;
      }
      return res.status(400).json({
        error: 'amount_exceeds_hard_limit',
        message: `Transaction amount cannot exceed $${MAX_TRANSACTION_AMOUNT}.`,
        limit: MAX_TRANSACTION_AMOUNT,
        amount: parseFloat(amount),
        insufficient_funds_also: insufficientFundsAlso,
      });
    }
    // ── End hard limit gate ──────────────────────────────────────────────

        // Round to 2 decimal places to prevent floating-point manipulation
    req.body.amount = roundToCents(parsedAmount);

    const performingUser = dataStore.getUserById(req.user.id);
    const performedByName = performingUser ? `${performingUser.firstName} ${performingUser.lastName}` : req.user.username;

    // Validate required fields
    if (!amount || !type) {
      return res.status(400).json({ error: 'Missing required fields: amount and type' });
    }
    
    // For deposits, we need toAccountId
    if (type === 'deposit' && !toAccountId) {
      return res.status(400).json({ error: 'Missing required field: toAccountId for deposit' });
    }
    
    // For withdrawals, we need fromAccountId
    if (type === 'withdrawal' && !fromAccountId) {
      return res.status(400).json({ error: 'Missing required field: fromAccountId for withdrawal' });
    }
    
    // For transfers, we need both fromAccountId and toAccountId
    if (type === 'transfer' && (!fromAccountId || !toAccountId)) {
      return res.status(400).json({ error: 'Missing required fields: fromAccountId and toAccountId for transfer' });
    }
    
    // For end users, ensure they can only create transactions for their own accounts
    if (req.user.role !== 'admin') {
      // Validate accounts exist and user has access
      if (fromAccountId) {
        const fromAccount = dataStore.getAccountById(fromAccountId);
        if (!fromAccount) {
          return res.status(404).json({ error: 'From account not found' });
        }
        if (fromAccount.userId !== req.user.id) {
          return res.status(403).json({ error: 'Access denied. You can only transfer from your own accounts.' });
        }
      }
      
      if (toAccountId) {
        const toAccount = dataStore.getAccountById(toAccountId);
        if (!toAccount) {
          return res.status(404).json({ error: 'To account not found' });
        }
        if (toAccount.userId !== req.user.id) {
          return res.status(403).json({ error: 'Access denied. You can only deposit to your own accounts.' });
        }
      }
      
      // Use the authenticated user's ID
      req.body.userId = req.user.id;
    }

    // ── Scope validation ──────────────────────────────────────────────────────
    // Write operations (transfer, deposit, withdrawal) require write scope
    // when the token carries any data scopes (resource server is configured).
    // Standard PingOne browser-session tokens carry only openid/profile/email and
    // have no data scopes; scope enforcement is skipped for them — auth is
    // handled by the session + ownership checks below.
    const userScopes = req.user.scopes || [];
    const writeOperations = ['transfer', 'deposit', 'withdrawal'];
    if (writeOperations.includes(type)) {
      const hasBankingScopes = userScopes.some(s => s === 'read' || s === 'write');
      const hasWriteScope = userScopes.includes(BANKING_SCOPES.BANKING_WRITE);
      if (hasBankingScopes && !hasWriteScope) {
        console.log(`[Scopes] User ${req.user.id} missing ${BANKING_SCOPES.BANKING_WRITE} for ${type}`);
        return res.status(403).json({
          error: 'insufficient_scope',
          error_description: `Operation requires '${BANKING_SCOPES.BANKING_WRITE}' scope. User scopes: ${userScopes.join(', ') || '(none)'}`,
          required_scope: BANKING_SCOPES.BANKING_WRITE,
          user_scopes: userScopes
        });
      }
    }
    // ── End scope validation ──────────────────────────────────────────────────

    // ── Session check for conditional authentication (Phase 122) ───────────────
    // Non-logged-in users must sign in before any banking action.
    // Skip this check when the request is authenticated via Bearer token (MCP server,
    // agent gateway, or any direct API caller) — authenticateToken already validated
    // the JWT and set req.user. Session is only required for browser-originated calls.
    const hasBearerAuth = !!(req.headers.authorization && req.headers.authorization.startsWith('Bearer '));
    if (!hasBearerAuth && !req.session?.user) {
      console.log('[SessionCheck] No active session - login required for banking action');
      return res.status(401).json({
        error: 'unauthenticated',
        error_description: 'Login required. Please sign in to perform banking operations.',
        login_url: '/sign-in'
      });
    }

    // ── Authorization (PingOne Authorize or simulated) — runs first, owns all decisions ──
    // Authorize decides: allow | deny | hitl_required{type} | step_up_required.
    // ff_hitl_enabled=false skips consent enforcement but not deny/step-up.
    // Authorization is ALWAYS ENFORCED — errors are fail-closed by default.
    // Only set ff_authorize_fail_open=true to bypass on error (security risk).
    const AUTHORIZE_FAIL_OPEN = configStore.get('ff_authorize_fail_open') === 'true'; // default false (fail-closed)
    const hitlEnabled = configStore.getEffective('ff_hitl_enabled') !== 'false';
    const hitlAmount = parseFloat(req.body.amount);
    /** @type {object|null} */
    let authorizeEvaluation = null;

    // If the user completed step-up MFA via email OTP in this session, treat as strong acr.
    // Consume the flag (single-use) so subsequent transactions still enforce the gate.
    let effectiveAcr = req.user.acr;
    if (req.session?.stepUpVerified > Date.now()) {
      effectiveAcr = 'Multi_Factor';
      req.session.stepUpVerified = 0;
    }

    const authz = await transactionAuthorizationService.evaluateTransactionPolicy({
      runtimeSettings,
      userRole: req.user.role,
      userId: req.user.id,
      amount: parseFloat(amount),
      type,
      acr: effectiveAcr,
      useCaseId: req.body?.useCaseId || '',
    });

    if (authz.ran) {
      if (authz.block) {
        const { body } = authz.block;
        if (body.error === 'hitl_required' && body.hitl && body.hitl.type === 'consent') {
          if (!hitlEnabled) {
            logAppEvent(EVENT_CATEGORIES.HITL, 'info',
              `HITL consent skipped — ff_hitl_enabled=false`,
              { tag: 'hitl/flag-disabled', metadata: { type, amount: hitlAmount, userId: req.user?.id } });
          } else if (!req.body.consentChallengeId) {
            logAppEvent(EVENT_CATEGORIES.HITL, 'warning',
              `HITL consent required — no challengeId provided (${type} $${hitlAmount})`,
              { tag: 'hitl/consent-required', metadata: { type, amount: hitlAmount, userId: req.user?.id } });
            return res.status(428).json({
              ...body,
              fromAccountId: fromAccountId || null,
              toAccountId: toAccountId || null,
              amount: hitlAmount,
              type,
            });
          } else {
            const consumed = txConsent.verifyAndConsumeChallenge(req, req.body.consentChallengeId, req.body);
            if (!consumed.ok) {
              logAppEvent(EVENT_CATEGORIES.HITL, 'warning',
                `HITL consent verification failed — ${consumed.json.error}`,
                { tag: 'hitl/consent-rejected', metadata: { type, amount: hitlAmount, userId: req.user?.id, error: consumed.json.error } });
              return res.status(consumed.status).json(consumed.json);
            }
            logAppEvent(EVENT_CATEGORIES.HITL, 'info',
              `HITL consent verified — ${type} $${hitlAmount} proceeding`,
              { tag: 'hitl/consent-verified', metadata: { type, amount: hitlAmount, userId: req.user?.id } });
          }
        } else {
          return res.status(authz.block.status).json(body);
        }
      }
      if (authz.simulatedError) {
        logAppEvent(EVENT_CATEGORIES.AUTHORIZE, 'error',
          `Authorize simulated error — ${authz.simulatedError.message}`,
          { tag: 'authorize/simulated-error', metadata: { type, userId: req.user?.id } });
        return res.status(500).json({
          error: 'simulated_authorize_error',
          error_description: 'Simulated policy evaluation failed unexpectedly.',
        });
      }
      if (authz.pingoneError) {
        if (AUTHORIZE_FAIL_OPEN) {
          logAppEvent(EVENT_CATEGORIES.AUTHORIZE, 'warning',
            `Authorize error — failing open: ${authz.pingoneError.message}`,
            { tag: 'authorize/fail-open', metadata: { type, userId: req.user?.id } });
        } else {
          logAppEvent(EVENT_CATEGORIES.AUTHORIZE, 'error',
            `Authorize error — failing closed: ${authz.pingoneError.message}`,
            { tag: 'authorize/fail-closed', metadata: { type, userId: req.user?.id } });
          return res.status(503).json({
            error: 'authorize_unavailable',
            error_description: 'Transaction policy evaluation failed and fail-open is disabled. Try again or contact an administrator.',
          });
        }
      }
      if (authz.permit && authz.evaluation) {
        authorizeEvaluation = authz.evaluation;
        const ev = authz.evaluation;
        logAppEvent(EVENT_CATEGORIES.AUTHORIZE, 'info',
          `Authorize ${ev.engine} PERMIT — ${type} $${parseFloat(amount)} user ${req.user.id}`,
          { tag: 'authorize/permit', metadata: { engine: ev.engine, type, amount: parseFloat(amount), userId: req.user.id, decisionId: ev.decisionId || null } });
      }
    } else {
      logAppEvent(EVENT_CATEGORIES.AUTHORIZE, 'info',
        `Authorize gate skipped — ${authz.reason || 'unknown'}`,
        { tag: 'authorize/gate-skipped', metadata: { reason: authz.reason, type, userId: req.user?.id } });
    }
    // ── End Authorize gate ────────────────────────────────────────────────────

    // Apply the balance change atomically (AFTER authorization, so HITL/deny/
    // step-up gates run first regardless of balance; BEFORE recording the
    // transaction so we never record a transfer we couldn't fund).
    //
    // applyTransfer performs the existence + sufficient-funds check and BOTH
    // balance mutations in a single synchronous critical section, preventing the
    // lost-update / overdraft race that a separate check-then-await-then-mutate
    // sequence allows (two concurrent debits both passing the check). It debits
    // fromAccountId (if set) and credits toAccountId (if set) — matching the
    // prior per-branch updateAccountBalance behavior.
    {
      const move = await dataStore.applyTransfer(fromAccountId || null, toAccountId || null, amount);
      if (!move.ok) {
        if (move.reason === 'from_not_found') return res.status(404).json({ error: 'From account not found' });
        if (move.reason === 'to_not_found') return res.status(404).json({ error: 'To account not found' });
        if (move.reason === 'insufficient_funds') return res.status(400).json({ error: 'Insufficient balance' });
        return res.status(400).json({ error: 'invalid_amount' });
      }
    }

    // For transfers, create two separate transactions
    if (type === 'transfer') {
      // Resolve account labels for human-readable descriptions
      const fromAccountInfo = dataStore.getAccountById(fromAccountId);
      const toAccountInfo = dataStore.getAccountById(toAccountId);
      const fromLabel = fromAccountInfo ? `${fromAccountInfo.accountType} - ${fromAccountInfo.accountNumber}` : fromAccountId;
      const toLabel = toAccountInfo ? `${toAccountInfo.accountType} - ${toAccountInfo.accountNumber}` : toAccountId;

      // Create withdrawal transaction from source account
      const withdrawalTransaction = await dataStore.createTransaction({
        fromAccountId: fromAccountId,
        toAccountId: null,
        amount: amount,
        type: 'withdrawal',
        description: `Transfer to ${toLabel}: ${description}`,
        userId: req.user.id || userId,
        performedBy: performedByName,
        clientType: req.user.clientType || 'unknown',
        tokenType: req.user.tokenType || 'unknown'
      });
      
      // Create deposit transaction to destination account
      const depositTransaction = await dataStore.createTransaction({
        fromAccountId: null,
        toAccountId: toAccountId,
        amount: amount,
        type: 'deposit',
        description: `Transfer from ${fromLabel}: ${description}`,
        userId: req.user.id || userId,
        performedBy: performedByName,
        clientType: req.user.clientType || 'unknown',
        tokenType: req.user.tokenType || 'unknown'
      });
      
      // Balances were already moved atomically above (applyTransfer).

      // Log transaction creation with client type
      console.log(`[Transaction] Transfer created by ${req.user.username} (${req.user.clientType || 'unknown'} via ${req.user.tokenType || 'unknown'}) - Amount: $${amount}`);

      posthog.capture({
        distinctId: req.user.id,
        event: 'transfer_completed',
        properties: {
          amount: parseFloat(amount),
          from_account_id: fromAccountId,
          to_account_id: toAccountId,
          client_type: req.user.clientType || 'unknown',
        },
      });

      // Send confirmation email via PingOne Notifications (fire-and-forget)
      {
        const fromAcc  = dataStore.getAccountById(fromAccountId);
        const toAcc    = dataStore.getAccountById(toAccountId);
        const userName = req.user.firstName || req.user.name || req.user.username;
        sendTransactionConfirmation(req.user.id, {
          type: 'transfer',
          amount,
          fromAccount: fromAcc ? `${fromAcc.accountType} — ${fromAcc.accountNumber}` : fromAccountId,
          toAccount:   toAcc   ? `${toAcc.accountType} — ${toAcc.accountNumber}`     : toAccountId,
          newBalance:  dataStore.getAccountById(fromAccountId)?.balance,
          transactionId: withdrawalTransaction.id,
          userName,
        });
      }

      await saveTransactionSnapshot(req.user.id);

      res.status(201).json({
        message: 'Transfer completed successfully',
        withdrawalTransaction,
        depositTransaction,
        ...(authorizeEvaluation && { authorizeEvaluation }),
      });
    } else {
      // For non-transfer transactions, create single transaction
      const transaction = await dataStore.createTransaction({
        fromAccountId,
        toAccountId,
        amount,
        type,
        description,
        userId: req.user.id || userId,
        performedBy: performedByName,
        clientType: req.user.clientType || 'unknown',
        tokenType: req.user.tokenType || 'unknown'
      });
      
      // Balances were already moved atomically above (applyTransfer).

      // Log transaction creation with client type
      console.log(`💰 [Transaction] ${type} created by ${req.user.username} (${req.user.clientType || 'unknown'} via ${req.user.tokenType || 'unknown'}) - Amount: $${amount}`);

      posthog.capture({
        distinctId: req.user.id,
        event: 'transaction_created',
        properties: {
          transaction_type: type,
          amount: parseFloat(amount),
          client_type: req.user.clientType || 'unknown',
        },
      });

      // Send confirmation email via PingOne Notifications (fire-and-forget)
      {
        const accountId = toAccountId || fromAccountId;
        const account   = accountId ? dataStore.getAccountById(accountId) : null;
        const userName  = req.user.firstName || req.user.name || req.user.username;
        sendTransactionConfirmation(req.user.id, {
          type: type === 'withdrawal' ? 'withdrawal' : 'deposit',
          amount,
          fromAccount: fromAccountId ? (account ? `${account.accountType} — ${account.accountNumber}` : fromAccountId) : undefined,
          toAccount:   toAccountId   ? (account ? `${account.accountType} — ${account.accountNumber}` : toAccountId)   : undefined,
          newBalance:  account?.balance,
          transactionId: transaction.id,
          userName,
        });
      }

      await saveTransactionSnapshot(req.user.id);

      res.status(201).json({
        message: 'Transaction created successfully',
        transaction,
        ...(authorizeEvaluation && { authorizeEvaluation }),
      });
    }
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// Update transaction (admin only)
router.put('/:id', blockInDemoMode('transaction update'), authenticateToken, requireScopes(['write']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const transaction = await dataStore.updateTransaction(req.params.id, req.body);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ message: 'Transaction updated successfully', transaction });
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// Delete transaction (admin only)
router.delete('/:id', blockInDemoMode('transaction deletion'), authenticateToken, requireScopes(['write']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const deleted = await dataStore.deleteTransaction(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

module.exports = router;