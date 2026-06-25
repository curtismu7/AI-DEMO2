#!/bin/bash

# PingOne AI IAM Core OAuth Environment Setup Script
# This script helps you set up your environment configuration

echo "🚀 PingOne AI IAM Core OAuth Environment Setup"
echo "=================================="

# Check if .env already exists
if [ -f ".env" ]; then
    echo "⚠️  .env file already exists!"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 1
    fi
fi

# Copy the example file
echo "📋 Copying env.example to .env..."
cp env.example .env

# Generate a secure session secret
echo "🔐 Generating secure session secret..."
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Update the .env file with the generated secret
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/your-session-secret-key-change-this-in-production/$SESSION_SECRET/" .env
else
    # Linux
    sed -i "s/your-session-secret-key-change-this-in-production/$SESSION_SECRET/" .env
fi

echo "✅ Environment file created successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Edit .env file and replace placeholder values with your PingOne AI IAM Core configuration"
echo "2. Configure your PingOne AI IAM Core OAuth2 client (see PINGONE_AI_CORE_SETUP.md for details)"
echo "3. Run 'npm install' to install dependencies"
echo "4. Run 'npm start' to start the server"
echo ""
echo "🔧 Required PingOne AI IAM Core configuration:"
echo "   - Tenant name"
echo "   - OAuth2 client ID"
echo "   - OAuth2 client secret"
echo "   - Redirect URI: http://localhost:3001/api/auth/oauth/callback"
echo ""
echo "📚 For detailed setup instructions, see PINGONE_AI_CORE_SETUP.md"
