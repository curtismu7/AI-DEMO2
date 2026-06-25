const bcrypt = require('bcryptjs');
const { roundToCents } = require('../utils/money');

// Seed-account passwords for the local password-login store (routes/auth.js POST
// /login). The UI authenticates via PingOne OAuth, not this path, but the seeded
// accounts still grant a real session — so let operators override the defaults on
// a fresh install instead of shipping the same well-known demo credentials.
const SEED_CUSTOMER_PASSWORD = process.env.SEED_CUSTOMER_PASSWORD || 'password123';
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'admin123';

// Sample users with hashed passwords
const sampleUsers = [
  {
    id: '1',
    username: 'john.doe',
    email: 'john.doe@example.com',
    firstName: 'John',
    lastName: 'Doe',
    password: bcrypt.hashSync(SEED_CUSTOMER_PASSWORD, 10),
    role: 'customer',
    createdAt: new Date('2024-01-15'),
    isActive: true
  },
  {
    id: '2',
    username: 'jane.smith',
    email: 'jane.smith@example.com',
    firstName: 'Jane',
    lastName: 'Smith',
    password: bcrypt.hashSync(SEED_CUSTOMER_PASSWORD, 10),
    role: 'customer',
    createdAt: new Date('2024-01-20'),
    isActive: true
  },
  {
    id: '3',
    username: 'mike.johnson',
    email: 'mike.johnson@example.com',
    firstName: 'Mike',
    lastName: 'Johnson',
    password: bcrypt.hashSync(SEED_CUSTOMER_PASSWORD, 10),
    role: 'customer',
    createdAt: new Date('2024-02-01'),
    isActive: true
  },
  {
    id: '4',
    username: 'admin',
    email: 'admin@bank.com',
    firstName: 'Admin',
    lastName: 'User',
    password: bcrypt.hashSync(SEED_ADMIN_PASSWORD, 10),
    role: 'admin',
    createdAt: new Date('2024-01-01'),
    isActive: true
  }
];

// Sample accounts
const sampleAccounts = [
  {
    id: '1',
    userId: '1',
    accountNumber: '1001-2345-6789',
    accountType: 'checking',
    balance: 2500.00,
    currency: 'USD',
    createdAt: new Date('2024-01-15'),
    isActive: true
  },
  {
    id: '2',
    userId: '1',
    accountNumber: '1001-2345-6790',
    accountType: 'savings',
    balance: 15000.00,
    currency: 'USD',
    createdAt: new Date('2024-01-15'),
    isActive: true
  },
  {
    id: '3',
    userId: '2',
    accountNumber: '1002-3456-7890',
    accountType: 'checking',
    balance: 3200.50,
    currency: 'USD',
    createdAt: new Date('2024-01-20'),
    isActive: true
  },
  {
    id: '4',
    userId: '2',
    accountNumber: '1002-3456-7891',
    accountType: 'savings',
    balance: 8500.75,
    currency: 'USD',
    createdAt: new Date('2024-01-20'),
    isActive: true
  },
  {
    id: '5',
    userId: '3',
    accountNumber: '1003-4567-8901',
    accountType: 'checking',
    balance: 1800.25,
    currency: 'USD',
    createdAt: new Date('2024-02-01'),
    isActive: true
  }
];

// Sample transactions with merchant categories for LLM queries
const transactionMerchants = [
  // Groceries
  { name: 'Whole Foods', category: 'groceries', amounts: [45, 67, 89, 120] },
  { name: 'Trader Joe\'s', category: 'groceries', amounts: [35, 52, 78] },
  { name: 'Safeway', category: 'groceries', amounts: [40, 65, 95, 110] },
  // Gas
  { name: 'Shell Gas', category: 'gas', amounts: [45, 55, 60] },
  { name: 'Chevron', category: 'gas', amounts: [50, 58, 62] },
  { name: 'Exxon Mobil', category: 'gas', amounts: [48, 56, 65] },
  // Dining
  { name: 'Olive Garden', category: 'dining', amounts: [35, 55, 75] },
  { name: 'Chipotle', category: 'dining', amounts: [12, 15, 18] },
  { name: 'Starbucks', category: 'dining', amounts: [5, 7, 9] },
  { name: 'McDonald\'s', category: 'dining', amounts: [8, 12, 16] },
  // Retail
  { name: 'Target', category: 'retail', amounts: [25, 45, 80, 120] },
  { name: 'Walmart', category: 'retail', amounts: [30, 50, 75, 95] },
  { name: 'Best Buy', category: 'retail', amounts: [60, 120, 250, 400] },
];

