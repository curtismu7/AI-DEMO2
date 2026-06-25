'use strict';

const path = require('path');
const fs = require('fs');

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));

/**
 * Per-vertical workforce data store — pto, benefits, expenses — keyed by userId,
 * NOT relabeled banking accounts. Deep clone per user.
 */
function createWorkforceStore() {
  const byUser = new Map();
  function get(userId) {
    if (!byUser.has(userId)) byUser.set(userId, structuredClone(SEED));
    return byUser.get(userId);
  }
  let seq = 0;
  function submitExpense(userId, { category, amount }) {
    const data = get(userId);
    seq += 1;
    const exp = { id: `exp-new-${seq}`, category, amount, status: 'Submitted', submittedDate: '2026-05-31', description: category };
    data.expenses.push(exp);
    return exp;
  }
  function requestTimeOff(userId, { days }) {
    const data = get(userId);
    if (data.pto.balance < days) return { error: `insufficient PTO: ${data.pto.balance} day(s) available` };
    data.pto.balance -= days;
    return { days, remaining: data.pto.balance };
  }

  // Admin back-office write actions. Each resolves an item by id in the user's
  // store, mutates its status, and returns the item (or null when not found).
  // A pending expense is anything not already Approved/Denied/Reimbursed.
  function approveExpense(userId, expenseId) {
    const e = (get(userId).expenses || []).find((x) => String(x.id) === String(expenseId));
    if (!e || ['Approved', 'Denied', 'Reimbursed'].includes(e.status)) return null;
    e.status = 'Approved';
    return e;
  }
  function denyExpense(userId, expenseId) {
    const e = (get(userId).expenses || []).find((x) => String(x.id) === String(expenseId));
    if (!e || ['Approved', 'Denied', 'Reimbursed'].includes(e.status)) return null;
    e.status = 'Denied';
    return e;
  }
  function resolveTicket(userId, ticketId) {
    const t = (get(userId).tickets || []).find((x) => String(x.id) === String(ticketId));
    if (!t || t.status === 'Resolved' || t.status === 'Closed') return null;
    t.status = 'Resolved';
    return t;
  }
  function completeTraining(userId, trainingId) {
    const tr = (get(userId).trainings || []).find((x) => String(x.id) === String(trainingId));
    if (!tr || tr.status === 'Completed') return null;
    tr.status = 'Completed';
    return tr;
  }

  return { get, submitExpense, requestTimeOff, approveExpense, denyExpense, resolveTicket, completeTraining };
}

module.exports = { createWorkforceStore };
