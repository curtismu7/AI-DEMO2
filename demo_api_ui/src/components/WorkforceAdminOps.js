import { useState, useCallback } from 'react';
import bffAxios from '../services/bffAxios';
import { notifyError, notifyInfo, notifySuccess } from '../utils/appToast';
import { formatCurrency } from '../utils/formatters';
import TokenChainDisplay from './TokenChainDisplay';
import AIAgent from './AIAgent';
import LookupUserChips from './LookupUserChips';
import PageNav from './PageNav';

const subText = { fontSize: '0.75rem', color: '#64748b' };
const expenseSettled = (s) => s === 'Approved' || s === 'Denied' || s === 'Reimbursed';
const ticketClosed = (s) => s === 'Resolved' || s === 'Closed';

// One record card: header + table. Hidden when the slice is empty so the page
// only shows sections the employee actually has.
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

// Admin-only workforce operations: resolve an employee, view their records, and
// run back-office actions (approve/deny expense, resolve ticket, complete training).
export default function WorkforceAdminOps({ user, onLogout }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [employee, setEmployee] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const runLookup = useCallback(async (q = query) => {
    const needle = String(q || '').trim();
    if (!needle) return;
    setLoading(true);
    setError(null);
    try {
      const res = await bffAxios.get('/api/admin/workforce/lookup', { params: { q: needle } });
      setEmployee(res.data.user || null);
      setData(res.data.data || null);
      if (!res.data.user) notifyInfo('No employee matched — try a different name or username.');
    } catch (err) {
      const st = err.response?.status;
      if (st === 401) setError('Admin session expired. Please sign in again.');
      else if (st === 403) setError('Admin access required.');
      else setError(err.response?.data?.message || err.message);
      setEmployee(null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  // POST a write action for the resolved employee, then refresh the view.
  const runAction = useCallback(async (path, successMsg) => {
    if (!employee) return;
    try {
      await bffAxios.post(`/api/admin/workforce/${path}`, { userId: employee.id });
      notifySuccess(successMsg);
      await runLookup(employee.username || query);
    } catch (err) {
      notifyError(err.response?.data?.error || err.response?.data?.message || err.message);
    }
  }, [employee, query, runLookup]);

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
      <PageNav user={user} onLogout={onLogout} title="Workforce Ops" />
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

        <main className="ud-center ud-banking-column" aria-label="Workforce admin operations">
          <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>
            Workforce Ops
          </h2>

          {/* Employee lookup */}
          <div className="app-page-card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <h3 className="card-title" style={{ fontSize: '1.1rem' }}>Employee Lookup</h3>
              <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
                Find an employee by name, username, or email to view records and run admin actions.
              </p>
            </div>
            <div className="card-body">
              <LookupUserChips vertical="workforce" noun="employees" onPick={(u) => { setQuery(u); runLookup(u); }} />
              <div className="input-group mb-3">
                <input
                  id="wf-lookup-query"
                  className="form-control"
                  placeholder="Employee name, username, or email"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runLookup()}
                />
                <button type="button" className="btn btn-primary" onClick={() => void runLookup()} disabled={loading}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
              </div>
              {error && <div className="alert alert-danger">{error}</div>}
              {employee && (
                <p style={{ marginBottom: 0 }}>
                  <strong>{employee.name || employee.username}</strong>{' '}
                  <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    {employee.username}{employee.email ? ` · ${employee.email}` : ''}
                  </span>
                </p>
              )}
            </div>
          </div>

          {data?.pto && (
            <div className="app-page-card" style={{ marginBottom: '1rem' }}>
              <div className="card-header">
                <h3 className="card-title" style={{ fontSize: '1.1rem' }}>PTO</h3>
              </div>
              <div className="card-body" style={{ fontSize: '0.9rem' }}>
                <strong>{data.pto.balance} day(s)</strong> available
                <div style={{ color: '#64748b' }}>
                  Sick leave {data.pto.sickLeave} · Accrued YTD {data.pto.accruedYtd}
                </div>
              </div>
            </div>
          )}

          <TableSection
            title="Expenses"
            items={data?.expenses}
            columns={['Date', 'Category', 'Description', 'Amount', 'Status', 'Actions']}
            renderRow={(e) => (
              <tr key={e.id}>
                <td>{e.submittedDate}</td>
                <td>{e.category}</td>
                <td>{e.description}</td>
                <td>{formatCurrency(e.amount)}</td>
                <td>{e.status}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {actionBtn('btn-primary', 'Approve', expenseSettled(e.status),
                    `expenses/${encodeURIComponent(e.id)}/approve`, 'Expense approved')}{' '}
                  {actionBtn('btn-danger', 'Deny', expenseSettled(e.status),
                    `expenses/${encodeURIComponent(e.id)}/deny`, 'Expense denied')}
                </td>
              </tr>
            )}
          />

          <TableSection
            title="IT & HR Tickets"
            items={data?.tickets}
            columns={['Created', 'Subject', 'Category', 'Priority', 'Status', 'Actions']}
            renderRow={(t) => (
              <tr key={t.id}>
                <td>{t.createdDate}</td>
                <td>{t.subject}</td>
                <td>{t.category}</td>
                <td>{t.priority}</td>
                <td>{t.status}</td>
                <td>{actionBtn('btn-secondary', 'Resolve', ticketClosed(t.status),
                  `tickets/${encodeURIComponent(t.id)}/resolve`, 'Ticket resolved')}</td>
              </tr>
            )}
          />

          <TableSection
            title="Trainings"
            items={data?.trainings}
            columns={['Title', 'Category', 'Due', 'Status', 'Actions']}
            renderRow={(tr) => (
              <tr key={tr.id}>
                <td>{tr.title}<div style={subText}>{tr.durationHours}h</div></td>
                <td>{tr.category}</td>
                <td>{tr.dueDate}</td>
                <td>{tr.status}</td>
                <td>{actionBtn('btn-primary', 'Mark complete', tr.status === 'Completed',
                  `trainings/${encodeURIComponent(tr.id)}/complete`, 'Training marked complete')}</td>
              </tr>
            )}
          />

          <TableSection
            title="Benefits"
            items={data?.benefits}
            columns={['Name', 'Plan Type', 'Coverage Tier', 'Status']}
            last
            renderRow={(b) => (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td>{b.planType}</td>
                <td>{b.coverageTier}</td>
                <td>{b.enrollmentStatus}</td>
              </tr>
            )}
          />

          {!loading && !employee && (
            <p className="text-muted" style={{ padding: '0 0.5rem' }}>
              Pick an employee chip or search by name to load their records.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
