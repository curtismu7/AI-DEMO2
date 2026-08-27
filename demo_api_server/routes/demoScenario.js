// banking_api_server/routes/demoScenario.js
/**
 * GET/PUT demo scenario — account display names, balances, per-user step-up threshold.
 * Authenticated users may only modify their own accounts.
 */
'use strict';

const express = require('express');
const axios = require('axios');
const { randomUUID: uuidv4 } = require('node:crypto');
const dataStore = require('../data/store');
const runtimeSettings = require('../config/runtimeSettings');
const demoScenarioStore = require('../services/demoScenarioStore');
const accountsRouter = require('./accounts');
const { getManagementToken } = require('../services/pingOneClientService');
const configStore = require('../services/configStore');
const { authenticateToken } = require('../middleware/auth');
const { roundToCents } = require('../utils/money');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const router = express.Router();

const DEFAULT_STEP_UP = () => runtimeSettings.get('stepUpAmountThreshold');
// 'role' is blocked because mcpLocalTools.js#hitlBlocksLocalWrite() reads it
// straight off this same user record to decide whether a transfer/withdrawal
// needs HITL consent — a self-service role update would let any customer
// grant themselves that bypass.
const BLOCKED_USER_FIELDS = new Set(['id', 'password', 'createdAt', 'role']);

/** Legacy `both` in KV → floating (embedded and floating FAB are mutually exclusive in the UI). */
function normalizeBankingAgentUiMode(stored) {
  if (stored === 'embedded' || stored === 'floating' || stored === 'both') return stored;
  return null;
}

/** @param {unknown} stored */
function normalizeBankingAgentUi(stored) {
  if (!stored || typeof stored !== 'object') return null;
  const p = stored.placement;
  const fab = Boolean(stored.fab);
  if (p !== 'middle' && p !== 'bottom' && p !== 'none') return null;
  if (p === 'none' && !fab) return { placement: 'none', fab: true };
  return { placement: p, fab };
}

function effectiveBankingAgentUi(scenario) {
  const direct = normalizeBankingAgentUi(scenario.bankingAgentUi);
  if (direct) return direct;
  const legacy = normalizeBankingAgentUiMode(scenario.bankingAgentUiMode);
  if (legacy === 'embedded') return { placement: 'bottom', fab: false };
  if (legacy === 'both') return { placement: 'bottom', fab: true };
  if (legacy === 'floating') return { placement: 'none', fab: true };
  return { placement: 'none', fab: true };
}

function legacyModeFromUi(ui) {
  if (ui.placement === 'none') return 'floating';
  if (ui.placement === 'bottom' && !ui.fab) return 'embedded';
  if (ui.placement === 'bottom' && ui.fab) return 'both';
  if (ui.placement === 'middle' && !ui.fab) return 'embedded';
  return 'both';
}

/** Shown in Demo config UI only when DB + session have no profile strings (never overwrites real data). */
const PROFILE_UI_FALLBACK = Object.freeze({
  firstName: 'Jordan',
  lastName: 'Demo',
  email: 'jordan.demo@bxfinance.local',
  username: 'jordan_demo',
});

