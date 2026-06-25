// demo_api_server/data/bankingAccountSpecs.js
/**
 * Single source of truth for the banking demo's 4-account set.
 *
 * Both the dashboard provisioning (routes/accounts.js) and the agent's in-process
 * MCP tools (services/mcpLocalTools.js) build accounts from these specs, so the
 * deterministic IDs / account numbers / IBANs / balances can never drift between
 * the two paths (they used to: the agent path seeded checking/savings at
 * 3000/2000 while the dashboard used 5000/5000 — see PR history).
 *
 * The deterministic derivation (buildBankingAccount) must keep producing the same
 * `${idPrefix}-${uid}` IDs and account numbers as before, because already-provisioned
 * users are matched by ID — changing the formula would orphan existing accounts.
 */
'use strict';

const SWIFT_CODE = 'CHASUS33';
const BRANCH_NAME = 'Super Banking Main Branch';
const BRANCH_CODE = '001';
const CREATED_AT = '2024-01-15';

// Order matters: ibanOffset is assigned per entry and the array order is the
// canonical provisioning order (checking, savings, loan, credit card).
const BANKING_ACCOUNT_SPECS = [
  { idPrefix: 'chk',  numberPrefix: '01', ibanOffset: 0, accountType: 'checking',    balance:   5000.00, name: 'Checking Account', routingNumber: '026073150', openedDate: '2022-01-15' },
  { idPrefix: 'sav',  numberPrefix: '02', ibanOffset: 1, accountType: 'savings',     balance:   5000.00, name: 'Savings Account',  routingNumber: '021000021', openedDate: '2022-03-10' },
  { idPrefix: 'loan', numberPrefix: '03', ibanOffset: 2, accountType: 'loan',        balance: -12000.00, name: 'Car Loan',        routingNumber: '026073150', openedDate: '2023-06-01' },
  { idPrefix: 'cc',   numberPrefix: '04', ibanOffset: 3, accountType: 'credit_card', balance:  -1850.00, name: 'Credit Card',     routingNumber: '026073150', openedDate: '2023-09-01' },
];

// Lookup by accountType (e.g. SPEC_BY_TYPE.loan, SPEC_BY_TYPE.credit_card).
const SPEC_BY_TYPE = Object.fromEntries(BANKING_ACCOUNT_SPECS.map((s) => [s.accountType, s]));

/**
 * Deterministic uid-derived numbers, identical to the formula both call sites
 * used inline before consolidation. Internal helper for buildBankingAccount.
 */
function deriveAccountKeys(userId) {
  const uid = String(userId).replace(/-/g, '').slice(0, 10);
  const digits = uid.replace(/[^0-9a-f]/gi, '').slice(0, 10) || '0';
  const acctN = parseInt(digits, 16) % 9999999999;
  const ibanBase = parseInt(uid.replace(/[^0-9a-f]/gi, '').slice(0, 8) || '0', 16);
  return { uid, acctN, ibanBase };
}

/**
 * Build the dataStore.createAccount payload for one spec + user. Deterministic:
 * the same (userId, spec) always yields the same id / accountNumber / iban.
 */
function buildBankingAccount(userId, spec) {
  const { uid, acctN, ibanBase } = deriveAccountKeys(userId);
  const accountNumberFull = spec.numberPrefix + String(acctN).padStart(10, '0');
  const ibanSfx = String((ibanBase + spec.ibanOffset) % 100000000).padStart(8, '0');
  return {
    id: `${spec.idPrefix}-${uid}`,
    userId,
    accountNumberFull,
    accountNumber: `****${accountNumberFull.slice(-4)}`,
    accountType: spec.accountType,
    balance: spec.balance,
    currency: 'USD',
    name: spec.name,
    routingNumber: spec.routingNumber,
    swiftCode: SWIFT_CODE,
    iban: `US12CHAS${ibanSfx}`,
    branchName: BRANCH_NAME,
    branchCode: BRANCH_CODE,
    openedDate: spec.openedDate,
    accountHolderName: '',
    createdAt: new Date(CREATED_AT),
  };
}

module.exports = { BANKING_ACCOUNT_SPECS, SPEC_BY_TYPE, buildBankingAccount };
