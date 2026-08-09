// Per-vertical operator console config. Pure data + lookup adapters that
// normalize each vertical's lookup response into { customer, categories }.

export const VERTICAL_ORDER = ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce',
  'university', 'government', 'manufacturing', 'investment', 'abercrombie-fitch'];

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
        id: u.id,
        name: u.name || u.username,
        sub: `ID ${u.id}${u.email ? ' · ' + u.email : ''}`,
        avatar: (u.name || u.username || '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(),
        stats: sliceDefs.map((d) => [d.label, String((data[d.slice] || []).length)]),
      },
      categories: sliceDefs.map((d) =>
        category(d.id, d.label, d.icon, data[d.slice], (r) => ({
          // Some slices key on a domain field rather than `id` — investment
          // holdings carry only `symbol`, and an undefined key collides.
          id: d.rowId ? d.rowId(r) : r.id,
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
    id: 'banking', name: 'Banking Ops', short: 'Banking', icon: 'BK',
    theme: { accent: '#2563eb', accent2: '#1e3a8a', tint: '#eef4ff' },
    lookupPath: '/api/admin/banking/lookup',
    identityActions: [],
    caseSource: { path: '/api/admin/banking/cases' },
    permissions: {
      'Seed charge': { scope: 'transactions:write', gate: 'verified' },
      'Delete':      { scope: 'transactions:write', gate: 'verified' },
    },
    lookupPlaceholder: 'Look up by holder name, username, email, or account number…',
    actions: {
      'Seed charge': { method: 'post', buildUrl: (row) => `/api/admin/banking/accounts/${encodeURIComponent(row.id)}/seed-charges` },
      'Delete': { method: 'delete', buildUrl: (row, _c, catId) => catId === 'transactions' ? `/api/transactions/${encodeURIComponent(row.id)}` : `/api/accounts/${encodeURIComponent(row.id)}` },
    },
    adaptLookup: (resp) => {
      // Shares the { user, data } envelope with the other verticals. `user` is
      // the resolved holder when the query matched a demo user; it's null for a
      // bare account-number/id lookup, in which case we fall back to a generic
      // "Account holder" summary.
      const data = (resp && resp.data) || {};
      const accounts = data.accounts || [];
      const txns = data.transactions || [];
      const u = resp && resp.user;
      const total = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
      return {
        customer: (u || accounts.length) ? {
          id: u ? u.id : undefined,
          name: u ? (u.name || u.username) : 'Account holder',
          sub: u ? `ID ${u.id}${u.email ? ' · ' + u.email : ''}` : `${accounts.length} account(s)`,
          avatar: u ? (u.name || u.username || '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() : 'AC',
          stats: [['Total balance', money(total)], ['Accounts', String(accounts.length)], ['Txns', String(txns.length)]],
        } : null,
        categories: [
          category('accounts', 'Accounts', 'AC', accounts, (a) => ({ id: a.id, title: `${a.accountType || 'Account'} · ${a.accountNumber}`, sub: `Balance ${money(Number(a.balance))}`, status: a.status || 'Active', tone: toneFor(a.status || 'Active'), actions: ['Seed charge', 'Delete'] })),
          category('transactions', 'Transactions', 'TX', txns, (t) => ({ id: t.id, title: t.description || t.type || 'Transaction', sub: `${t._accountNumber || ''} · ${money(Number(t.amount))}`, status: t.status || 'Posted', tone: toneFor(t.status), actions: ['Delete'] })),
        ],
      };
    },
  },
  healthcare: {
    id: 'healthcare', name: 'Healthcare Ops', short: 'Healthcare', icon: 'HC',
    theme: { accent: '#0d9488', accent2: '#115e59', tint: '#ecfdf9' },
    lookupPath: '/api/admin/healthcare/lookup',
    identityActions: [],
    caseSource: { path: '/api/admin/healthcare/cases' },
    permissions: {
      'Cancel':   { scope: 'transactions:write', gate: 'verified' },
      'Pay bill': { scope: 'transactions:write', gate: 'verified' },
      'Refill':   { scope: 'transactions:write', gate: 'verified' },
      'Release':  { scope: 'sensitive:read',     gate: 'approval' },
    },
    lookupPlaceholder: 'Look up a patient by name, email, or id…',
    actions: {
      'Cancel': { method: 'post', buildUrl: (row, _c, catId) => `/api/admin/healthcare/${catId === 'referrals' ? 'referrals' : 'appointments'}/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Pay bill': { method: 'post', buildUrl: (row) => `/api/admin/healthcare/bills/${encodeURIComponent(row.id)}/pay`, body: (_r, c) => ({ userId: c.id }) },
      'Refill': { method: 'post', buildUrl: (row) => `/api/admin/healthcare/medications/${encodeURIComponent(row.id)}/refill`, body: (_r, c) => ({ userId: c.id }) },
      'Release': { method: 'post', buildUrl: (row) => `/api/admin/healthcare/records/${encodeURIComponent(row.id)}/release`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'appointments', slice: 'appointments', label: 'Appointments', icon: 'AP', title: (r) => r.reason || 'Appointment', sub: (r) => `${r.when || ''} · ${r.provider || ''}`, actions: ['Cancel'] },
      { id: 'medications', slice: 'medications', label: 'Medications', icon: 'RX', title: (r) => r.name || 'Medication', sub: (r) => `${r.dosage || ''} · ${r.frequency || ''}`, actions: ['Refill'] },
      { id: 'billing', slice: 'billingHistory', label: 'Billing', icon: 'BL', title: (r) => r.description || 'Bill', sub: (r) => money(Number(r.amountDue)), actions: ['Pay bill'] },
      { id: 'records', slice: 'patientRecords', label: 'Records', icon: 'RC', title: (r) => r.recordType || 'Record', sub: (r) => r.provider || '', actions: ['Release'] },
      { id: 'referrals', slice: 'referrals', label: 'Referrals', icon: 'RF', title: (r) => r.specialty || 'Referral', sub: (r) => r.toProvider || '', actions: ['Cancel'] },
    ]),
  },
  retail: {
    id: 'retail', name: 'Retail Ops', short: 'Retail', icon: 'RT',
    theme: { accent: '#ea580c', accent2: '#9a3412', tint: '#fff3ec' },
    lookupPath: '/api/admin/retail/lookup',
    identityActions: [],
    caseSource: { path: '/api/admin/retail/cases' },
    permissions: {
      'Cancel order': { scope: 'transactions:write', gate: 'verified' },
      'Cancel sub':   { scope: 'transactions:write', gate: 'verified' },
      'Resolve':      { scope: 'general:write',      gate: 'none' },
      'Approve':      { scope: 'transactions:write', gate: 'verified' },
    },
    lookupPlaceholder: 'Look up a shopper by name, email, or id…',
    actions: {
      'Cancel order': { method: 'post', buildUrl: (row) => `/api/admin/retail/orders/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Cancel sub': { method: 'post', buildUrl: (row) => `/api/admin/retail/subscriptions/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Resolve': { method: 'post', buildUrl: (row) => `/api/admin/retail/tickets/${encodeURIComponent(row.id)}/resolve`, body: (_r, c) => ({ userId: c.id }) },
      'Approve': { method: 'post', buildUrl: (row) => `/api/admin/retail/returns/${encodeURIComponent(row.id)}/approve`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'orders', slice: 'orders', label: 'Orders', icon: 'OR', title: (r) => r.product || `Order ${r.id}`, sub: (r) => money(Number(r.amount)), actions: ['Cancel order'] },
      { id: 'returns', slice: 'returns', label: 'Returns', icon: 'RN', title: (r) => r.product || `Return ${r.id}`, sub: (r) => r.reason || '', actions: ['Approve'] },
      { id: 'subscriptions', slice: 'subscriptions', label: 'Subscriptions', icon: 'SB', title: (r) => r.product || 'Subscription', sub: (r) => r.frequency || '', actions: ['Cancel sub'] },
      { id: 'support_tickets', slice: 'support_tickets', label: 'Support', icon: 'TK', title: (r) => r.subject || 'Ticket', sub: (r) => r.created_date || '', actions: ['Resolve'] },
      { id: 'rewards', slice: 'rewards', label: 'Rewards', icon: 'RW', title: (r) => r.tier || 'Rewards', sub: (r) => `${r.points || 0} pts`, actions: [] },
    ]),
  },
  'sporting-goods': {
    id: 'sporting-goods', name: 'Sporting Goods Ops', short: 'Sporting', icon: 'SG',
    theme: { accent: '#16a34a', accent2: '#14532d', tint: '#edfcef' },
    lookupPath: '/api/admin/sporting-goods/lookup',
    identityActions: [],
    caseSource: { path: '/api/admin/sporting-goods/cases' },
    permissions: {
      'Cancel order':    { scope: 'transactions:write', gate: 'verified' },
      'Return':          { scope: 'transactions:write', gate: 'verified' },
      'Resolve':         { scope: 'general:write',      gate: 'none' },
      'Cancel coaching': { scope: 'transactions:write', gate: 'verified' },
    },
    lookupPlaceholder: 'Look up a member by name, email, or id…',
    actions: {
      'Cancel order': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/orders/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Return': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/rentals/${encodeURIComponent(row.id)}/return`, body: (_r, c) => ({ userId: c.id }) },
      'Resolve': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/tickets/${encodeURIComponent(row.id)}/resolve`, body: (_r, c) => ({ userId: c.id }) },
      'Cancel coaching': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/coaching/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'orders', slice: 'orders', label: 'Orders', icon: 'OR', title: (r) => r.product || `Order ${r.id}`, sub: (r) => money(Number(r.amount)), actions: ['Cancel order'] },
      { id: 'rentals', slice: 'rentals', label: 'Rentals', icon: 'RE', title: (r) => r.item || 'Rental', sub: (r) => r.dueDate || '', actions: ['Return'] },
      { id: 'coaching_sessions', slice: 'coaching_sessions', label: 'Coaching', icon: 'CO', title: (r) => r.sport || 'Session', sub: (r) => r.date || '', actions: ['Cancel coaching'] },
      { id: 'support_tickets', slice: 'support_tickets', label: 'Support', icon: 'TK', title: (r) => r.subject || 'Ticket', sub: (r) => r.createdAt || '', actions: ['Resolve'] },
      { id: 'loyalty', slice: 'loyalty', label: 'Loyalty', icon: 'LY', title: (r) => r.tier || 'Loyalty', sub: (r) => `${r.points || 0} pts`, actions: [] },
    ]),
  },
  workforce: {
    id: 'workforce', name: 'Workforce Ops', short: 'Workforce', icon: 'WF',
    theme: { accent: '#7c3aed', accent2: '#4c1d95', tint: '#f5f0ff' },
    lookupPath: '/api/admin/workforce/lookup',
    identityActions: [],
    caseSource: { path: '/api/admin/workforce/cases' },
    permissions: {
      'Approve':  { scope: 'transactions:write', gate: 'approval' },
      'Deny':     { scope: 'transactions:write', gate: 'approval' },
      'Resolve':  { scope: 'general:write',      gate: 'none' },
      'Complete': { scope: 'general:write',      gate: 'verified' },
    },
    lookupPlaceholder: 'Look up an employee by name, email, or id…',
    actions: {
      'Approve': { method: 'post', buildUrl: (row) => `/api/admin/workforce/expenses/${encodeURIComponent(row.id)}/approve`, body: (_r, c) => ({ userId: c.id }) },
      'Deny': { method: 'post', buildUrl: (row) => `/api/admin/workforce/expenses/${encodeURIComponent(row.id)}/deny`, body: (_r, c) => ({ userId: c.id }) },
      'Resolve': { method: 'post', buildUrl: (row) => `/api/admin/workforce/tickets/${encodeURIComponent(row.id)}/resolve`, body: (_r, c) => ({ userId: c.id }) },
      'Complete': { method: 'post', buildUrl: (row) => `/api/admin/workforce/trainings/${encodeURIComponent(row.id)}/complete`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'expenses', slice: 'expenses', label: 'Expenses', icon: 'EX', title: (r) => r.description || 'Expense', sub: (r) => money(Number(r.amount)), actions: ['Approve', 'Deny'] },
      { id: 'tickets', slice: 'tickets', label: 'IT Tickets', icon: 'TK', title: (r) => r.subject || 'Ticket', sub: (r) => r.priority || '', actions: ['Resolve'] },
      { id: 'trainings', slice: 'trainings', label: 'Training', icon: 'TR', title: (r) => r.title || 'Training', sub: (r) => r.dueDate || '', actions: ['Complete'] },
      { id: 'pto', slice: 'pto', label: 'PTO', icon: 'PT', title: (r) => r.kind || 'PTO', sub: (r) => r.range || '', actions: [] },
      { id: 'benefits', slice: 'benefits', label: 'Benefits', icon: 'BN', title: (r) => r.name || 'Benefit', sub: (r) => r.enrollmentStatus || '', actions: [] },
    ]),
  },

  // ── Phase 2 verticals ──────────────────────────────────────────────────────
  // Cards are curated from each seed (university and government seed 14 slices
  // each) and only ever array-valued slices — an object slice renders nothing.
  university: {
    id: 'university', name: 'University Ops', short: 'University', icon: 'UV',
    theme: { accent: '#7c3aed', accent2: '#4c1d95', tint: '#f5f0ff' },
    lookupPath: '/api/admin/university/lookup',
    lookupPlaceholder: 'Look up a student by name, email, or id…',
    identityActions: [],
    caseSource: { path: '/api/admin/university/cases' },
    // No actions: both store mutators take an options object, not a row id, so
    // writeAction could not act on the row the operator clicked.
    permissions: {},
    actions: {},
    adaptLookup: userCentric([
      { id: 'courses', slice: 'courses', label: 'Courses', icon: 'CO', title: (r) => r.title || r.id, sub: (r) => `${r.courseType || ''} · ${r.credits || 0} cr · ${r.term || ''}`, actions: [] },
      { id: 'billing', slice: 'billing', label: 'Billing', icon: 'BL', title: (r) => r.description || 'Charge', sub: (r) => `${money(Number(r.amount))} · due ${r.dueDate || ''}`, actions: [] },
      { id: 'holds', slice: 'holds', label: 'Holds', icon: 'HD', title: (r) => `${r.holdType || 'Hold'} hold`, sub: (r) => r.reason || '', actions: [] },
      { id: 'financial_aid', slice: 'financial_aid', label: 'Financial aid', icon: 'FA', title: (r) => r.name || 'Award', sub: (r) => `${r.type || ''} · ${money(Number(r.amount))}`, actions: [] },
      { id: 'enrollmentHistory', slice: 'enrollmentHistory', label: 'Enrollment', icon: 'EN', title: (r) => r.type || 'Entry', sub: (r) => `${r.course || ''} · ${r.date || ''}`, actions: [] },
    ]),
  },

  government: {
    id: 'government', name: 'Government Ops', short: 'Government', icon: 'GV',
    theme: { accent: '#0f766e', accent2: '#134e4a', tint: '#effcfa' },
    lookupPath: '/api/admin/government/lookup',
    lookupPlaceholder: 'Look up a constituent by name, email, or id…',
    identityActions: [],
    caseSource: { path: '/api/admin/government/cases' },
    permissions: {
      // Handing over the record itself — same posture as healthcare's Release,
      // which is the other approval-gated action in the console.
      //
      // This gate is advisory: ADMIN_WRITE is
      // [requireAdmin, requireCustomerVerified] and nothing on the server
      // checks approval, so a direct POST is not stopped by it. That is a
      // deliberate call for this demo. "Needs approval" is a state the console
      // exists to teach, and every `scope` in this table is advisory in the
      // same way (`requireScopes` is not applied to these routes). Making the
      // badge enforceable would mean putting the HITL service in the request
      // path — worth doing when approval becomes part of the story, not before.
      'Release record': { scope: 'sensitive:read', gate: 'approval' },
    },
    actions: {
      'Release record': { method: 'post', buildUrl: (row) => `/api/admin/government/permits/${encodeURIComponent(row.id)}/release`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'permits', slice: 'permits', label: 'Permits', icon: 'PM', title: (r) => `${r.permitType || 'Permit'} permit`, sub: (r) => r.subject || '', actions: ['Release record'] },
      { id: 'payments', slice: 'payments', label: 'Payments', icon: 'PY', title: (r) => r.description || 'Payment', sub: (r) => `${money(Number(r.amount))} · ${r.method || ''}`, actions: [] },
      { id: 'filings', slice: 'filings', label: 'Filings', icon: 'FL', title: (r) => r.type || 'Filing', sub: (r) => `${r.permitId || ''} · ${r.date || ''}`, actions: [] },
      { id: 'inspections', slice: 'inspections', label: 'Inspections', icon: 'IN', title: (r) => r.type || 'Inspection', sub: (r) => r.address || '', actions: [] },
      { id: 'recordsRequests', slice: 'recordsRequests', label: 'Records requests', icon: 'RR', title: (r) => r.requestType || 'Request', sub: (r) => r.description || '', actions: [] },
    ]),
  },

  manufacturing: {
    id: 'manufacturing', name: 'Manufacturing Ops', short: 'Manufacturing', icon: 'MF',
    theme: { accent: '#b45309', accent2: '#78350f', tint: '#fff8ed' },
    lookupPath: '/api/admin/manufacturing/lookup',
    lookupPlaceholder: 'Look up an account by name, email, or id…',
    identityActions: [],
    caseSource: { path: '/api/admin/manufacturing/cases' },
    permissions: {
      'Release work order': { scope: 'general:write', gate: 'verified' },
    },
    actions: {
      'Release work order': { method: 'post', buildUrl: (row) => `/api/admin/manufacturing/work-orders/${encodeURIComponent(row.id)}/release`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'workOrders', slice: 'workOrders', label: 'Work orders', icon: 'WO', title: (r) => r.product || r.id, sub: (r) => `${r.type || ''} · ${r.completedQty || 0}/${r.quantity || 0}`, actions: ['Release work order'] },
      { id: 'maintenanceTickets', slice: 'maintenanceTickets', label: 'Maintenance', icon: 'MT', title: (r) => r.issue || 'Ticket', sub: (r) => `${r.machineId || ''} · ${r.priority || ''}`, actions: [] },
      { id: 'shipments', slice: 'shipments', label: 'Shipments', icon: 'SH', title: (r) => r.destination || 'Shipment', sub: (r) => `${r.carrier || ''} · ${r.shipDate || ''}`, actions: [] },
      { id: 'qualityInspections', slice: 'qualityInspections', label: 'Quality', icon: 'QA', title: (r) => r.type || 'Inspection', sub: (r) => `${r.workOrder || ''} · ${r.inspector || ''}`, actions: [] },
      { id: 'purchaseOrders', slice: 'purchaseOrders', label: 'Purchase orders', icon: 'PO', title: (r) => r.material || r.id, sub: (r) => `${r.supplier || ''} · ${money(Number(r.total))}`, actions: [] },
    ]),
  },

  // Read-only: every investment mutator is a trade, which is not a support
  // operator's authority.
  investment: {
    id: 'investment', name: 'Investment Ops', short: 'Investment', icon: 'IV',
    theme: { accent: '#1d4ed8', accent2: '#1e3a8a', tint: '#eef3ff' },
    lookupPath: '/api/admin/investment/lookup',
    lookupPlaceholder: 'Look up an investor by name, email, or id…',
    identityActions: [],
    caseSource: { path: '/api/admin/investment/cases' },
    permissions: {},
    actions: {},
    adaptLookup: userCentric([
      { id: 'portfolios', slice: 'portfolios', label: 'Portfolios', icon: 'PF', title: (r) => r.portfolioType || 'Portfolio', sub: (r) => `${r.portfolioNumber || ''} · ${money(Number(r.value))}`, actions: [] },
      { id: 'holdings', slice: 'holdings', label: 'Holdings', icon: 'HO', rowId: (r) => r.symbol, title: (r) => r.name || r.symbol, sub: (r) => `${r.symbol || ''} · ${r.quantity || 0} · ${money(Number(r.marketValue))}`, actions: [] },
      { id: 'trades', slice: 'trades', label: 'Trades', icon: 'TR', title: (r) => `${r.type || 'Trade'} ${r.symbol || ''}`, sub: (r) => `${money(Number(r.amount))} · ${r.date || ''}`, actions: [] },
      { id: 'dividends', slice: 'dividends', label: 'Dividends', icon: 'DV', rowId: (r) => r.id, title: (r) => r.symbol || 'Dividend', sub: (r) => `${money(Number(r.amount))} · ${r.period || ''}`, actions: [] },
    ]),
  },

  // Read-only: the store is createSeedStore with no mutator map.
  'abercrombie-fitch': {
    id: 'abercrombie-fitch', name: 'Abercrombie & Fitch Ops', short: 'A&F', icon: 'AF',
    theme: { accent: '#475569', accent2: '#1e293b', tint: '#f4f6f9' },
    lookupPath: '/api/admin/abercrombie-fitch/lookup',
    lookupPlaceholder: 'Look up a shopper by name, email, or id…',
    identityActions: [],
    caseSource: { path: '/api/admin/abercrombie-fitch/cases' },
    permissions: {},
    actions: {},
    adaptLookup: userCentric([
      { id: 'orders', slice: 'orders', label: 'Orders', icon: 'OR', title: (r) => r.product || r.id, sub: (r) => `${r.size || ''} ${r.color || ''} · ${money(Number(r.amount))}`, actions: [] },
      { id: 'returns', slice: 'returns', label: 'Returns', icon: 'RN', title: (r) => r.product || 'Return', sub: (r) => r.reason || '', actions: [] },
      { id: 'support_tickets', slice: 'support_tickets', label: 'Support', icon: 'TK', title: (r) => r.subject || 'Ticket', sub: (r) => `${r.category || ''} · ${r.created_date || ''}`, actions: [] },
      { id: 'rewards', slice: 'rewards', label: 'Rewards', icon: 'RW', title: (r) => r.tier || 'Rewards', sub: (r) => `${r.points || 0} pts`, actions: [] },
      { id: 'gift_cards', slice: 'gift_cards', label: 'Gift cards', icon: 'GC', title: (r) => `Card ending ${r.last4 || '????'}`, sub: (r) => `${money(Number(r.balance))} · expires ${r.expiry || ''}`, actions: [] },
    ]),
  },

};

// Super Sports is the demo's default vertical.
export const DEFAULT_CONSOLE_VERTICAL = 'sporting-goods';

/**
 * The console only knows the verticals in CONFIGS. `activeId` from useVertical()
 * is null before a vertical is chosen and can also be one with no console —
 * pingone-admin, airlines, a2a, mortgage, oauth-teaching. getVerticalConfig
 * THROWS on those, which would take down /admin entirely, so resolve first.
 */
export function resolveConsoleVertical(id) {
  return id && CONFIGS[id] ? id : DEFAULT_CONSOLE_VERTICAL;
}

export function getVerticalConfig(id) {
  const c = CONFIGS[id];
  if (!c) throw new Error(`Unknown vertical: ${id}`);
  return c;
}