function generateUserTransactions(userId, count = 80, nextId = null) {
  const txns = [];
  let localId = 1;
  const id = nextId ? nextId : () => String(localId++);
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const accountId = userId === '3' ? '5' : userId === '2' ? '3' : '1';

  // Salary deposits — monthly on roughly the 1st and 15th
  for (let m = 0; m < 12; m++) {
    const base = new Date(yearAgo);
    base.setMonth(base.getMonth() + m);
    [1, 15].forEach((day) => {
      const d = new Date(base);
      d.setDate(day);
      if (d <= now) {
        txns.push({
          id: id(),
          fromAccountId: null,
          toAccountId: accountId,
          amount: userId === '1' ? 2800 : userId === '2' ? 3200 : 2200,
          type: 'deposit',
          description: 'Payroll Deposit',
          merchant: null,
          category: 'income',
          status: 'completed',
          createdAt: new Date(d.setHours(9, 0, 0, 0)),
          userId,
        });
      }
    });
  }

  // Recurring spending spread over the year
  for (let i = 0; i < count; i++) {
    const merchant = transactionMerchants[Math.floor(Math.random() * transactionMerchants.length)];
    const msOffset = Math.floor(Math.random() * (now.getTime() - yearAgo.getTime()));
    const date = new Date(yearAgo.getTime() + msOffset);
    date.setSeconds(0, 0);

    txns.push({
      id: id(),
      fromAccountId: accountId,
      toAccountId: null,
      amount: merchant.amounts[Math.floor(Math.random() * merchant.amounts.length)],
      type: 'purchase',
      description: merchant.name,
      merchant: merchant.name,
      category: merchant.category,
      status: 'completed',
      createdAt: date,
      userId,
    });
  }

  // A few transfers between accounts (user 1 only — has checking + savings)
  if (userId === '1') {
    for (let m = 0; m < 6; m++) {
      const d = new Date(yearAgo);
      d.setMonth(d.getMonth() + m * 2);
      d.setDate(20);
      if (d <= now) {
        txns.push({
          id: id(),
          fromAccountId: '1',
          toAccountId: '2',
          amount: 500,
          type: 'transfer',
          description: 'Transfer to Savings',
          merchant: null,
          category: 'transfer',
          status: 'completed',
          createdAt: new Date(d.setHours(18, 0, 0, 0)),
          userId,
        });
      }
    }
  }

  return txns.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

let _txnIdCounter = 1;
function nextTxnId() { return String(_txnIdCounter++); }

const sampleTransactions = [
  ...generateUserTransactions('1', 80, nextTxnId),
  ...generateUserTransactions('2', 80, nextTxnId),
  ...generateUserTransactions('3', 80, nextTxnId),
];

// Activity logs
const sampleActivityLogs = [
  {
    id: '1',
    userId: '1',
    username: 'john.doe',
    action: 'LOGIN',
    endpoint: '/api/auth/login',
    timestamp: new Date('2024-03-01T08:30:00Z'),
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },
  {
    id: '2',
    userId: '1',
    username: 'john.doe',
    action: 'CHECK_BALANCE',
    endpoint: '/api/accounts/1/balance',
    timestamp: new Date('2024-03-01T08:35:00Z'),
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },
  {
    id: '3',
    userId: '1',
    username: 'john.doe',
    action: 'TRANSFER_MONEY',
    endpoint: '/api/transactions',
    timestamp: new Date('2024-03-01T10:30:00Z'),
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },
  {
    id: '4',
    userId: '2',
    username: 'jane.smith',
    action: 'LOGIN',
    endpoint: '/api/auth/login',
    timestamp: new Date('2024-03-02T09:15:00Z'),
    ipAddress: '192.168.1.101',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  },
  {
    id: '5',
    userId: '2',
    username: 'jane.smith',
    action: 'GET_TRANSACTIONS',
    endpoint: '/api/transactions',
    timestamp: new Date('2024-03-02T09:20:00Z'),
    ipAddress: '192.168.1.101',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  }
];

// Generate realistic banking data for demo
function generateRealisticBankingData() {
  const firstNames = ['John', 'Jane', 'Mike', 'Sarah', 'David', 'Emma', 'Robert', 'Lisa', 'James', 'Maria', 'William', 'Patricia', 'Richard', 'Jennifer', 'Thomas', 'Mary', 'Charles', 'Karen', 'Christopher', 'Nancy'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
  const accountTypes = ['checking', 'savings', 'money_market', 'credit_card'];
  const transactions = ['salary_deposit', 'groceries', 'utilities', 'rent', 'entertainment', 'gas', 'restaurant', 'online_purchase', 'transfer', 'withdrawal', 'atm_withdrawal'];

  const users = [];
  const accounts = [];
  const txns = [];

  // Generate 250 realistic users.
  // bcrypt.hashSync at rounds=10 costs ~60ms each — hoist out of the loop so
  // the 250-iteration init goes from ~15s to ~60ms. All generated users share
  // the same demo password ('password123') anyway, so a shared hash is correct.
  // bcrypt.compareSync still works against any valid hash for that plaintext.
  const SHARED_DEMO_HASH = bcrypt.hashSync('password123', 10);
  for (let i = 1; i <= 250; i++) {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    users.push({
      id: String(i + 4),
      username: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Math.random() > 0.5 ? i : ''}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
      firstName,
      lastName,
      password: SHARED_DEMO_HASH,
      role: 'customer',
      createdAt: new Date(2024, 0, Math.floor(Math.random() * 60) + 1),
      isActive: Math.random() > 0.1
    });
  }

  // Generate 600+ accounts with realistic balances
  let accountId = 6;
  for (let i = 1; i <= 250; i++) {
    const numAccounts = Math.floor(Math.random() * 4) + 1;
    for (let j = 0; j < numAccounts; j++) {
      const accountType = accountTypes[Math.floor(Math.random() * accountTypes.length)];
      let balance;

      // Realistic balance distribution
      if (accountType === 'checking') {
        balance = Math.random() * 15000 + 500; // $500-$15,500
      } else if (accountType === 'savings') {
        balance = Math.random() * 100000 + 5000; // $5,000-$105,000
      } else if (accountType === 'money_market') {
        balance = Math.random() * 150000 + 10000; // $10,000-$160,000
      } else {
        balance = Math.random() * 10000 + 1000; // Credit card: $1,000-$11,000
      }

      accounts.push({
        id: String(accountId),
        userId: String(i + 4),
        accountNumber: `${1000 + i}-${Math.floor(Math.random() * 10000)}-${Math.floor(Math.random() * 10000)}`,
        accountType,
        balance: roundToCents(balance),
        currency: 'USD',
        createdAt: new Date(2024, Math.floor(Math.random() * 2), Math.floor(Math.random() * 28) + 1),
        isActive: Math.random() > 0.05
      });
      accountId++;
    }
  }

  // Generate 2000+ realistic transactions
  let txnId = 7;
  const activityLogs = [];
  const actions = ['LOGIN', 'CHECK_BALANCE', 'TRANSFER_MONEY', 'GET_TRANSACTIONS', 'CREATE_DEPOSIT', 'CREATE_WITHDRAWAL', 'VIEW_ACCOUNT', 'UPDATE_PROFILE'];

  for (let i = 0; i < 2000; i++) {
    const fromAccountIdx = Math.floor(Math.random() * (accounts.length - 1));
    const toAccountIdx = Math.floor(Math.random() * (accounts.length - 1));

    const txnType = transactions[Math.floor(Math.random() * transactions.length)];
    let amount;

    if (['salary_deposit'].includes(txnType)) {
      amount = Math.random() * 3000 + 2000; // $2000-$5000
    } else if (['rent'].includes(txnType)) {
      amount = Math.random() * 1500 + 800; // $800-$2300
    } else if (['utilities'].includes(txnType)) {
      amount = Math.random() * 300 + 50; // $50-$350
    } else if (['groceries'].includes(txnType)) {
      amount = Math.random() * 200 + 20; // $20-$220
    } else {
      amount = Math.random() * 500 + 10; // $10-$510
    }

    txns.push({
      id: String(txnId),
      fromAccountId: Math.random() > 0.3 ? String(accounts[fromAccountIdx].id) : null,
      toAccountId: Math.random() > 0.3 ? String(accounts[toAccountIdx].id) : null,
      amount: roundToCents(amount),
      type: Math.random() > 0.6 ? 'transfer' : (Math.random() > 0.5 ? 'deposit' : 'withdrawal'),
      description: txnType.replace(/_/g, ' '),
      status: Math.random() > 0.05 ? 'completed' : 'pending',
      createdAt: new Date(2024, Math.floor(Math.random() * 2), Math.floor(Math.random() * 28) + 1, Math.floor(Math.random() * 24), Math.floor(Math.random() * 60)),
      userId: String(accounts[Math.floor(Math.random() * accounts.length)].userId)
    });
    txnId++;
  }

  // Generate 500+ realistic activity logs
  let logId = 6;
  for (let i = 0; i < 500; i++) {
    const randomUser = users[Math.floor(Math.random() * users.length)];
    const action = actions[Math.floor(Math.random() * actions.length)];

    activityLogs.push({
      id: String(logId),
      userId: randomUser.id,
      username: randomUser.username,
      action,
      endpoint: `/api/${Math.random() > 0.5 ? 'accounts' : 'transactions'}${Math.random() > 0.7 ? '/my' : ''}`,
      timestamp: new Date(2024, Math.floor(Math.random() * 2), Math.floor(Math.random() * 28) + 1, Math.floor(Math.random() * 24), Math.floor(Math.random() * 60)),
      ipAddress: `192.168.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    logId++;
  }

  return { users, accounts, txns, activityLogs };
}

// Generate realistic data
const realisticData = generateRealisticBankingData();

// Sample subscription records — one per demo user
const sampleSubscriptions = [
  {
    id: 'sub-1',
    userId: '1',
    name: 'Netflix',
    amount: 15.99,
    currency: 'USD',
    billingCycle: 'monthly',
    status: 'active',
    accountId: null,
    createdAt: new Date('2024-01-15'),
    nextBillingDate: new Date('2024-04-15'),
  },
  {
    id: 'sub-2',
    userId: '1',
    name: 'Spotify',
    amount: 9.99,
    currency: 'USD',
    billingCycle: 'monthly',
    status: 'active',
    accountId: null,
    createdAt: new Date('2024-02-01'),
    nextBillingDate: new Date('2024-04-01'),
  },
  {
    id: 'sub-3',
    userId: '2',
    name: 'Adobe Creative Cloud',
    amount: 54.99,
    currency: 'USD',
    billingCycle: 'monthly',
    status: 'active',
    accountId: null,
    createdAt: new Date('2024-01-20'),
    nextBillingDate: new Date('2024-04-20'),
  },
];

module.exports = {
  sampleUsers: [...sampleUsers, ...realisticData.users],
  sampleAccounts: [...sampleAccounts, ...realisticData.accounts],
  sampleTransactions: [...sampleTransactions, ...realisticData.txns],
  sampleActivityLogs: [...sampleActivityLogs, ...realisticData.activityLogs],
  sampleSubscriptions,
};