function isBlank(v) {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

/** True when the client sent a persisted account id (non-empty string). */
function isExistingAccountId(id) {
  if (id == null) return false;
  return String(id).trim().length > 0;
}

/**
 * Persist a snapshot of the user's current accounts to demoScenarioStore (Redis/KV).
 * Called after any PUT that modifies accounts so cold-start restarts can recover them.
 */
async function saveAccountSnapshot(userId) {
  const accounts = dataStore.getAccountsByUserId(userId);
  const snapshot = accounts.map(a => ({
    id: a.id,
    accountType: a.accountType,
    accountNumber: a.accountNumber,
    name: a.name || '',
    balance: a.balance,
    currency: a.currency || 'USD',
    isActive: a.isActive !== false,
  }));
  await demoScenarioStore.save(userId, { accountSnapshot: snapshot });
}

/**
 * On cold-start, the in-memory dataStore loses all accounts.  Rebuild them from
 * the last snapshot stored in demoScenarioStore (Redis/KV).
 * Returns the restored accounts array, or [] if no snapshot exists (the
 * legitimate case — demoScenarioStore.load() never throws for "not found",
 * it just omits accountSnapshot).  A genuine read/create failure (e.g. the
 * LMDB env is transiently unavailable) is NOT swallowed here — it propagates
 * to the caller so a transient store error can't be mistaken for "no
 * snapshot" and trigger reprovisioning fresh accounts over the real ones.
 */
async function restoreAccountsFromSnapshot(userId) {
  const scenario = await demoScenarioStore.load(userId);
  if (!Array.isArray(scenario.accountSnapshot) || scenario.accountSnapshot.length === 0) return [];
  const restored = [];
  for (const snap of scenario.accountSnapshot) {
    const existing = dataStore.getAccountById(snap.id);
    if (existing) {
      restored.push(existing);
    } else {
      const acct = await dataStore.createAccount({
        ...snap,
        userId,
        createdAt: new Date(),
      });
      restored.push(acct);
    }
  }
  return restored;
}

/** Allowed account types from the Demo config UI (new rows). */
const DEMO_ACCOUNT_TYPES = new Set([
  'checking',
  'savings',
  'investment',
  'money_market',
  'credit',
  'car_loan',
  'mortgage',
]);

const DEMO_ACCOUNT_NUMBER_PREFIX = {
  checking: 'CHK',
  savings: 'SAV',
  investment: 'INV',
  money_market: 'MMK',
  credit: 'CRD',
  car_loan: 'CAR',
  mortgage: 'HOM',
};

const DEMO_DEFAULT_ACCOUNT_NAMES = {
  checking: 'Checking Account',
  savings: 'Savings Account',
  investment: 'Investment Account',
  money_market: 'Money Market Account',
  credit: 'Credit Card',
  car_loan: 'Car Loan',
  mortgage: 'Mortgage (Home Loan)',
};

function normalizeDemoAccountType(raw) {
  const typeRaw = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
  if (DEMO_ACCOUNT_TYPES.has(typeRaw)) return typeRaw;
  return 'checking';
}

/**
 * Merge PingOne/session-backed identity into stored user for the demo-config form.
 * Anonymous fields stay empty until we fall back to PROFILE_UI_FALLBACK.
 */
function buildUserDataForDemoResponse(req, dbUser) {
  const { password: _pw, ...rest } = dbUser || {};
  const su = req.session?.user || {};
  const tu = req.user || {};
  const out = { ...rest };

  const coalesce = (key, ...tokenKeys) => {
    const raw = out[key];
    if (!isBlank(raw)) return String(raw).trim();
    if (!isBlank(su[key])) return String(su[key]).trim();
    const tuKeys = tokenKeys.length ? tokenKeys : [key];
    for (const tk of tuKeys) {
      if (!isBlank(tu[tk])) return String(tu[tk]).trim();
    }
    return '';
  };

  out.id = out.id || tu.id || su.id || '';
  out.firstName = coalesce('firstName');
  out.lastName = coalesce('lastName');
  out.email = coalesce('email');
  out.username = coalesce('username');
  out.role = out.role || su.role || tu.role || '';
  out.createdAt = out.createdAt || su.createdAt || '';
  if (out.isActive === undefined || out.isActive === null) {
    out.isActive = su.isActive !== false;
  }

  if (!out.username && out.email) {
    const local = String(out.email).split('@')[0];
    if (local) out.username = local;
  }

  const allNamesEmpty =
    isBlank(out.firstName) && isBlank(out.lastName) && isBlank(out.email) && isBlank(out.username);
  if (allNamesEmpty) {
    out.firstName = PROFILE_UI_FALLBACK.firstName;
    out.lastName = PROFILE_UI_FALLBACK.lastName;
    out.email = PROFILE_UI_FALLBACK.email;
    out.username = PROFILE_UI_FALLBACK.username;
  }

  return out;
}

/**
 * Returns safe user profile updates from a JSON object.
 * Blocks immutable/sensitive fields and trims long strings.
 */
function sanitizeUserUpdates(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const updates = {};
  for (const [key, value] of Object.entries(raw)) {
    if (BLOCKED_USER_FIELDS.has(key)) continue;
    if (typeof value === 'string') {
      updates[key] = value.trim().slice(0, 300);
      continue;
    }
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      (Array.isArray(value) && value.length <= 50) ||
      (value && typeof value === 'object')
    ) {
      updates[key] = value;
    }
  }
  return updates;
}

