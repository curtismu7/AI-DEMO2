import { useState, useCallback } from 'react';
import bffAxios from '../services/bffAxios';
import { notifyError, notifyInfo, notifySuccess } from '../utils/appToast';
import { formatCurrency } from '../utils/formatters';
import TokenChainDisplay from './TokenChainDisplay';
import AIAgent from './AIAgent';
import LookupUserChips from './LookupUserChips';
import PageNav from './PageNav';

const subText = { fontSize: '0.75rem', color: '#64748b' };
const isClosed = (s) => s === 'Resolved' || s === 'Closed';

// One record card: header + table. Hidden when the slice is empty so the page
// only shows sections the customer actually has.
function TableSection({ title, items, columns, renderRow, last }) {
  if (!items?.length) return null;
  return (
    <div className="app-page-card" style={last ? undefined : { marginBottom: '1rem' }}>
      <div className="card-header">
        <h3 className="card-title" style={{ fontSize: '1.1rem' }}>{title}</h3>
      </div>
      <div className="table-responsive">
        <table className="table">
          <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{items.map(renderRow)}</tbody>
        </table>
      </div>
    </div>
  );
}

// Admin-only retail operations: resolve a customer, view their orders, and run
// back-office actions (cancel order, approve return, cancel subscription, etc.).
export default function RetailAdminOps({ user, onLogout }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const runLookup = useCallback(async (q = query) => {
    const needle = String(q || '').trim();
    if (!needle) return;
    setLoading(true);
    setError(null);
    try {
      const res = await bffAxios.get('/api/admin/retail/lookup', { params: { q: needle } });
      setCustomer(res.data.user || null);
      setData(res.data.data || null);
      if (!res.data.user) notifyInfo('No customer matched — try a different name or username.');
    } catch (err) {
      const st = err.response?.status;
      if (st === 401) setError('Admin session expired. Please sign in again.');
      else if (st === 403) setError('Admin access required.');
      else setError(err.response?.data?.message || err.message);
      setCustomer(null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  // POST a write action for the resolved customer, then refresh the view.
  const runAction = useCallback(async (path, successMsg) => {
    if (!customer) return;
    try {
      await bffAxios.post(`/api/admin/retail/${path}`, { userId: customer.id });
      notifySuccess(successMsg);
      await runLookup(customer.username || query);
    } catch (err) {
      notifyError(err.response?.data?.error || err.response?.data?.message || err.message);
    }
  }, [customer, query, runLookup]);

  const actionBtn = (variant, label, disabled, path, msg) => (
    <button
      type="button"
      className={`btn btn-sm ${variant}`}
      disabled={disabled}
      onClick={() => void runAction(path, msg)}
    >
      {label}
    </button>
  );

  return (
    <div className="banking-admin-dashboard">
      <PageNav user={user} onLogout={onLogout} title="Retail Ops" />
      <div className="dashboard-content ud-body ud-body--2026 ud-body--dashboard-split3">
        <aside className="ud-token-rail" aria-label="Token chain">
          <div className="section ud-token-rail__inner">
            <TokenChainDisplay />
          </div>
        </aside>

        <section className="ud-agent-column" aria-label="AI assistant">
          <div className="embedded-banking-agent ud-dashboard-inline-agent">
            <AIAgent
              user={user}
              onLogout={onLogout}
              mode="inline"
              splitColumnChrome
              distinctFloatingChrome
              forceVertical="admin"
            />
          </div>
        </section>

        <main className="ud-center ud-banking-column" aria-label="Retail admin operations">
          <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>
            Retail Ops
          </h2>

          {/* Customer lookup */}
          <div className="app-page-card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <h3 className="card-title" style={{ fontSize: '1.1rem' }}>Customer Lookup</h3>
              <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
                Find a customer by name, username, or email to view orders and run admin actions.
              </p>
            </div>
            <div className="card-body">
              <LookupUserChips vertical="retail" noun="customers" onPick={(u) => { setQuery(u); runLookup(u); }} />
              <div className="input-group mb-3">
                <input
                  id="retail-lookup-query"
                  className="form-control"
                  placeholder="Customer name, username, or email"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runLookup()}
                />
                <button type="button" className="btn btn-primary" onClick={() => void runLookup()} disabled={loading}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
              </div>
              {error && <div className="alert alert-danger">{error}</div>}
              {customer && (
                <p style={{ marginBottom: 0 }}>
                  <strong>{customer.name || customer.username}</strong>{' '}
                  <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    {customer.username}{customer.email ? ` · ${customer.email}` : ''}
                  </span>
                </p>
              )}
            </div>
          </div>

          {data?.rewards && (
            <div className="app-page-card" style={{ marginBottom: '1rem' }}>
              <div className="card-header">
                <h3 className="card-title" style={{ fontSize: '1.1rem' }}>Rewards</h3>
              </div>
              <div className="card-body" style={{ fontSize: '0.9rem' }}>
                <strong>{data.rewards.tier}</strong> — {data.rewards.points} points
                <div style={{ color: '#64748b' }}>
                  Store credit {formatCurrency(data.rewards.storeCredit)}
                </div>
              </div>
            </div>
          )}

          <TableSection
            title="Orders"
            items={data?.orders}
            columns={['Date', 'Product', 'Amount', 'Status', 'Actions']}
            renderRow={(o) => (
              <tr key={o.id}>
                <td>{o.date}</td>
                <td>{o.product}<div style={subText}>{o.sku}</div></td>
                <td>{formatCurrency(o.amount)}</td>
                <td>{o.status}</td>
                <td>{actionBtn('btn-danger', 'Cancel', o.status === 'Cancelled' || o.status === 'Delivered',
                  `orders/${encodeURIComponent(o.id)}/cancel`, 'Order cancelled')}</td>
              </tr>
            )}
          />

          <TableSection
            title="Returns"
            items={data?.returns}
            columns={['Date', 'Product', 'Reason', 'Status', 'Actions']}
            renderRow={(r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.product}</td>
                <td>{r.reason}</td>
                <td>{r.status}</td>
                <td>{actionBtn('btn-primary', 'Approve refund', r.status === 'Refunded',
                  `returns/${encodeURIComponent(r.id)}/approve`, 'Return refunded')}</td>
              </tr>
            )}
          />

          <TableSection
            title="Subscriptions"
            items={data?.subscriptions}
            columns={['Product', 'Frequency', 'Next Date', 'Status', 'Actions']}
            renderRow={(s) => (
              <tr key={s.id}>
                <td>{s.product}</td>
                <td>{s.frequency}</td>
                <td>{s.next_date}</td>
                <td>{s.status}</td>
                <td>{actionBtn('btn-danger', 'Cancel', s.status === 'Cancelled',
                  `subscriptions/${encodeURIComponent(s.id)}/cancel`, 'Subscription cancelled')}</td>
              </tr>
            )}
          />

          <TableSection
            title="Support Tickets"
            items={data?.support_tickets}
            columns={['Created', 'Subject', 'Category', 'Status', 'Actions']}
            last
            renderRow={(t) => (
              <tr key={t.id}>
                <td>{t.created_date}</td>
                <td>{t.subject}</td>
                <td>{t.category}</td>
                <td>{t.status}</td>
                <td>{actionBtn('btn-secondary', 'Resolve', isClosed(t.status),
                  `tickets/${encodeURIComponent(t.id)}/resolve`, 'Ticket resolved')}</td>
              </tr>
            )}
          />

          {!loading && !customer && (
            <p className="text-muted" style={{ padding: '0 0.5rem' }}>
              Pick a customer chip or search by name to load their orders.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
