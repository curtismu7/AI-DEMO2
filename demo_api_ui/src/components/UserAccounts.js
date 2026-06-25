// banking_api_ui/src/components/UserAccounts.js
import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';

export default function UserAccounts({ user }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate loading user accounts
    const loadAccounts = async () => {
      try {
        // In a real implementation, this would fetch from an API
        const mockAccounts = [
          {
            id: 'chk-12345',
            type: 'checking',
            name: 'Primary Checking',
            balance: 5432.18,
            accountNumber: '****1234',
            status: 'active'
          },
          {
            id: 'sav-67890',
            type: 'savings',
            name: 'Emergency Savings',
            balance: 12750.43,
            accountNumber: '****6789',
            status: 'active'
          },
          {
            id: 'sav-11111',
            type: 'savings',
            name: 'Vacation Fund',
            balance: 2341.67,
            accountNumber: '****1111',
            status: 'active'
          }
        ];
        
        setTimeout(() => {
          setAccounts(mockAccounts);
          setLoading(false);
        }, 500);
      } catch (error) {
        toast.error('Failed to load accounts');
        setLoading(false);
      }
    };

    loadAccounts();
  }, []);

  const handleAction = (action, account) => {
    toast.info(`${action} for account ${account.name} - This would open the appropriate flow`);
  };

  const totalBalance = accounts.reduce((sum, account) => sum + account.balance, 0);

  if (loading) {
    return (
      <div className="user-accounts">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading your accounts...</p>
        </div>
        <style jsx>{`
          .user-accounts {
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
    <div className="user-accounts">
      <div className="accounts-header">
        <h2>My Accounts</h2>
        <p>Manage your checking and savings accounts</p>
      </div>

      <div className="accounts-summary">
        <div className="summary-card">
          <div className="summary-icon">💰</div>
          <div className="summary-content">
            <div className="summary-label">Total Balance</div>
            <div className="summary-value">${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">📊</div>
          <div className="summary-content">
            <div className="summary-label">Total Accounts</div>
            <div className="summary-value">{accounts.length}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">✅</div>
          <div className="summary-content">
            <div className="summary-label">Active Accounts</div>
            <div className="summary-value">{accounts.filter(a => a.status === 'active').length}</div>
          </div>
        </div>
      </div>

      <div className="accounts-list">
        <h3>Account Details</h3>
        <div className="accounts-grid">
          {accounts.map(account => (
            <div key={account.id} className="account-card">
              <div className="account-header">
                <div className="account-type">
                  <span className="type-icon">{account.type === 'checking' ? '💳' : '🏦'}</span>
                  <span className="type-label">{account.type === 'checking' ? 'Checking' : 'Savings'}</span>
                </div>
                <div className="account-status">
                  <span className={`status-badge ${account.status}`}>{account.status}</span>
                </div>
              </div>

              <div className="account-info">
                <h4>{account.name}</h4>
                <p className="account-number">{account.accountNumber}</p>
              </div>

              <div className="account-balance">
                <div className="balance-label">Current Balance</div>
                <div className="balance-amount">${account.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>

              <div className="account-actions">
                <button 
                  type="button"
                  onClick={() => handleAction('View Details', account)}
                  className="btn btn-outline btn-sm"
                >
                  View Details
                </button>
                <button 
                  type="button"
                  onClick={() => handleAction('Transfer Money', account)}
                  className="btn btn-primary btn-sm"
                >
                  Transfer
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="accounts-actions">
        <h3>Quick Actions</h3>
        <div className="action-grid">
          <button 
            type="button"
            onClick={() => handleAction('Open New Account', {})}
            className="action-card"
          >
            <span className="action-icon">➕</span>
            <span className="action-title">Open New Account</span>
            <span className="action-desc">Apply for a new checking or savings account</span>
          </button>
          <button 
            type="button"
            onClick={() => handleAction('Schedule Transfer', {})}
            className="action-card"
          >
            <span className="action-icon">📅</span>
            <span className="action-title">Schedule Transfer</span>
            <span className="action-desc">Set up recurring transfers between accounts</span>
          </button>
          <button 
            type="button"
            onClick={() => handleAction('Download Statements', {})}
            className="action-card"
          >
            <span className="action-icon">📄</span>
            <span className="action-title">Download Statements</span>
            <span className="action-desc">Get your account statements and documents</span>
          </button>
          <button 
            type="button"
            onClick={() => handleAction('Account Settings', {})}
            className="action-card"
          >
            <span className="action-icon">⚙️</span>
            <span className="action-title">Account Settings</span>
            <span className="action-desc">Manage account preferences and notifications</span>
          </button>
        </div>
      </div>

      <style jsx>{`
        .user-accounts {
          max-width: 1000px;
          margin: 0 auto;
          padding: 2rem;
        }

        .accounts-header {
          margin-bottom: 2rem;
        }

        .accounts-header h2 {
          margin: 0 0 0.5rem 0;
          color: #333;
        }

        .accounts-header p {
          margin: 0;
          color: #666;
        }

        .accounts-summary {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .summary-card {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.5rem;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .summary-icon {
          font-size: 2rem;
        }

        .summary-label {
          font-size: 0.875rem;
          color: #666;
        }

        .summary-value {
          font-size: 1.5rem;
          font-weight: 600;
          color: #333;
        }

        .accounts-list h3 {
          margin: 0 0 1.5rem 0;
          color: #333;
        }

        .accounts-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2rem;
        }

        .account-card {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .account-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .account-type {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .type-icon {
          font-size: 1.2rem;
        }

        .type-label {
          font-weight: 600;
          color: #333;
        }

        .status-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .status-badge.active {
          background: #f0fdf4;
          color: #10b981;
        }

        .account-info h4 {
          margin: 0 0 0.25rem 0;
          color: #333;
        }

        .account-number {
          margin: 0;
          color: #666;
          font-size: 0.875rem;
        }

        .account-balance {
          padding: 1rem;
          background: #f9fafb;
          border-radius: 6px;
        }

        .balance-label {
          font-size: 0.875rem;
          color: #666;
          margin-bottom: 0.25rem;
        }

        .balance-amount {
          font-size: 1.5rem;
          font-weight: 600;
          color: #333;
        }

        .account-actions {
          display: flex;
          gap: 0.75rem;
        }

        .accounts-actions h3 {
          margin: 0 0 1.5rem 0;
          color: #333;
        }

        .action-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1rem;
        }

        .action-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
          padding: 1.5rem;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .action-card:hover {
          border-color: #4f46e5;
          box-shadow: 0 2px 8px rgba(79, 70, 229, 0.1);
        }

        .action-icon {
          font-size: 2rem;
        }

        .action-title {
          font-weight: 600;
          color: #333;
          text-align: center;
        }

        .action-desc {
          font-size: 0.875rem;
          color: #666;
          text-align: center;
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

        .btn-sm {
          padding: 0.5rem 1rem;
          font-size: 0.875rem;
        }

        @media (max-width: 768px) {
          .user-accounts {
            padding: 1rem;
          }

          .accounts-summary {
            grid-template-columns: 1fr;
          }

          .accounts-grid {
            grid-template-columns: 1fr;
          }

          .action-grid {
            grid-template-columns: 1fr;
          }

          .account-actions {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}