// Auth: server mounts this router with authenticateToken only (same pattern as GET /api/accounts/my).
// No * scope gate — Backend-for-Frontend (BFF) session users often lack those scopes in the PingOne access token.
router.get('/', async (req, res) => {
  try {
    let accounts = dataStore.getAccountsByUserId(req.user.id);
    if (accounts.length === 0 && req.user.id) {
      // Try restoring persisted snapshot (Redis/KV) before provisioning fresh defaults.
      accounts = await restoreAccountsFromSnapshot(req.user.id);
      if (accounts.length === 0 && typeof accountsRouter.provisionDemoAccounts === 'function') {
        accounts = await accountsRouter.provisionDemoAccounts(req.user.id);
        // Persist the freshly provisioned accounts so future cold-starts can restore them.
        await saveAccountSnapshot(req.user.id);
      }
    }
    const scenario = await demoScenarioStore.load(req.user.id);
    const currentUser = dataStore.getUserById(req.user.id) || {};
    const userData = buildUserDataForDemoResponse(req, currentUser);
    const bankingAgentUi = effectiveBankingAgentUi(scenario);
    const bankingAgentUiMode = legacyModeFromUi(bankingAgentUi);
    res.json({
      accounts: accounts.map(a => ({
        id: a.id,
        name: a.name || '',
        accountNumber: a.accountNumber,
        accountType: a.accountType,
        balance: a.balance,
        currency: a.currency || 'USD',
      })),
      settings: {
        stepUpAmountThreshold:
          scenario.stepUpAmountThreshold != null ? scenario.stepUpAmountThreshold : DEFAULT_STEP_UP(),
        stepUpAmountThresholdIsDefault: scenario.stepUpAmountThreshold == null,
        bankingAgentUiMode,
        bankingAgentUi,
      },
      defaults: {
        stepUpAmountThreshold: DEFAULT_STEP_UP(),
        checkingName: 'Checking Account',
        savingsName: 'Savings Account',
        checkingBalance: 3000,
        savingsBalance: 2000,
        profileForm: {
          firstName: PROFILE_UI_FALLBACK.firstName,
          lastName: PROFILE_UI_FALLBACK.lastName,
          email: PROFILE_UI_FALLBACK.email,
          username: PROFILE_UI_FALLBACK.username,
        },
      },
      accountProfileFields: scenario.accountProfileFields || {},
      persistenceNote:
        (process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT) &&
        !demoScenarioStore.isPersistenceConfigured()
          ? 'Demo settings (threshold, agent layout) are not persisted — set REDIS_URL (same as sessions) so they survive refresh and deploys.'
          : null,
      userData,
    });
  } catch (e) {
    console.error('[demoScenario] GET', e);
    res.status(500).json({ error: 'demo_scenario_failed', message: e.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const { accounts: bodyAccounts, userData } = req.body || {};
    const uid = req.user.id;
    const staleAccountIds = [];

    if (Object.hasOwn(req.body, 'stepUpAmountThreshold')) {
      const raw = req.body.stepUpAmountThreshold;
      if (raw === null || raw === '') {
        await demoScenarioStore.save(uid, { stepUpAmountThreshold: null });
      } else {
        const n = parseFloat(raw);
        if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
          return res.status(400).json({ error: 'invalid_threshold', message: 'Threshold must be between 0 and 1,000,000.' });
        }
        await demoScenarioStore.save(uid, { stepUpAmountThreshold: n });
      }
    }

    if (Object.hasOwn(req.body, 'bankingAgentUiMode')) {
      const raw = req.body.bankingAgentUiMode;
      if (raw === null || raw === '') {
        await demoScenarioStore.save(uid, { bankingAgentUiMode: null });
      } else if (raw === 'embedded' || raw === 'floating' || raw === 'both') {
        await demoScenarioStore.save(uid, { bankingAgentUiMode: raw });
      } else {
        return res.status(400).json({
          error: 'invalid_banking_agent_ui_mode',
          message: 'bankingAgentUiMode must be embedded, floating, both, or null.',
        });
      }
    }

    if (Object.hasOwn(req.body, 'bankingAgentUi')) {
      const raw = req.body.bankingAgentUi;
      if (raw === null || raw === '') {
        await demoScenarioStore.save(uid, { bankingAgentUi: null });
      } else {
        const ui = normalizeBankingAgentUi(raw);
        if (!ui) {
          return res.status(400).json({
            error: 'invalid_banking_agent_ui',
            message: 'bankingAgentUi must be { placement: middle|bottom|none, fab: boolean } or null.',
          });
        }
        await demoScenarioStore.save(uid, {
          bankingAgentUi: ui,
          bankingAgentUiMode: legacyModeFromUi(ui),
        });
      }
    }

    if (Array.isArray(bodyAccounts)) {
      const maxAccounts = 24;
      const existingForUser = dataStore.getAccountsByUserId(uid);
      const newRowCount = bodyAccounts.filter(
        r => r && typeof r === 'object' && !isExistingAccountId(r.id),
      ).length;
      if (existingForUser.length + newRowCount > maxAccounts) {
        return res.status(400).json({
          error: 'max_accounts',
          message: `You can have at most ${maxAccounts} accounts.`,
        });
      }

      for (const row of bodyAccounts) {
        if (!row || typeof row !== 'object') continue;

        if (!isExistingAccountId(row.id)) {
          // New account — but first check if one already exists for this type (upsert by type).
          const accountType = normalizeDemoAccountType(row.accountType);
          const existingOfType = existingForUser.find(a => a.accountType === accountType);
          if (existingOfType) {
            // Treat as an update of the existing account instead of creating a duplicate.
            const updates = {};
            if (typeof row.name === 'string') updates.name = row.name.trim().slice(0, 120);
            if (row.balance !== undefined && row.balance !== null) {
              const b = parseFloat(row.balance);
              if (!Number.isFinite(b) || b < 0 || b > 99_999_999) {
                return res.status(400).json({ error: 'invalid_balance', message: 'Balance must be a valid non-negative number.' });
              }
              updates.balance = roundToCents(b);
            }
            if (Object.keys(updates).length > 0) {
              await dataStore.updateAccount(existingOfType.id, updates);
            }
            continue;
          }
          // No existing account for this type — create it.
          let name = typeof row.name === 'string' ? row.name.trim().slice(0, 120) : '';
          if (!name) {
            name = DEMO_DEFAULT_ACCOUNT_NAMES[accountType] || 'Account';
          }
          let balance = 0;
          if (row.balance !== undefined && row.balance !== null && row.balance !== '') {
            const b = parseFloat(row.balance);
            if (!Number.isFinite(b) || b < 0 || b > 99_999_999) {
              return res.status(400).json({ error: 'invalid_balance', message: 'Balance must be a valid non-negative number.' });
            }
            balance = roundToCents(b);
          }
          const newId = uuidv4();
          const numSuffix = newId.replace(/-/g, '').slice(0, 12).toUpperCase();
          const acctNumPrefix = DEMO_ACCOUNT_NUMBER_PREFIX[accountType] || 'ACC';
          await dataStore.createAccount({
            id: newId,
            userId: uid,
            accountNumber: `${acctNumPrefix}-${numSuffix}`,
            accountType,
            balance,
            currency: 'USD',
            name,
            createdAt: new Date(),
            isActive: true,
          });
          continue;
        }

        const acct = dataStore.getAccountById(row.id);
        if (!acct) {
          // Stale ID (serverless instance rotation) — skip the update but keep going so
          // new accounts in the same save are still created.
          staleAccountIds.push(row.id);
          continue;
        }
        if (acct.userId !== uid) {
          return res.status(403).json({ error: 'forbidden_account', message: 'You can only edit your own accounts.' });
        }
        const updates = {};
        if (Object.hasOwn(row, 'name')) {
          if (typeof row.name === 'string') {
            updates.name = row.name.trim().slice(0, 120);
          }
        }
        if (row.balance !== undefined && row.balance !== null) {
          const b = parseFloat(row.balance);
          if (!Number.isFinite(b) || b < 0 || b > 99_999_999) {
            return res.status(400).json({ error: 'invalid_balance', message: 'Balance must be a valid non-negative number.' });
          }
          updates.balance = roundToCents(b);
        }
        if (Object.keys(updates).length > 0) {
          await dataStore.updateAccount(row.id, updates);
        }
      }
      // Stale IDs are skipped (not an error) but surfaced in the response so the UI
      // can show a soft warning without discarding the user's just-created accounts.
      if (staleAccountIds.length > 0) {
        console.warn(`[demoScenario] PUT: ${staleAccountIds.length} stale account IDs skipped for user ${uid}:`, staleAccountIds);
      }
    }

    if (Object.hasOwn(req.body, 'accountProfileFields')) {
      const rawProf = req.body.accountProfileFields;
      if (rawProf === null) {
        await demoScenarioStore.save(uid, { accountProfileFields: null });
      } else if (rawProf && typeof rawProf === 'object' && !Array.isArray(rawProf)) {
        await demoScenarioStore.save(uid, { accountProfileFields: rawProf });
      }
    }

    if (Object.hasOwn(req.body, 'accountProfileFields')) {
      const rawProf = req.body.accountProfileFields;
      if (rawProf === null) {
        await demoScenarioStore.save(uid, { accountProfileFields: null });
      } else if (rawProf && typeof rawProf === 'object' && !Array.isArray(rawProf)) {
        await demoScenarioStore.save(uid, { accountProfileFields: rawProf });
      }
    }

    if (Object.hasOwn(req.body, 'userData')) {
      let user = dataStore.getUserById(uid);
      if (!user) {
        const su = req.session?.user || {};
        const tu = req.user || {};
        user = await dataStore.ensureUser(uid, {
          username: su.username || tu.username,
          email: su.email || tu.email,
          firstName: su.firstName || tu.firstName,
          lastName: su.lastName || tu.lastName,
          role: su.role || tu.role,
          oauthProvider: su.oauthProvider,
          oauthId: su.oauthId || tu.oauthSub || null,
          isActive: su.isActive !== false && tu.isActive !== false,
        });
      }
      if (!user) {
        return res.status(404).json({ error: 'user_not_found', message: 'Signed-in user not found.' });
      }
      const safeUpdates = sanitizeUserUpdates(userData);
      if (Object.keys(safeUpdates).length > 0) {
        await dataStore.updateUser(uid, safeUpdates);
      }
    }

    const accounts = dataStore.getAccountsByUserId(uid);
    // Persist account snapshot to Redis/KV so cold-start restarts (Vercel, etc.) can recover all accounts.
    await saveAccountSnapshot(uid);
    const scenario = await demoScenarioStore.load(uid);
    const currentUser = dataStore.getUserById(uid) || {};
    const { password: _password, ...savedUserData } = currentUser;
    const bankingAgentUiOut = effectiveBankingAgentUi(scenario);
    const bankingAgentUiModeOut = legacyModeFromUi(bankingAgentUiOut);
    res.json({
      ok: true,
      staleAccountIds: staleAccountIds?.length ? staleAccountIds : undefined,
      accounts: accounts.map(a => ({
        id: a.id,
        name: a.name || '',
        accountNumber: a.accountNumber,
        accountType: a.accountType,
        balance: a.balance,
        currency: a.currency || 'USD',
      })),
      settings: {
        stepUpAmountThreshold:
          scenario.stepUpAmountThreshold != null ? scenario.stepUpAmountThreshold : DEFAULT_STEP_UP(),
        bankingAgentUiMode: bankingAgentUiModeOut,
        bankingAgentUi: bankingAgentUiOut,
      },
      userData: savedUserData,
    });
  } catch (e) {
    console.error('[demoScenario] PUT', e);
    res.status(500).json({ error: 'demo_scenario_save_failed', message: e.message });
  }
});

module.exports = router;

/**
 * Internal helper for /api/demo/claim-diagnostics below. No longer mounted as a
 * public endpoint (the may_act demo controls were removed).
 *
 * Checks two things that must both be true for `may_act` to appear in the Subject Token:
 *   1. The signed-in user's `mayAct` custom attribute in PingOne.
 *   2. The `Super Banking User` OIDC app's attribute mappings — does a `may_act` mapping exist?
 *
 * Returns a structured report so the diagnostics endpoint can show exactly what is missing.
 */
async function diagnoseMayAct(req, res) {
  const pingOneUserId = req.user?.id;
  if (!pingOneUserId) {
    return res.status(401).json({ error: 'unauthenticated', message: 'No user session' });
  }

  const envId      = configStore.getEffective('pingone_environment_id');
  const region     = configStore.getEffective('pingone_region') || 'com';
  const bffClientId = configStore.getEffective('admin_client_id');
  const userAppClientId = configStore.getEffective('pingone_core_user_client_id') ||
                          configStore.getEffective('admin_client_id'); // fallback

  if (!envId) {
    return res.status(503).json({ error: 'not_configured', message: 'pingone_environment_id not set' });
  }

  let token;
  try {
    token = await getManagementToken();
  } catch (err) {
    return res.status(503).json({ error: 'management_token_failed', message: err.message });
  }

  const base = `https://api.pingone.${region}/v1/environments/${envId}`;
  const report = {
    userId: pingOneUserId,
    bffClientId,
    checks: {
      userAttribute: { label: 'mayAct on user record', pass: false, value: null, detail: null },
      appMapping:    { label: 'may_act mapping on Super Banking User app', pass: false, value: null, detail: null },
    },
    diagnosis: [],
    nextStep: null,
  };

  // ── Check 1: user's mayAct attribute ────────────────────────────────────────
  try {
    const userRes = await axios.get(`${base}/users/${pingOneUserId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    const mayAct = userRes.data?.mayAct ?? null;
    report.checks.userAttribute.value = mayAct;
    if (mayAct && mayAct.sub) {
      report.checks.userAttribute.pass = true;
      report.checks.userAttribute.detail = `mayAct.sub = "${mayAct.sub}"`;
      if (mayAct.sub !== bffClientId) {
        report.checks.userAttribute.pass = false;
        report.checks.userAttribute.detail = `mayAct.sub "${mayAct.sub}" does NOT match BFF client ID "${bffClientId}"`;
      }
    } else {
      report.checks.userAttribute.detail = 'mayAct attribute is null or missing on this user record';
    }
  } catch (err) {
    const n = normalizeAxiosError(err, { label: 'PingOne diagnostic' });
    report.checks.userAttribute.detail = `PingOne user GET failed: ${n.message}`;
  }

  // ── Check 2: Super Banking User app attribute mappings ─────────────────────────
  // Find the app by client_id = userAppClientId, then check its attribute mappings
  try {
    // List OIDC apps, find the one matching userAppClientId
    const appsRes = await axios.get(`${base}/applications?limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    const apps = appsRes.data?._embedded?.applications || [];
    const userApp = apps.find(a => a.protocol === 'OPENID_CONNECT' && a.oidcOptions?.clientId === userAppClientId);

    if (!userApp) {
      report.checks.appMapping.detail = `Could not find OIDC app with clientId "${userAppClientId}" — check PINGONE_CORE_USER_CLIENT_ID config`;
    } else {
      report.checks.appMapping.value = { appId: userApp.id, appName: userApp.name };
      // Fetch attribute mappings for this app
      const mappingsRes = await axios.get(`${base}/applications/${userApp.id}/attributes`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      });
      const mappings = mappingsRes.data?._embedded?.attributes || [];
      const mayActMapping = mappings.find(m => m.name === 'may_act');
      if (mayActMapping) {
        report.checks.appMapping.pass = true;
        report.checks.appMapping.value = { appId: userApp.id, appName: userApp.name, mapping: mayActMapping };
        report.checks.appMapping.detail = `Mapping found: expression = "${mayActMapping.value}"`;
      } else {
        report.checks.appMapping.detail = `No "may_act" attribute mapping on app "${userApp.name}" (id: ${userApp.id})`;
      }
    }
  } catch (err) {
    const n = normalizeAxiosError(err, { label: 'PingOne diagnostic' });
    report.checks.appMapping.detail = `PingOne app/mappings GET failed: ${n.message}`;
  }

  // ── Build diagnosis ──────────────────────────────────────────────────────────
  if (!report.checks.userAttribute.pass) {
    report.diagnosis.push('❌ User attribute: mayAct is not set (or wrong value) on this user record.');
  } else {
    report.diagnosis.push('✅ User attribute: mayAct is set correctly on this user record.');
  }
  if (!report.checks.appMapping.pass) {
    report.diagnosis.push('❌ App mapping: no may_act attribute mapping found on Super Banking User app.');
  } else {
    report.diagnosis.push('✅ App mapping: may_act attribute mapping exists on Super Banking User app.');
  }

  if (!report.checks.userAttribute.pass && !report.checks.appMapping.pass) {
    report.nextStep = 'Fix both: (1) Click "Authorize agent" on the Delegation page (/delegation) to set the user attribute. (2) Add the may_act mapping to the Super Banking User app in PingOne Console → Applications → Super Banking User → Attribute Mappings tab. Then re-login for a fresh token.';
  } else if (!report.checks.userAttribute.pass) {
    report.nextStep = 'Click "Authorize agent" on the Delegation page (/delegation) (or use the Postman "Utility — Set mayAct" request). Then sign out and back in for a fresh token.';
  } else if (!report.checks.appMapping.pass) {
    report.nextStep = 'Add the may_act attribute mapping to the Super Banking User app in PingOne Console → Applications → Super Banking User → Attribute Mappings tab. Expression: (#root.user.mayAct != null ? #root.user.mayAct : null). Then re-login.';
  } else {
    report.nextStep = 'Both checks pass. Sign out and back in to get a fresh Subject Token — may_act should now appear.';
  }

  return res.json(report);
}

// ── Demo Account Management (Persistent Storage) ───────────────────────────────

const { getDemoAccounts, createDemoAccount, deleteDemoAccount, getBackendInfo } = require('../services/demoDataService');

// GET /api/demo/accounts — list demo accounts for user
router.get('/accounts', authenticateToken, async (req, res) => {
  try {
    const accounts = await getDemoAccounts(req.user.id);
    const backendInfo = getBackendInfo();
    
    res.json({ 
      accounts,
      backend: backendInfo.backend,
      accountCount: accounts.length,
      lastMigration: new Date().toISOString()
    });
  } catch (err) {
    console.error('[demo] GET accounts error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// POST /api/demo/account — create new demo account
router.post('/account', authenticateToken, async (req, res) => {
  try {
    const { accountType, accountNumber, routingNumber, balance, currency = 'USD', status = 'active' } = req.body || {};
    
    // Validate required fields
    if (!accountType || !accountNumber || !routingNumber || balance === undefined) {
      return res.status(400).json({ error: 'validation_error', message: 'Missing required fields' });
    }
    
    const account = await createDemoAccount({
      userId: req.user.id,
      accountType,
      accountNumber,
      routingNumber,
      balance: parseFloat(balance),
      currency,
      status
    });
    
    res.status(201).json({ account });
  } catch (err) {
    console.error('[demo] POST account error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// DELETE /api/demo/account/:id — delete demo account
router.delete('/account/:id', authenticateToken, async (req, res) => {
  try {
    const result = await deleteDemoAccount(req.params.id, req.user.id);
    if (!result.ok) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[demo] DELETE account error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Token endpoint auth method (Phase 110) ──────────────────────────────────
const VALID_TOKEN_AUTH_METHODS = new Set(['client_secret_basic', 'client_secret_post', 'client_secret_jwt', '', null]);

// GET /api/demo-scenario/token-endpoint-auth
router.get('/token-endpoint-auth', async (req, res) => {
  res.json({
    ai_agent_token_endpoint_auth_method:      configStore.get('ai_agent_token_endpoint_auth_method') || '',
    mcp_exchanger_token_endpoint_auth_method: configStore.get('mcp_exchanger_token_endpoint_auth_method') || '',
  });
});

// PATCH /api/demo-scenario/token-endpoint-auth
router.patch('/token-endpoint-auth', async (req, res) => {
  const { ai_agent_token_endpoint_auth_method: ai, mcp_exchanger_token_endpoint_auth_method: mcp } = req.body || {};
  if ((ai !== undefined && !VALID_TOKEN_AUTH_METHODS.has(ai)) ||
      (mcp !== undefined && !VALID_TOKEN_AUTH_METHODS.has(mcp))) {
    return res.status(400).json({ error: 'invalid_value', message: 'Auth method must be client_secret_basic, client_secret_post, client_secret_jwt, or empty string.' });
  }
  try {
    const patch = {};
    if (ai !== undefined)  patch.ai_agent_token_endpoint_auth_method = ai || '';
    if (mcp !== undefined) patch.mcp_exchanger_token_endpoint_auth_method = mcp || '';
    await configStore.setConfig(patch);
    res.json({ ok: true });
  } catch (err) {
    console.error('[demo] PATCH token-endpoint-auth error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Claim & Scope Compliance Diagnostics (Phase 261, Wave 6) ─────────────────
//
// GET /api/demo/claim-diagnostics
//
// Aggregates the existing may_act diagnose logic with a session token
// scope/audience check.  Diagnostic only — does NOT make auth decisions.
//
router.get('/claim-diagnostics', authenticateToken, async (req, res) => {
  // ── May-act diagnose (reuse existing function via fake res wrapper) ─────────
  let mayActResult;
  try {
    await new Promise((resolve) => {
      const fakeRes = {
        status: (code) => ({ json: (body) => { mayActResult = { _status: code, ...body }; resolve(); } }),
        json: (body) => { mayActResult = body; resolve(); },
      };
      diagnoseMayAct(req, fakeRes).catch(err => {
        mayActResult = { error: 'diagnostic_failed', message: err.message };
        resolve();
      });
    });
  } catch (err) {
    return res.status(503).json({ error: 'diagnostic_unavailable', message: err.message });
  }

  // ── Session token scope/audience check (diagnostic only — NOT an auth decision) ──
  const sessionToken = req.session?.userAccessToken || req.session?.accessToken || null;
  let sessionTokenCheck = { present: false, scopes: [], audience: null };
  if (sessionToken) {
    try {
      const parts = sessionToken.split('.');
      const payload = parts[1] ? JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) : {};
      const scopeStr = payload.scope || payload.scp || '';
      sessionTokenCheck = {
        present: true,
        scopes: typeof scopeStr === 'string' ? scopeStr.split(' ').filter(Boolean)
                : Array.isArray(scopeStr) ? scopeStr : [],
        audience: payload.aud || null,
      };
    } catch { /* non-fatal — token may not be a JWT */ }
  }

  const mayActPass  = mayActResult?.checks?.userAttribute?.pass && mayActResult?.checks?.appMapping?.pass;
  const overallPass = !!(mayActPass && sessionTokenCheck.present);

  return res.json({
    timestamp: new Date().toISOString(),
    checks: {
      mayAct:       mayActResult?.checks?.userAttribute  || { pass: false, detail: 'unavailable' },
      appMapping:   mayActResult?.checks?.appMapping     || { pass: false, detail: 'unavailable' },
      sessionToken: sessionTokenCheck,
    },
    diagnosis: mayActResult?.diagnosis || [],
    nextStep:  mayActResult?.nextStep  || '',
    overallPass,
  });
});

