# Banking API - cURL Examples

This document contains individual cURL commands to test the banking APIs as an end user.

## Base Configuration
```bash
API_BASE="http://localhost:3001"
```

## 1. Authentication

### Login as Admin
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### Login as Customer
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"john.doe","password":"password123"}'
```

### Get Current User
```bash
curl -X GET http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

## 2. User Management

### Get All Users (Admin Only)
```bash
curl -X GET http://localhost:3001/api/users \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Get Specific User
```bash
curl -X GET http://localhost:3001/api/users/1 \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Search Users (Admin Only)
```bash
curl -X GET http://localhost:3001/api/users/search/john \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

## 3. Account Management

### Get All Accounts (Admin Only)
```bash
curl -X GET http://localhost:3001/api/accounts \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Get User's Accounts
```bash
curl -X GET http://localhost:3001/api/accounts/user/1 \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Get Account Details
```bash
curl -X GET http://localhost:3001/api/accounts/1 \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Check Account Balance
```bash
curl -X GET http://localhost:3001/api/accounts/1/balance \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Create New Account (Admin Only)
```bash
curl -X POST http://localhost:3001/api/accounts \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "1",
    "accountType": "savings",
    "initialBalance": 5000,
    "currency": "USD"
  }'
```

### Deposit Money (Admin Only)
```bash
curl -X POST http://localhost:3001/api/accounts/1/deposit \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 500,
    "description": "Test deposit"
  }'
```

### Withdraw Money (Admin Only)
```bash
curl -X POST http://localhost:3001/api/accounts/1/withdraw \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 200,
    "description": "Test withdrawal"
  }'
```

## 4. Transaction Operations

### Get All Transactions (Admin Only)
```bash
curl -X GET http://localhost:3001/api/transactions \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Get User's Transactions
```bash
curl -X GET http://localhost:3001/api/transactions/user/1 \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Get Account Transactions
```bash
curl -X GET http://localhost:3001/api/transactions/account/1 \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Transfer Money
```bash
curl -X POST http://localhost:3001/api/transactions/transfer \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "fromAccountId": "1",
    "toAccountId": "3",
    "amount": 100,
    "description": "Test transfer"
  }'
```

### Create Transaction (Admin Only)
```bash
curl -X POST http://localhost:3001/api/transactions \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "fromAccountId": "1",
    "toAccountId": "2",
    "amount": 150,
    "type": "transfer",
    "description": "Manual transfer",
    "userId": "1"
  }'
```

### Search Transactions (Admin Only)
```bash
curl -X GET http://localhost:3001/api/transactions/search/transfer \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

## 5. Admin Functions

### Get System Statistics
```bash
curl -X GET http://localhost:3001/api/admin/stats \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Get Activity Logs
```bash
curl -X GET http://localhost:3001/api/admin/activity?page=1&limit=50 \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Get Recent Activity
```bash
curl -X GET http://localhost:3001/api/admin/activity/recent?hours=24 \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Get Activity Summary
```bash
curl -X GET http://localhost:3001/api/admin/activity/summary \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Get User Activity Summary
```bash
curl -X GET http://localhost:3001/api/admin/activity/users/summary \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Export Activity Logs (CSV)
```bash
curl -X GET http://localhost:3001/api/admin/activity/export \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  --output activity_logs.csv
```

### Clear Old Activity Logs
```bash
curl -X DELETE http://localhost:3001/api/admin/activity/clear?days=30 \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

## 6. Error Testing

### Try to Access Admin Endpoint as Customer
```bash
curl -X GET http://localhost:3001/api/admin/stats \
  -H "Authorization: Bearer <CUSTOMER_TOKEN>"
```

### Try to Transfer More Than Available Balance
```bash
curl -X POST http://localhost:3001/api/transactions/transfer \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "fromAccountId": "1",
    "toAccountId": "3",
    "amount": 1000000,
    "description": "Insufficient funds test"
  }'
```

### Try to Access Another User's Data
```bash
curl -X GET http://localhost:3001/api/users/2 \
  -H "Authorization: Bearer <CUSTOMER_TOKEN>"
```

## 7. Complete Workflow Example

Here's a complete workflow example:

```bash
# 1. Login as admin
ADMIN_RESPONSE=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')

# 2. Extract token
ADMIN_TOKEN=$(echo $ADMIN_RESPONSE | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# 3. Get system stats
curl -X GET http://localhost:3001/api/admin/stats \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 4. Transfer money
curl -X POST http://localhost:3001/api/transactions/transfer \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fromAccountId": "1",
    "toAccountId": "3",
    "amount": 50,
    "description": "Workflow test transfer"
  }'

# 5. Check updated balances
curl -X GET http://localhost:3001/api/accounts/1/balance \
  -H "Authorization: Bearer $ADMIN_TOKEN"

curl -X GET http://localhost:3001/api/accounts/3/balance \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## 8. Sample Data Reference

### Available Users
- **Admin**: `admin` / `admin123`
- **John Doe**: `john.doe` / `password123`
- **Jane Smith**: `jane.smith` / `password123`
- **Mike Johnson**: `mike.johnson` / `password123`

### Available Accounts
- Account ID 1: Checking account for John Doe
- Account ID 2: Savings account for John Doe
- Account ID 3: Checking account for Jane Smith
- Account ID 4: Savings account for Jane Smith
- Account ID 5: Checking account for Mike Johnson

### Account Types
- `checking`: Regular checking accounts
- `savings`: Savings accounts

### Transaction Types
- `transfer`: Money transfer between accounts
- `deposit`: Money deposited to account
- `withdrawal`: Money withdrawn from account

## 9. Response Format Examples

### Successful Login Response
```json
{
  "message": "Login successful",
  "token": "<TOKEN>",
  "user": {
    "id": "4",
    "username": "admin",
    "email": "admin@bank.com",
    "firstName": "Admin",
    "lastName": "User",
    "role": "admin",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "isActive": true
  }
}
```

### Error Response
```json
{
  "error": "Invalid credentials"
}
```

### System Statistics Response
```json
{
  "stats": {
    "totalUsers": 4,
    "activeUsers": 4,
    "totalAccounts": 5,
    "activeAccounts": 5,
    "totalTransactions": 6,
    "totalActivityLogs": 6,
    "totalBalance": 31001.5,
    "averageBalance": 6200.3
  }
}
```
