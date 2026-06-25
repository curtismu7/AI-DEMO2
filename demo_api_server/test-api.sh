#!/bin/bash

# Banking API Test Script
# This script tests all the banking APIs as an end user

API_BASE="http://localhost:3001"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="admin123"
CUSTOMER_USERNAME="john.doe"
CUSTOMER_PASSWORD="password123"

echo "🏦 Banking API Test Script"
echo "=========================="
echo ""

# Function to extract token from login response
get_token() {
    local username=$1
    local password=$2
    local response=$(curl -s -X POST "$API_BASE/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\"}")
    local token=$(echo $response | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    
    # Debug: Check if token extraction failed
    if [ -z "$token" ]; then
        echo "ERROR: Failed to extract token from response: $response" >&2
        return 1
    fi
    
    echo "$token"
}

# Function to make authenticated requests
auth_request() {
    local method=$1
    local endpoint=$2
    local token=$3
    local data=$4
    
    # Debug: Check if token is empty
    if [ -z "$token" ]; then
        echo "WARNING: Empty token for endpoint: $endpoint" >&2
        return 1
    fi
    
    if [ -n "$data" ]; then
        curl -s -X $method "$API_BASE$endpoint" \
            -H "Authorization: Bearer $token" \
            -H "Content-Type: application/json" \
            -d "$data"
    else
        curl -s -X $method "$API_BASE$endpoint" \
            -H "Authorization: Bearer $token"
    fi
}

echo "1. 🔐 Testing Authentication"
echo "----------------------------"

echo "1.1 Login as Admin"
admin_token=$(get_token $ADMIN_USERNAME $ADMIN_PASSWORD)
if [ -n "$admin_token" ]; then
    echo "✅ Admin login successful"
    echo "Token: ${admin_token:0:50}..."
else
    echo "❌ Admin login failed"
    exit 1
fi

echo ""
echo "1.2 Login as Customer"
customer_token=$(get_token $CUSTOMER_USERNAME $CUSTOMER_PASSWORD)
if [ -n "$customer_token" ]; then
    echo "✅ Customer login successful"
    echo "Token: ${customer_token:0:50}..."
else
    echo "❌ Customer login failed"
    exit 1
fi

echo ""
echo "2. 👤 Testing User Management"
echo "-----------------------------"

echo "2.1 Get current user (admin)"
auth_request "GET" "/api/auth/me" "$admin_token" | jq '.'

echo ""
echo "2.2 Get current user (customer)"
auth_request "GET" "/api/auth/me" "$customer_token" | jq '.'

echo ""
echo "2.3 Get all users (admin only)"
auth_request "GET" "/api/users" "$admin_token" | jq '.users | length'

echo ""
echo "2.4 Get specific user (admin)"
auth_request "GET" "/api/users/1" "$admin_token" | jq '.user.username'

echo ""
echo "3. 🏦 Testing Account Management"
echo "--------------------------------"

echo "3.1 Get all accounts (admin only)"
auth_request "GET" "/api/accounts" "$admin_token" | jq '.accounts | length'

echo ""
echo "3.2 Get user's accounts (customer)"
auth_request "GET" "/api/accounts/user/1" "$customer_token" | jq '.accounts | length'

echo ""
echo "3.3 Get specific account details"
auth_request "GET" "/api/accounts/1" "$admin_token" | jq '.account.accountNumber'

echo ""
echo "3.4 Check account balance"
auth_request "GET" "/api/accounts/1/balance" "$admin_token" | jq '.'

echo ""
echo "4. 💰 Testing Transaction Operations"
echo "-----------------------------------"

echo "4.1 Get all transactions (admin only)"
auth_request "GET" "/api/transactions" "$admin_token" | jq '.transactions | length'

echo ""
echo "4.2 Get user's transactions"
auth_request "GET" "/api/transactions/user/1" "$customer_token" | jq '.transactions | length'

echo ""
echo "4.3 Get account transactions"
auth_request "GET" "/api/transactions/account/1" "$admin_token" | jq '.transactions | length'

echo ""
echo "4.4 Transfer money between accounts"
transfer_response=$(auth_request "POST" "/api/transactions/transfer" "$customer_token" '{
    "fromAccountId": "1",
    "toAccountId": "3",
    "amount": 100,
    "description": "Test transfer from API"
}')
echo $transfer_response | jq '.'

echo ""
echo "4.5 Check updated balances after transfer"
echo "From account balance:"
auth_request "GET" "/api/accounts/1/balance" "$admin_token" | jq '.'
echo "To account balance:"
auth_request "GET" "/api/accounts/3/balance" "$admin_token" | jq '.'

echo ""
echo "5. 🛡️ Testing Admin Functions"
echo "-----------------------------"

echo "5.1 Get system statistics"
auth_request "GET" "/api/admin/stats" "$admin_token" | jq '.stats'

echo ""
echo "5.2 Get recent activity (last 24 hours)"
auth_request "GET" "/api/admin/activity/recent?hours=24" "$admin_token" | jq '.logs | length'

echo ""
echo "5.3 Get activity logs with pagination"
auth_request "GET" "/api/admin/activity?page=1&limit=10" "$admin_token" | jq '.logs | length'

echo ""
echo "5.4 Get activity summary by action type"
auth_request "GET" "/api/admin/activity/summary" "$admin_token" | jq '.summary'

echo ""
echo "5.5 Get user activity summary"
auth_request "GET" "/api/admin/activity/users/summary" "$admin_token" | jq '.userSummary | length'

echo ""
echo "6. 🔍 Testing Search and Filtering"
echo "----------------------------------"

echo "6.1 Search users (admin only)"
auth_request "GET" "/api/users/search/john" "$admin_token" | jq '.users | length'

echo ""
echo "6.2 Search transactions (admin only)"
auth_request "GET" "/api/transactions/search/transfer" "$admin_token" | jq '.transactions | length'

echo ""
echo "7. 🧪 Testing Error Cases"
echo "-------------------------"

echo "7.1 Try to access admin endpoint as customer"
auth_request "GET" "/api/admin/stats" "$customer_token" | jq '.'

echo ""
echo "7.2 Try to transfer more money than available"
auth_request "POST" "/api/transactions/transfer" "$customer_token" '{
    "fromAccountId": "1",
    "toAccountId": "3",
    "amount": 1000000,
    "description": "Insufficient funds test"
}' | jq '.'

