# 🏦 Banking API - Quick Reference

## 🔑 Authentication
```bash
# Login as Admin
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Login as Customer
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"john.doe","password":"password123"}'
```

## 💰 Core Banking Operations

### Check Balance
```bash
curl -X GET http://localhost:3001/api/accounts/1/balance \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Transfer Money
```bash
curl -X POST http://localhost:3001/api/transactions/transfer \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fromAccountId": "1",
    "toAccountId": "3",
    "amount": 100,
    "description": "Payment"
  }'
```

### Get Transaction History
```bash
curl -X GET http://localhost:3001/api/transactions/user/1 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 🛡️ Admin Functions

### System Statistics
```bash
curl -X GET http://localhost:3001/api/admin/stats \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### Activity Logs
```bash
curl -X GET http://localhost:3001/api/admin/activity?page=1&limit=10 \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### Export Activity Logs
```bash
curl -X GET http://localhost:3001/api/admin/activity/export \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  --output activity_logs.csv
```

## 📊 Sample Data

### Users
- **Admin**: `admin` / `admin123`
- **John Doe**: `john.doe` / `password123`
- **Jane Smith**: `jane.smith` / `password123`
- **Mike Johnson**: `mike.johnson` / `password123`

### Accounts
- **Account 1**: John's checking ($2,450)
- **Account 2**: John's savings ($15,000)
- **Account 3**: Jane's checking ($3,250.50)
- **Account 4**: Jane's savings ($8,500.75)
- **Account 5**: Mike's checking ($1,800.25)

## 🚀 Quick Test Workflow

```bash
# 1. Login and get token
RESPONSE=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')

TOKEN=$(echo $RESPONSE | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# 2. Check system stats
curl -X GET http://localhost:3001/api/admin/stats \
  -H "Authorization: Bearer $TOKEN"

# 3. Make a transfer
curl -X POST http://localhost:3001/api/transactions/transfer \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fromAccountId":"1","toAccountId":"3","amount":25,"description":"Quick test"}'
```

## 📝 Common Response Codes

- `200` - Success
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

## 🔧 Testing Tools

- **Full Test Script**: `./test-api.sh`
- **Individual Commands**: `curl-examples.md`
- **Admin Dashboard**: http://localhost:3000
- **API Base URL**: http://localhost:3001
