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

// Transactions never get an updatedAt from the data layer, so "latest update" is the Date column.
const TRANSACTION_SORT_ACCESSORS = {
  date: dateOf('createdAt'),
  user: (t) => t.ownerUsername || t.userId,
  type: (t) => t.type,
  amount: (t) => t.amount,
  description: (t) => t.description,
  client: (t) => t.clientType,
  status: (t) => t.status,
};

const Transactions = ({ user, onLogout }) => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const sort = useSortableTable(transactions, TRANSACTION_SORT_ACCESSORS, 'date');

  useEffect(() => {
    let cancelled = false;
    const doFetch = async () => {
      try {
        setLoading(true);
        const sessionUser = await resolveSessionUser();
        if (cancelled) return;
        if (!sessionUser) {
          toastAdminSessionError('Your session has expired. Please sign in again.', navigateToAdminOAuthLogin);
          return;
        }
        const response = await bffAxios.get('/api/transactions');
        if (cancelled) return;
        setTransactions(response.data.transactions);
      } catch (error) {
        if (cancelled) return;
        console.error('Transactions error:', error);

        if (error.response?.status === 401) {
          toastAdminSessionError('Your session has expired. Please sign in again.', navigateToAdminOAuthLogin);
        } else if (error.response?.status === 403) {
          notifyError('You do not have permission to view transactions.');
        } else {
          notifyError('Failed to load transactions');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    doFetch();
    return () => { cancelled = true; };
  }, []);

  const getTransactionTypeColor = (type) => {
    const colors = {
      'transfer': 'var(--brand-navy)',
      'deposit': '#10b981',
      'withdrawal': '#f59e0b'
    };
    return colors[type] || '#6b7280';
  };

  const getClientTypeIcon = (clientType) => {
    if (clientType === 'enduser') {
      return { icon: '👤', label: 'End User', color: 'var(--brand-navy)' };
    } else if (clientType === 'ai_agent') {
      return { icon: '🤖', label: 'AI Agent', color: '#8b5cf6' };
    } else {
      return { icon: '❓', label: 'Unknown', color: '#374151' };
    }
  };

  if (loading && transactions.length === 0) {
    return (
      <AdminSubPageShell title="Transactions" lead="Review transfers, deposits, and withdrawals.">
        <div className="loading">
          <div>Loading transactions...</div>
        </div>
      </AdminSubPageShell>
    );
  }

  return (
    <AdminSubPageShell title="Transactions" lead="Review transfers, deposits, and withdrawals.">
      <PageNav user={user} onLogout={onLogout} title="Transactions" />

      <div className="app-page-card">
        <div className="card-header">
          <h2 className="card-title">Transaction History</h2>
          <span style={{ color: '#374151', fontSize: '0.875rem' }}>
            {transactions.length} transactions found
          </span>
        </div>

        {transactions.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <SortableTh columnKey="date" label="Date" sort={sort} />
                  <SortableTh columnKey="user" label="User" sort={sort} />
                  <SortableTh columnKey="type" label="Type" sort={sort} />
                  <SortableTh columnKey="amount" label="Amount" sort={sort} />
                  <SortableTh columnKey="description" label="Description" sort={sort} />
                  <SortableTh columnKey="client" label="Client" sort={sort} />
                  <SortableTh columnKey="status" label="Status" sort={sort} />
                </tr>
              </thead>
              <tbody>
                {sort.sortedRows.map((transaction) => {
                  const clientInfo = getClientTypeIcon(transaction.clientType);
                  return (
                    <tr key={transaction.id}>
                      <td>{format(new Date(transaction.createdAt), 'MMM dd, yyyy HH:mm')}</td>
                      <td style={{ fontSize: '0.8rem' }}>
                        <div style={{ fontWeight: '600' }}>{transaction.ownerUsername || transaction.userId || '—'}</div>
                        {transaction.ownerEmail && <div style={{ color: '#374151', fontSize: '0.7rem' }}>{transaction.ownerEmail}</div>}
                      </td>
                      <td>
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '0.25rem',
                          fontSize: '0.75rem',
                          fontWeight: '500',
                          backgroundColor: getTransactionTypeColor(transaction.type),
                          color: 'white'
                        }}>
                          {transaction.type.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ 
                        fontWeight: '600', 
                        color: transaction.type === 'withdrawal' ? '#ef4444' : '#10b981' 
                      }}>
                        ${transaction.amount.toLocaleString()}
                      </td>
                      <td>{transaction.description}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '1.2rem' }}>{clientInfo.icon}</span>
                          <div>
                            <div style={{ fontSize: '0.75rem', color: clientInfo.color, fontWeight: '500' }}>
                              {clientInfo.label}
                            </div>
                            {transaction.performedBy && transaction.performedBy !== transaction.userId && (
                              <div style={{ fontSize: '0.7rem', color: '#374151' }}>{transaction.performedBy}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '0.25rem',
                          fontSize: '0.75rem',
                          fontWeight: '500',
                          backgroundColor: transaction.status === 'completed' ? '#10b981' : '#f59e0b',
                          color: 'white'
                        }}>
                          {transaction.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No transactions found</h3>
            <p>No transactions are currently available.</p>
          </div>
        )}
      </div>
    </AdminSubPageShell>
  );
};

export default Transactions;
