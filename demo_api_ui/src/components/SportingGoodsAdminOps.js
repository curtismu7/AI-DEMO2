import { useState, useCallback } from 'react';
import bffAxios from '../services/bffAxios';
import { notifyError, notifyInfo, notifySuccess } from '../utils/appToast';
import { formatCurrency } from '../utils/formatters';
import TokenChainDisplay from './TokenChainDisplay';
import AIAgent from './AIAgent';
import LookupUserChips from './LookupUserChips';
import PageNav from './PageNav';

const subText = { fontSize: '0.75rem', color: '#64748b' };
const isClosed = (s) => s === 'resolved' || s === 'closed';
const isDoneCoaching = (s) => s === 'cancelled' || s === 'completed';

// One record card: header + table. Hidden when the slice is empty so the page
// only shows sections the member actually has.
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

// Admin-only sporting-goods operations: resolve a member, view their orders and
// rentals, and run back-office actions (cancel order, return rental, etc.).
export default function SportingGoodsAdminOps({ user, onLogout }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [member, setMember] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const runLookup = useCallback(async (q = query) => {
    const needle = String(q || '').trim();
    if (!needle) return;
    setLoading(true);
    setError(null);
    try {
      const res = await bffAxios.get('/api/admin/sporting-goods/lookup', { params: { q: needle } });
      setMember(res.data.user || null);
      setData(res.data.data || null);
      if (!res.data.user) notifyInfo('No member matched — try a different name or username.');
    } catch (err) {
      const st = err.response?.status;
      if (st === 401) setError('Admin session expired. Please sign in again.');
      else if (st === 403) setError('Admin access required.');
      else setError(err.response?.data?.message || err.message);
      setMember(null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  // POST a write action for the resolved member, then refresh the view.
  const runAction = useCallback(async (path, successMsg) => {
    if (!member) return;
    try {
      await bffAxios.post(`/api/admin/sporting-goods/${path}`, { userId: member.id });
      notifySuccess(successMsg);
      await runLookup(member.username || query);
    } catch (err) {
      notifyError(err.response?.data?.error || err.response?.data?.message || err.message);
    }
  }, [member, query, runLookup]);

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
      <PageNav user={user} onLogout={onLogout} title="Sporting Goods Ops" />
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

        <main className="ud-center ud-banking-column" aria-label="Sporting goods admin operations">
          <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>
            Sporting Goods Ops
          </h2>

          {/* Member lookup */}
          <div className="app-page-card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <h3 className="card-title" style={{ fontSize: '1.1rem' }}>Member Lookup</h3>
              <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
                Find a member by name, username, or email to view orders and rentals and run admin actions.
              </p>
            </div>
            <div className="card-body">
              <LookupUserChips vertical="sporting-goods" noun="members" onPick={(u) => { setQuery(u); runLookup(u); }} />
              <div className="input-group mb-3">
                <input
                  id="sg-lookup-query"
                  className="form-control"
                  placeholder="Member name, username, or email"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runLookup()}
                />
                <button type="button" className="btn btn-primary" onClick={() => void runLookup()} disabled={loading}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
              </div>
              {error && <div className="alert alert-danger">{error}</div>}
              {member && (
                <p style={{ marginBottom: 0 }}>
                  <strong>{member.name || member.username}</strong>{' '}
                  <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    {member.username}{member.email ? ` · ${member.email}` : ''}
                  </span>
                </p>
              )}
            </div>
          </div>

          {data?.loyalty && (
            <div className="app-page-card" style={{ marginBottom: '1rem' }}>
              <div className="card-header">
                <h3 className="card-title" style={{ fontSize: '1.1rem' }}>Loyalty</h3>
              </div>
              <div className="card-body" style={{ fontSize: '0.9rem' }}>
                <strong>{data.loyalty.tier}</strong> — {data.loyalty.points} points
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
            title="Rentals"
            items={data?.rentals}
            columns={['Item', 'Due Date', 'Daily Rate', 'Status', 'Actions']}
            renderRow={(r) => (
              <tr key={r.id}>
                <td>{r.item}<div style={subText}>{r.sku}</div></td>
                <td>{r.dueDate}</td>
                <td>{formatCurrency(r.dailyRate)}</td>
                <td>{r.status}</td>
                <td>{actionBtn('btn-primary', 'Return', r.status === 'Returned',
                  `rentals/${encodeURIComponent(r.id)}/return`, 'Rental returned')}</td>
              </tr>
            )}
          />

          <TableSection
            title="Coaching Sessions"
            items={data?.coaching_sessions}
            columns={['Date', 'Sport', 'Coach', 'Status', 'Actions']}
            renderRow={(c) => (
              <tr key={c.id}>
                <td>{c.date}</td>
                <td>{c.sport}</td>
                <td>{c.coach}</td>
                <td>{c.status}</td>
                <td>{actionBtn('btn-danger', 'Cancel', isDoneCoaching(c.status),
                  `coaching/${encodeURIComponent(c.id)}/cancel`, 'Coaching session cancelled')}</td>
              </tr>
            )}
          />

          <TableSection
            title="Support Tickets"
            items={data?.support_tickets}
            columns={['Created', 'Subject', 'Priority', 'Status', 'Actions']}
            last
            renderRow={(t) => (
              <tr key={t.id}>
                <td>{t.createdAt}</td>
                <td>{t.subject}</td>
                <td>{t.priority}</td>
                <td>{t.status}</td>
                <td>{actionBtn('btn-secondary', 'Resolve', isClosed(t.status),
                  `tickets/${encodeURIComponent(t.id)}/resolve`, 'Ticket resolved')}</td>
              </tr>
            )}
          />

          {!loading && !member && (
            <p className="text-muted" style={{ padding: '0 0.5rem' }}>
              Pick a member chip or search by name to load their orders and rentals.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