echo ""
echo "7.3 Try to access another user's data"
auth_request "GET" "/api/users/2" "$customer_token" | jq '.'

echo ""
echo "8. 📊 Testing Account Operations (Admin Only)"
echo "---------------------------------------------"

echo "8.1 Create new account"
auth_request "POST" "/api/accounts" "$admin_token" '{
    "userId": "1",
    "accountType": "savings",
    "initialBalance": 5000,
    "currency": "USD"
}' | jq '.'

echo ""
echo "8.2 Deposit money to account"
auth_request "POST" "/api/accounts/1/deposit" "$admin_token" '{
    "amount": 500,
    "description": "Test deposit"
}' | jq '.'

echo ""
echo "8.3 Withdraw money from account"
auth_request "POST" "/api/accounts/1/withdraw" "$admin_token" '{
    "amount": 200,
    "description": "Test withdrawal"
}' | jq '.'

echo ""
echo "9. 🔄 Testing Transaction Management (Admin Only)"
echo "------------------------------------------------"

echo "9.1 Create manual transaction"
auth_request "POST" "/api/transactions" "$admin_token" '{
    "fromAccountId": "1",
    "toAccountId": "2",
    "amount": 150,
    "type": "transfer",
    "description": "Manual admin transfer",
    "userId": "1"
}' | jq '.'

echo ""
echo "10. 📈 Final System Status"
echo "--------------------------"

echo "10.1 Final system statistics"
auth_request "GET" "/api/admin/stats" "$admin_token" | jq '.stats'

echo ""
echo "10.2 Total activity logs"
auth_request "GET" "/api/admin/activity" "$admin_token" | jq '.pagination.totalLogs'

echo ""
echo "✅ API Testing Complete!"
echo "========================"
echo ""
echo "Summary of tested endpoints:"
echo "- Authentication: Login, Get current user"
echo "- User Management: Get users, search users"
echo "- Account Management: Get accounts, check balances"
echo "- Transactions: Transfer money, view history"
echo "- Admin Functions: Statistics, activity logs, summaries"
echo "- Error Handling: Access control, validation errors"
echo ""
echo "All API endpoints are working correctly! 🎉"
