// Per-vertical operator console config. Pure data + lookup adapters that
// normalize each vertical's lookup response into { customer, categories }.

export const VERTICAL_ORDER = ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce'];

const money = (n) => (typeof n === 'number' ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : n);

// Map a status string to a badge tone.
function toneFor(status) {
  const s = String(status || '').toLowerCase();
  if (/(cancel|denied|unpaid|overdue|review|pending|refill needed|open|out)/.test(s)) return 'warn';
  if (/(active|scheduled|posted|paid|done|delivered|approved|released|resolved|completed)/.test(s)) return 'ok';
  return 'muted';
}

// Build a category from a slice array using a per-row mapper.
function category(id, label, icon, rows, mapRow) {
  const list = Array.isArray(rows) ? rows : [];
  return { id, label, icon, rows: list.map(mapRow) };
}

// ---- Healthcare-style adapter (user + data slices) ----
function userCentric(sliceDefs) {
  return (resp) => {
    if (!resp || !resp.user) return { customer: null, categories: [] };
    const u = resp.user;
    const data = resp.data || {};
    return {
      customer: {
        name: u.name || u.username,
        sub: `ID ${u.id}${u.email ? ' · ' + u.email : ''}`,
        avatar: (u.name || u.username || '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(),
        stats: sliceDefs.map((d) => [d.label, String((data[d.slice] || []).length)]),
      },
      categories: sliceDefs.map((d) =>
        category(d.id, d.label, d.icon, data[d.slice], (r) => ({
          id: r.id,
          title: d.title(r),
          sub: d.sub(r),
          status: r.status || '—',
          tone: toneFor(r.status),
          actions: d.actions,
        }))
      ),
    };
  };
}

export const CONFIGS = {
  banking: {
    id: 'banking', name: 'Banking Ops', short: 'Banking', icon: '🏦',
    theme: { accent: '#2563eb', accent2: '#1e3a8a', tint: '#eef4ff' },
    lookupPath: '/api/admin/banking/lookup',
    lookupPlaceholder: 'Look up account by number or holder…',
    actions: {
      'Seed charge': { method: 'post', buildUrl: (row) => `/api/admin/banking/accounts/${encodeURIComponent(row.id)}/seed-charges` },
      'Delete': { method: 'delete', buildUrl: (row, _c, catId) => catId === 'transactions' ? `/api/transactions/${encodeURIComponent(row.id)}` : `/api/accounts/${encodeURIComponent(row.id)}` },
    },
    adaptLookup: (resp) => {
      const accounts = (resp && resp.accounts) || [];
      const txns = (resp && resp.transactions) || [];
      const total = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
      return {
        customer: accounts.length ? {
          name: accounts[0].holderName || 'Account holder',
          sub: `${accounts.length} account(s)`,
          avatar: 'AC',
          stats: [['Total balance', money(total)], ['Accounts', String(accounts.length)], ['Txns', String(txns.length)]],
        } : null,
        categories: [
          category('accounts', 'Accounts', '💳', accounts, (a) => ({ id: a.id, title: `${a.type || 'Account'} · ${a.accountNumber}`, sub: `Balance ${money(Number(a.balance))}`, status: a.status || 'Active', tone: toneFor(a.status || 'Active'), actions: ['Seed charge', 'Delete'] })),
          category('transactions', 'Transactions', '🔁', txns, (t) => ({ id: t.id, title: t.description || t.type || 'Transaction', sub: `${t._accountNumber || ''} · ${money(Number(t.amount))}`, status: t.status || 'Posted', tone: toneFor(t.status), actions: ['Delete'] })),
        ],
      };
    },
  },
  healthcare: {
    id: 'healthcare', name: 'Healthcare Ops', short: 'Healthcare', icon: '🩺',
    theme: { accent: '#0d9488', accent2: '#115e59', tint: '#ecfdf9' },
    lookupPath: '/api/admin/healthcare/lookup',
    lookupPlaceholder: 'Look up a patient by name, email, or id…',
    actions: {
      'Cancel': { method: 'post', buildUrl: (row, _c, catId) => `/api/admin/healthcare/${catId === 'referrals' ? 'referrals' : 'appointments'}/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Pay bill': { method: 'post', buildUrl: (row) => `/api/admin/healthcare/bills/${encodeURIComponent(row.id)}/pay`, body: (_r, c) => ({ userId: c.id }) },
      'Refill': { method: 'post', buildUrl: (row) => `/api/admin/healthcare/medications/${encodeURIComponent(row.id)}/refill`, body: (_r, c) => ({ userId: c.id }) },
      'Release': { method: 'post', buildUrl: (row) => `/api/admin/healthcare/records/${encodeURIComponent(row.id)}/release`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'appointments', slice: 'appointments', label: 'Appointments', icon: '📅', title: (r) => r.reason || 'Appointment', sub: (r) => `${r.date || ''} · ${r.provider || ''}`, actions: ['Cancel'] },
      { id: 'medications', slice: 'medications', label: 'Medications', icon: '💊', title: (r) => r.name || 'Medication', sub: (r) => `${r.dosage || ''} · ${r.frequency || ''}`, actions: ['Refill'] },
      { id: 'billing', slice: 'billingHistory', label: 'Billing', icon: '🧾', title: (r) => r.description || 'Bill', sub: (r) => money(Number(r.amount)), actions: ['Pay bill'] },
      { id: 'records', slice: 'patientRecords', label: 'Records', icon: '📁', title: (r) => r.type || 'Record', sub: (r) => r.provider || '', actions: ['Release'] },
      { id: 'referrals', slice: 'referrals', label: 'Referrals', icon: '➡️', title: (r) => r.specialty || 'Referral', sub: (r) => r.provider || '', actions: ['Cancel'] },
    ]),
  },
  retail: {
    id: 'retail', name: 'Retail Ops', short: 'Retail', icon: '🛍️',
    theme: { accent: '#ea580c', accent2: '#9a3412', tint: '#fff3ec' },
    lookupPath: '/api/admin/retail/lookup',
    lookupPlaceholder: 'Look up a shopper by name, email, or id…',
    actions: {
      'Cancel order': { method: 'post', buildUrl: (row) => `/api/admin/retail/orders/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Cancel sub': { method: 'post', buildUrl: (row) => `/api/admin/retail/subscriptions/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Resolve': { method: 'post', buildUrl: (row) => `/api/admin/retail/tickets/${encodeURIComponent(row.id)}/resolve`, body: (_r, c) => ({ userId: c.id }) },
      'Approve': { method: 'post', buildUrl: (row) => `/api/admin/retail/returns/${encodeURIComponent(row.id)}/approve`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'orders', slice: 'orders', label: 'Orders', icon: '📦', title: (r) => r.summary || `Order ${r.id}`, sub: (r) => money(Number(r.total)), actions: ['Cancel order'] },
      { id: 'returns', slice: 'returns', label: 'Returns', icon: '↩️', title: (r) => r.reason || `Return ${r.id}`, sub: (r) => money(Number(r.amount)), actions: ['Approve'] },
      { id: 'subscriptions', slice: 'subscriptions', label: 'Subscriptions', icon: '🔄', title: (r) => r.plan || 'Subscription', sub: (r) => r.cadence || '', actions: ['Cancel sub'] },
      { id: 'support_tickets', slice: 'support_tickets', label: 'Support', icon: '🎧', title: (r) => r.subject || 'Ticket', sub: (r) => r.opened || '', actions: ['Resolve'] },
      { id: 'rewards', slice: 'rewards', label: 'Rewards', icon: '⭐', title: (r) => r.tier || 'Rewards', sub: (r) => `${r.points || 0} pts`, actions: [] },
    ]),
  },
  'sporting-goods': {
    id: 'sporting-goods', name: 'Sporting Goods Ops', short: 'Sporting', icon: '🏅',
    theme: { accent: '#16a34a', accent2: '#14532d', tint: '#edfcef' },
    lookupPath: '/api/admin/sporting-goods/lookup',
    lookupPlaceholder: 'Look up a member by name, email, or id…',
    actions: {
      'Cancel order': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/orders/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Return': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/rentals/${encodeURIComponent(row.id)}/return`, body: (_r, c) => ({ userId: c.id }) },
      'Resolve': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/tickets/${encodeURIComponent(row.id)}/resolve`, body: (_r, c) => ({ userId: c.id }) },
      'Cancel coaching': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/coaching/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'orders', slice: 'orders', label: 'Orders', icon: '📦', title: (r) => r.summary || `Order ${r.id}`, sub: (r) => money(Number(r.total)), actions: ['Cancel order'] },
      { id: 'rentals', slice: 'rentals', label: 'Rentals', icon: '🎿', title: (r) => r.item || 'Rental', sub: (r) => r.dueBack || '', actions: ['Return'] },
      { id: 'coaching_sessions', slice: 'coaching_sessions', label: 'Coaching', icon: '🏃', title: (r) => r.title || 'Session', sub: (r) => r.when || '', actions: ['Cancel coaching'] },
      { id: 'support_tickets', slice: 'support_tickets', label: 'Support', icon: '🎧', title: (r) => r.subject || 'Ticket', sub: (r) => r.opened || '', actions: ['Resolve'] },
      { id: 'loyalty', slice: 'loyalty', label: 'Loyalty', icon: '⭐', title: (r) => r.tier || 'Loyalty', sub: (r) => `${r.points || 0} pts`, actions: [] },
    ]),
  },
  workforce: {
    id: 'workforce', name: 'Workforce Ops', short: 'Workforce', icon: '🧑‍💼',
    theme: { accent: '#7c3aed', accent2: '#4c1d95', tint: '#f5f0ff' },
    lookupPath: '/api/admin/workforce/lookup',
    lookupPlaceholder: 'Look up an employee by name, email, or id…',
    actions: {
      'Approve': { method: 'post', buildUrl: (row) => `/api/admin/workforce/expenses/${encodeURIComponent(row.id)}/approve`, body: (_r, c) => ({ userId: c.id }) },
      'Deny': { method: 'post', buildUrl: (row) => `/api/admin/workforce/expenses/${encodeURIComponent(row.id)}/deny`, body: (_r, c) => ({ userId: c.id }) },
      'Resolve': { method: 'post', buildUrl: (row) => `/api/admin/workforce/tickets/${encodeURIComponent(row.id)}/resolve`, body: (_r, c) => ({ userId: c.id }) },
      'Complete': { method: 'post', buildUrl: (row) => `/api/admin/workforce/trainings/${encodeURIComponent(row.id)}/complete`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'expenses', slice: 'expenses', label: 'Expenses', icon: '💵', title: (r) => r.description || 'Expense', sub: (r) => money(Number(r.amount)), actions: ['Approve', 'Deny'] },
      { id: 'tickets', slice: 'tickets', label: 'IT Tickets', icon: '🛠️', title: (r) => r.subject || 'Ticket', sub: (r) => r.priority || '', actions: ['Resolve'] },
      { id: 'trainings', slice: 'trainings', label: 'Training', icon: '🎓', title: (r) => r.name || 'Training', sub: (r) => r.due || '', actions: ['Complete'] },
      { id: 'pto', slice: 'pto', label: 'PTO', icon: '🌴', title: (r) => r.kind || 'PTO', sub: (r) => r.range || '', actions: [] },
      { id: 'benefits', slice: 'benefits', label: 'Benefits', icon: '🏥', title: (r) => r.plan || 'Benefit', sub: (r) => r.status || '', actions: [] },
    ]),
  },
};

export function getVerticalConfig(id) {
  const c = CONFIGS[id];
  if (!c) throw new Error(`Unknown vertical: ${id}`);
  return c;
}
