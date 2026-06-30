import { useState, useCallback } from 'react';
import bffAxios from '../services/bffAxios';
import { notifyError, notifyInfo, notifySuccess } from '../utils/appToast';
import { formatCurrency } from '../utils/formatters';
import TokenChainDisplay from './TokenChainDisplay';
import AIAgent from './AIAgent';
import LookupUserChips from './LookupUserChips';
import PageNav from './PageNav';

const isDue = (s) => s === 'Due' || s === 'Overdue';
const subText = { fontSize: '0.75rem', color: '#64748b' };

// One record card: header + table. Hidden when the slice is empty so the page
// only shows sections the patient actually has.
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

// Admin-only healthcare operations: resolve a patient, view their records, and
// run back-office actions (cancel appointment, pay bill, refill, release, etc.).
export default function HealthcareAdminOps({ user, onLogout }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [patient, setPatient] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const runLookup = useCallback(async (q = query) => {
    const needle = String(q || '').trim();
    if (!needle) return;
    setLoading(true);
    setError(null);
    try {
      const res = await bffAxios.get('/api/admin/healthcare/lookup', { params: { q: needle } });
      setPatient(res.data.user || null);
      setData(res.data.data || null);
      if (!res.data.user) notifyInfo('No patient matched — try a different name or username.');
    } catch (err) {
      const st = err.response?.status;
      if (st === 401) setError('Admin session expired. Please sign in again.');
      else if (st === 403) setError('Admin access required.');
      else setError(err.response?.data?.message || err.message);
      setPatient(null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  // POST a write action for the resolved patient, then refresh the view.
  const runAction = useCallback(async (path, successMsg) => {
    if (!patient) return;
    try {
      await bffAxios.post(`/api/admin/healthcare/${path}`, { userId: patient.id });
      notifySuccess(successMsg);
      await runLookup(patient.username || query);
    } catch (err) {
      notifyError(err.response?.data?.error || err.response?.data?.message || err.message);
    }
  }, [patient, query, runLookup]);

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
      <PageNav user={user} onLogout={onLogout} title="Healthcare Ops" />
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

        <main className="ud-center ud-banking-column" aria-label="Healthcare admin operations">
          <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>
            Healthcare Ops
          </h2>

          {/* Patient lookup */}
          <div className="app-page-card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <h3 className="card-title" style={{ fontSize: '1.1rem' }}>Patient Lookup</h3>
              <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
                Find a patient by name, username, or email to view records and run admin actions.
              </p>
            </div>
            <div className="card-body">
              <LookupUserChips vertical="healthcare" noun="patients" onPick={(u) => { setQuery(u); runLookup(u); }} />
              <div className="input-group mb-3">
                <input
                  id="hc-lookup-query"
                  className="form-control"
                  placeholder="Patient name, username, or email"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runLookup()}
                />
                <button type="button" className="btn btn-primary" onClick={() => void runLookup()} disabled={loading}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
              </div>
              {error && <div className="alert alert-danger">{error}</div>}
              {patient && (
                <p style={{ marginBottom: 0 }}>
                  <strong>{patient.name || patient.username}</strong>{' '}
                  <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    {patient.username}{patient.email ? ` · ${patient.email}` : ''}
                  </span>
                </p>
              )}
            </div>
          </div>

          {data?.coverage && (
            <div className="app-page-card" style={{ marginBottom: '1rem' }}>
              <div className="card-header">
                <h3 className="card-title" style={{ fontSize: '1.1rem' }}>Coverage</h3>
              </div>
              <div className="card-body" style={{ fontSize: '0.9rem' }}>
                <strong>{data.coverage.plan}</strong> — {data.coverage.status}
                <div style={{ color: '#64748b' }}>
                  Deductible {formatCurrency(data.coverage.deductibleMet)} / {formatCurrency(data.coverage.deductibleTotal)} ·
                  Out of pocket {formatCurrency(data.coverage.outOfPocket)}
                </div>
              </div>
            </div>
          )}

          <TableSection
            title="Appointments"
            items={data?.appointments}
            columns={['Date', 'Provider', 'Reason', 'Status', 'Actions']}
            renderRow={(a) => (
              <tr key={a.id}>
                <td>{a.when}</td>
                <td>{a.provider}<div style={subText}>{a.clinic}</div></td>
                <td>{a.reason}</td>
                <td>{a.status}</td>
                <td>{actionBtn('btn-danger', 'Cancel', a.status === 'Cancelled' || a.status === 'Completed',
                  `appointments/${encodeURIComponent(a.id)}/cancel`, 'Appointment cancelled')}</td>
              </tr>
            )}
          />

          <TableSection
            title="Billing"
            items={data?.billingHistory}
            columns={['Date', 'Description', 'Amount Due', 'Status', 'Actions']}
            renderRow={(b) => (
              <tr key={b.id}>
                <td>{b.date}</td>
                <td>{b.description}</td>
                <td>{formatCurrency(b.amountDue)}</td>
                <td>{b.status}</td>
                <td>{actionBtn('btn-primary', 'Pay', !isDue(b.status),
                  `bills/${encodeURIComponent(b.id)}/pay`, 'Bill marked paid')}</td>
              </tr>
            )}
          />

          <TableSection
            title="Medications"
            items={data?.medications}
            columns={['Name', 'Dosage', 'Frequency', 'Refills', 'Status', 'Actions']}
            renderRow={(m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.dosage}</td>
                <td>{m.frequency}</td>
                <td>{m.refillsRemaining}</td>
                <td>{m.status}</td>
                <td>{actionBtn('btn-secondary', 'Refill', m.status === 'Refill Requested',
                  `medications/${encodeURIComponent(m.id)}/refill`, 'Refill requested')}</td>
              </tr>
            )}
          />

          <TableSection
            title="Medical Records"
            items={data?.patientRecords}
            columns={['Type', 'Provider', 'Last Visit', 'Status', 'Actions']}
            renderRow={(r) => (
              <tr key={r.id}>
                <td>{r.recordType}</td>
                <td>{r.provider}<div style={subText}>{r.facility}</div></td>
                <td>{r.lastVisit}</td>
                <td>{r.status}</td>
                <td>{actionBtn('btn-secondary', 'Release', r.status === 'Released',
                  `records/${encodeURIComponent(r.id)}/release`, 'Record released')}</td>
              </tr>
            )}
          />

          <TableSection
            title="Referrals"
            items={data?.referrals}
            columns={['Specialty', 'Provider', 'Expires', 'Status', 'Actions']}
            last
            renderRow={(r) => (
              <tr key={r.id}>
                <td>{r.specialty}</td>
                <td>{r.toProvider}<div style={subText}>{r.facility}</div></td>
                <td>{r.expiryDate}</td>
                <td>{r.status}</td>
                <td>{actionBtn('btn-danger', 'Cancel', r.status === 'Cancelled' || r.status === 'Completed',
                  `referrals/${encodeURIComponent(r.id)}/cancel`, 'Referral cancelled')}</td>
              </tr>
            )}
          />

          {!loading && !patient && (
            <p className="text-muted" style={{ padding: '0 0.5rem' }}>
              Pick a patient chip or search by name to load their records.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
