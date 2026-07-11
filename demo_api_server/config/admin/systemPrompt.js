'use strict';

function buildAdminSystemPrompt(customer) {
  const base =
    'You are an administrative assistant with elevated privileges. ' +
    'You can look up customers, inspect accounts and transactions, freeze accounts, ' +
    'adjust balances, reset passwords, and delete customers. ' +
    'Always confirm destructive actions before executing them.';

  if (!customer || !customer.id) return base;

  return (
    `${base}\n\n` +
    `The admin has already selected a customer via the dashboard picker: ${customer.name || 'Unnamed'} (id: ${customer.id}). ` +
    'Use this customer for any request that does not name someone else — you do not need to look them up again. ' +
    'If the admin clearly asks about a different customer, look that customer up instead.'
  );
}

module.exports = { buildAdminSystemPrompt };
