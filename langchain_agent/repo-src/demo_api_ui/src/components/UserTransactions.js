// banking_api_ui/src/components/UserTransactions.js
import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import './UserTransactions.css';

export default function UserTransactions({ user }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    // Simulate loading user transactions
    const loadTransactions = async () => {
      try {
        // In a real implementation, this would fetch from an API
        const mockTransactions = [
          {
            id: 'txn-001',
            date: '2026-04-06',
            description: 'Online Purchase - Amazon',
            amount: -89.99,
            type: 'debit',
            category: 'Shopping',
            account: 'Primary Checking',
            status: 'completed'
          },
          {
            id: 'txn-002',
            date: '2026-04-05',
            description: 'Direct Deposit - Salary',
            amount: 3500.00,
            type: 'credit',
            category: 'Income',
            account: 'Primary Checking',
            status: 'completed'
          },
          {
            id: 'txn-003',
            date: '2026-04-04',
            description: 'Transfer to Savings',
            amount: -500.00,
            type: 'debit',
            category: 'Transfer',
            account: 'Primary Checking',
            status: 'completed'
          },
          {
            id: 'txn-004',
            date: '2026-04-03',
            description: 'Coffee Shop',
            amount: -12.50,
            type: 'debit',
            category: 'Food & Dining',
            account: 'Primary Checking',
            status: 'completed'
          },
          {
            id: 'txn-005',
            date: '2026-04-02',
            description: 'Utility Bill Payment',
            amount: -125.00,
            type: 'debit',
            category: 'Bills',
            account: 'Primary Checking',
            status: 'completed'
          }
        ];
        
        setTimeout(() => {
          setTransactions(mockTransactions);
          setLoading(false);
        }, 500);
      } catch (error) {
        toast.error('Failed to load transactions');
        setLoading(false);
      }
    };

    loadTransactions();
  }, []);

  const handleAction = (action) => {
    toast.info(`${action} - This would open the appropriate flow`);
  };

  const filteredTransactions = filter === 'all' 
    ? transactions 
    : transactions.filter(txn => txn.type === filter);

  const totalCredits = transactions
    .filter(txn => txn.type === 'credit')
    .reduce((sum, txn) => sum + txn.amount, 0);

  const totalDebits = transactions
    .filter(txn => txn.type === 'debit')
    .reduce((sum, txn) => sum + Math.abs(txn.amount), 0);

  if (loading) {
    return (
      <div className="user-transactions">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading your transactions...</p>
        </div>
        <style jsx>{`
          .user-transactions {
            max-width: 1000px;
            margin: 0 auto;
            padding: 2rem;
          }
          .loading-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 400px;
            gap: 1rem;
          }
          .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid #f3f4f6;
            border-top: 3px solid #4f46e5;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="user-transactions">
      <div className="transactions-header">
        <h2>Transfer Money</h2>
        <p>Send money between your accounts or to external recipients</p>
      </div>

      <div className="transfer-section">
        <div className="transfer-options">
          <div className="transfer-card">
            <div className="transfer-icon">🏦</div>
            <div className="transfer-content">
              <h3>Internal Transfer</h3>
              <p>Move money between your own accounts</p>
              <button 
                type="button"
                onClick={() => handleAction('Internal Transfer')}
                className="btn btn-primary"
              >
                Transfer Between Accounts
              </button>
            </div>
          </div>

          <div className="transfer-card">
            <div className="transfer-icon">👥</div>
            <div className="transfer-content">
              <h3>External Transfer</h3>
              <p>Send money to other people or external accounts</p>
              <button 
                type="button"
                onClick={() => handleAction('External Transfer')}
                className="btn btn-primary"
              >
                Send to Someone
              </button>
            </div>
          </div>

          <div className="transfer-card">
            <div className="transfer-icon">📅</div>
            <div className="transfer-content">
              <h3>Scheduled Transfer</h3>
              <p>Set up recurring or future-dated transfers</p>
              <button 
                type="button"
                onClick={() => handleAction('Scheduled Transfer')}
                className="btn btn-outline"
              >
                Schedule Transfer
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="recent-transactions">
        <div className="section-header">
          <h3>Recent Transactions</h3>
          <div className="filter-tabs">
            {[
              { id: 'all', label: 'All' },
              { id: 'credit', label: 'Credits' },
              { id: 'debit', label: 'Debits' }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`filter-btn ${filter === tab.id ? 'active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="transactions-summary">
          <div className="summary-item">
            <span className="summary-label">Total Credits:</span>
            <span className="summary-value credits">+${totalCredits.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Total Debits:</span>
            <span className="summary-value debits">-${totalDebits.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Net Change:</span>
            <span className={`summary-value ${(totalCredits - totalDebits) >= 0 ? 'credits' : 'debits'}`}>
              {(totalCredits - totalDebits) >= 0 ? '+' : ''}${(totalCredits - totalDebits).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <div className="transactions-list">
          {filteredTransactions.map(transaction => (
            <div key={transaction.id} className="transaction-item">
              <div className="transaction-date">
                <div className="date-day">{new Date(transaction.date).getDate()}</div>
                <div className="date-month">{new Date(transaction.date).toLocaleDateString('en-US', { month: 'short' })}</div>
              </div>
              
              <div className="transaction-details">
                <div className="transaction-description">{transaction.description}</div>
                <div className="transaction-meta">
                  <span className="transaction-category">{transaction.category}</span>
                  <span className="transaction-account">{transaction.account}</span>
                </div>
              </div>

              <div className="transaction-amount">
                <span className={`amount ${transaction.type}`}>
                  {transaction.type === 'credit' ? '+' : '-'}${Math.abs(transaction.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="transaction-status">
                <span className={`status-badge ${transaction.status}`}>{transaction.status}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="transactions-actions">
          <button 
            type="button"
            onClick={() => handleAction('View All Transactions')}
            className="btn btn-outline"
          >
            View All Transactions
          </button>
          <button 
            type="button"
            onClick={() => handleAction('Download Statement')}
            className="btn btn-outline"
          >
            Download Statement
          </button>
        </div>
      </div>

      <style jsx>{`
        .user-transactions {
          max-width: 1000px;
          margin: 0 auto;
          padding: 2rem;
        }

        .transactions-header {
          margin-bottom: 2rem;
        }

        .transactions-header h2 {
          margin: 0 0 0.5rem 0;
          color: #333;
        }

        .transactions-header p {
          margin: 0;
          color: #666;
        }

        .transfer-section {
          margin-bottom: 3rem;
        }

        .transfer-options {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
        }

        .transfer-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          padding: 2rem;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          text-align: center;
        }

        .transfer-icon {
          font-size: 3rem;
        }

        .transfer-content h3 {
          margin: 0 0 0.5rem 0;
          color: #333;
        }

        .transfer-content p {
          margin: 0 0 1.5rem 0;
          color: #666;
        }

        .recent-transactions {
          background: white;
          border-radius: 8px;
          padding: 2rem;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .section-header h3 {
          margin: 0;
          color: #333;
        }

        .filter-tabs {
          display: flex;
          gap: 0.5rem;
        }

        .filter-btn {
          padding: 0.5rem 1rem;
          border: 1px solid #e5e7eb;
          background: white;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .filter-btn:hover {
          background: #f9fafb;
        }

        .filter-btn.active {
          background: #4f46e5;
          color: white;
          border-color: #4f46e5;
        }

        .transactions-summary {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          background: #f9fafb;
          border-radius: 6px;
          margin-bottom: 1.5rem;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .summary-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 120px;
        }

        .summary-label {
          font-size: 0.875rem;
          color: #666;
          margin-bottom: 0.25rem;
        }

        .summary-value {
          font-weight: 600;
          font-size: 1.1rem;
        }

        .summary-value.credits {
          color: #10b981;
        }

        .summary-value.debits {
          color: #ef4444;
        }

        .transactions-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin-bottom: 1.5rem;
        }

        .transaction-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          border-bottom: 1px solid #f3f4f6;
        }

        .transaction-item:last-child {
          border-bottom: none;
        }

        .transaction-date {
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 60px;
        }

        .date-day {
          font-size: 1.25rem;
          font-weight: 600;
          color: #333;
        }

        .date-month {
          font-size: 0.75rem;
          color: #666;
          text-transform: uppercase;
        }

        .transaction-details {
          flex: 1;
        }

        .transaction-description {
          font-weight: 500;
          color: #333;
          margin-bottom: 0.25rem;
        }

        .transaction-meta {
          display: flex;
          gap: 1rem;
          font-size: 0.875rem;
          color: #666;
        }

        .transaction-amount {
          min-width: 100px;
          text-align: right;
        }

        .amount {
          font-weight: 600;
          font-size: 1.1rem;
        }

        .amount.credit {
          color: #10b981;
        }

        .amount.debit {
          color: #ef4444;
        }

        .transaction-status {
          min-width: 80px;
          text-align: right;
        }

        .status-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .status-badge.completed {
          background: #f0fdf4;
          color: #10b981;
        }

        .transactions-actions {
          display: flex;
          gap: 1rem;
          justify-content: center;
        }

        .btn {
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
          text-align: center;
          transition: all 0.2s;
        }

        .btn-primary {
          background: #4f46e5;
          color: white;
        }

        .btn-primary:hover {
          background: #4338ca;
        }

        .btn-outline {
          background: transparent;
          color: #4f46e5;
          border: 1px solid #4f46e5;
        }

        .btn-outline:hover {
          background: #4f46e5;
          color: white;
        }

        @media (max-width: 768px) {
          .user-transactions {
            padding: 1rem;
          }

          .transfer-options {
            grid-template-columns: 1fr;
          }

          .section-header {
            flex-direction: column;
            align-items: flex-start;
          }

          .transactions-summary {
            flex-direction: column;
            align-items: flex-start;
          }

          .summary-item {
            flex-direction: row;
            justify-content: space-between;
            width: 100%;
            min-width: auto;
          }

          .transaction-item {
            flex-wrap: wrap;
            gap: 0.5rem;
          }

          .transaction-date {
            min-width: 50px;
          }

          .transaction-meta {
            flex-wrap: wrap;
            gap: 0.5rem;
          }

          .transactions-actions {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}
