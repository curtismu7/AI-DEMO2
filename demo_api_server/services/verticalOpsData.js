'use strict';
const dataStore = require('../data/store');

const PLUGINS = {
  healthcare: () => require('../config/verticals/healthcare'),
  retail: () => require('../config/verticals/retail'),
  'sporting-goods': () => require('../config/verticals/sporting-goods'),
  workforce: () => require('../config/verticals/workforce'),
};

// Mirror of resolveUser() in routes/adminVerticals.js — resolve a free-text
// query to a single non-admin demo user.
function resolveCustomer(q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return null;
  const users = dataStore.getAllUsers().filter((u) => u.role !== 'admin' && u.username);
  const match = users.find((u) => {
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').toLowerCase();
    return (u.username || '').toLowerCase().includes(needle)
      || (u.email || '').toLowerCase().includes(needle)
      || name.includes(needle)
      || String(u.id || '').toLowerCase() === needle;
  });
  if (!match) return null;
  return { id: String(match.id), username: match.username, name: [match.firstName, match.lastName].filter(Boolean).join(' '), email: match.email || '' };
}

function bankingContext(q) {
  const needle = String(q || '').trim().toLowerCase();
  // Guard against an empty query: `''.includes('')` is true for every account,
  // which would dump ALL customers' accounts and transactions into the prompt.
  // Mirror resolveCustomer()'s empty-needle early return.
  if (!needle) return { customer: null, records: null };
  const digits = needle.replace(/\D/g, '');
  const accounts = dataStore.getAllAccounts().filter((a) => {
    if (String(a.accountNumber).toLowerCase().includes(needle)) return true;
    if (String(a.id).toLowerCase().includes(needle)) return true;
    return digits.length > 0 && String(a.accountNumber).replace(/\D/g, '').includes(digits);
  });
  const transactions = accounts.flatMap((a) => dataStore.getTransactionsByAccountId(a.id).map((t) => ({ ...t, _accountNumber: a.accountNumber })));
  return {
    customer: accounts.length ? { id: String(accounts[0].id), username: '', name: accounts[0].holderName || 'Account holder', email: '' } : null,
    records: { accounts, transactions },
  };
}

function getCustomerContext(vertical, query) {
  if (vertical === 'banking') return bankingContext(query);
  const load = PLUGINS[vertical];
  if (!load) return { customer: null, records: null };
  const user = resolveCustomer(query);
  if (!user) return { customer: null, records: null };
  const records = load().getDataStore().get(user.id);
  return { customer: user, records };
}

module.exports = { getCustomerContext, resolveCustomer };
