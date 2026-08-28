import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import bffAxios from '../services/bffAxios';
import { resolveSessionUser } from '../services/sessionResolver';
import { notifyError } from '../utils/appToast';
import { toastAdminSessionError } from '../utils/dashboardToast';
import { navigateToAdminOAuthLogin } from '../utils/authUi';
import AdminSubPageShell from './AdminSubPageShell';
import PageNav from './PageNav';
import { useSortableTable, SortableTh, dateOf } from '../hooks/useSortableTable';

const ACCOUNT_TYPE_BADGE_COLORS = {
  checking: 'var(--brand-navy)',
  savings: 'var(--v2-badge-savings, #10b981)',
  investment: 'var(--v2-badge-investment, #8b5cf6)',
  money_market: 'var(--v2-badge-money-market, #06b6d4)',
  credit: 'var(--v2-badge-credit, #f59e0b)',
  credit_card: 'var(--v2-badge-credit, #f59e0b)',
  car_loan: 'var(--v2-badge-loan, #ec4899)',
  mortgage: 'var(--v2-badge-mortgage, #6366f1)',
};

// Accounts never get an updatedAt from the data layer, so "latest update" is creation date.
const ACCOUNT_SORT_ACCESSORS = {
  owner: (a) => a.ownerUsername || a.userId,
  accountNumber: (a) => a.accountNumber,
  type: (a) => a.accountType,
  balance: (a) => a.balance,
  currency: (a) => a.currency,
  status: (a) => (a.isActive ? 1 : 0),
  created: dateOf('createdAt'),
};

const Accounts = ({ user, onLogout }) => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const sort = useSortableTable(accounts, ACCOUNT_SORT_ACCESSORS, 'created');

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const sessionUser = await resolveSessionUser();
      if (!sessionUser) {
        toastAdminSessionError('Your session has expired. Sign in again to continue.', navigateToAdminOAuthLogin);
        return;
      }
      const response = await bffAxios.get('/api/accounts');
      setAccounts(response.data.accounts);
    } catch (error) {
      console.error('Accounts error:', error);
      
      if (error.response?.status === 401) {
        toastAdminSessionError('Your session has expired. Sign in again to continue.', navigateToAdminOAuthLogin);
      } else if (error.response?.status === 403) {
        notifyError('You do not have permission to view accounts.');
      } else {
        notifyError('Failed to load accounts');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading && accounts.length === 0) {
    return (
      <AdminSubPageShell title="Accounts" lead="View bank accounts in the demo environment.">
        <div className="loading">
          <div>Loading accounts...</div>
        </div>
      </AdminSubPageShell>
    );
  }

  return (
    <AdminSubPageShell 
      title="Accounts" 
      lead="View bank accounts in the demo environment."
    >
      <PageNav user={user} onLogout={onLogout} title="Accounts" />

      <div className="app-page-card">
        <div className="card-header">
          <h2 className="card-title">Account Management</h2>
          <span style={{ color: '#374151', fontSize: '0.875rem' }}>
            {accounts.length} accounts found
          </span>
        </div>

        {accounts.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <SortableTh columnKey="owner" label="Owner" sort={sort} />
                  <SortableTh columnKey="accountNumber" label="Account Number" sort={sort} />
                  <SortableTh columnKey="type" label="Type" sort={sort} />
                  <SortableTh columnKey="balance" label="Balance" sort={sort} />
                  <SortableTh columnKey="currency" label="Currency" sort={sort} />
                  <SortableTh columnKey="status" label="Status" sort={sort} />
                  <SortableTh columnKey="created" label="Created" sort={sort} />
                </tr>
              </thead>
              <tbody>
                {sort.sortedRows.map((account) => {
                  const typeKey = String(account.accountType || '').toLowerCase();
                  const badgeColor = ACCOUNT_TYPE_BADGE_COLORS[typeKey] || '#64748b';
                  return (
                  <tr key={account.id}>
                    <td style={{ fontSize: '0.8rem' }}>
                      <div style={{ fontWeight: '600' }}>{account.ownerUsername || account.userId || '—'}</div>
                      {account.ownerEmail && <div style={{ color: '#374151', fontSize: '0.7rem' }}>{account.ownerEmail}</div>}
                    </td>
                    <td style={{ fontFamily: 'inherit', fontWeight: '600' }}>
                      {account.accountNumber}
                    </td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        backgroundColor: badgeColor,
                        color: 'white'
                      }}>
                        {account.accountType}
                      </span>
                    </td>
                    <td style={{ fontWeight: '600', color: account.balance >= 0 ? 'var(--v2-badge-savings, #10b981)' : 'var(--v2-negative, #ef4444)' }}>
                      ${account.balance.toLocaleString()}
                    </td>
                    <td>{account.currency}</td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        backgroundColor: account.isActive ? 'var(--v2-badge-savings, #10b981)' : 'var(--v2-badge-inactive, #6b7280)',
                        color: 'white'
                      }}>
                        {account.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{format(new Date(account.createdAt), 'MMM dd, yyyy')}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No accounts found</h3>
            <p>No accounts are currently available.</p>
          </div>
        )}
      </div>
    </AdminSubPageShell>
  );
};

export default Accounts;
