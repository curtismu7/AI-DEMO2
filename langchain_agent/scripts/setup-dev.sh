#!/bin/bash

# Development Environment Setup Script for LangChain MCP OAuth Agent

set -e

echo "🚀 Setting up LangChain MCP OAuth Agent development environment..."

# Check Python version
python_version=$(python3 --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
required_version="3.11"

if [ "$(printf '%s\n' "$required_version" "$python_version" | sort -V | head -n1)" != "$required_version" ]; then
    echo "❌ Python 3.11+ is required. Found: $python_version"
    echo "Please install Python 3.11 or higher"
    exit 1
fi

echo "✅ Python version: $python_version"

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "📦 Creating Python virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "⬆️ Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo "📚 Installing Python dependencies..."
pip install -r requirements.txt

# Create necessary directories
echo "📁 Creating necessary directories..."
mkdir -p logs data config

# Generate development configuration
if [ ! -f ".env" ]; then
    echo "⚙️ Generating development configuration..."
    python scripts/generate-config.py env --environment development --include-secrets --output .env
    echo "✅ Created .env file with development defaults and generated encryption keys"
    echo "⚠️  Please edit .env file with your PingOne and OpenAI configuration"
else
    echo "✅ .env file already exists"
fi

# Validate configuration
echo "🔍 Validating configuration..."
if python scripts/generate-config.py validate --environment development 2>/dev/null; then
    echo "✅ Configuration is valid"
else
    echo "⚠️  Configuration validation failed - please check your .env file"
fi

# Check if Node.js is available for frontend
if command -v node &> /dev/null; then
    node_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$node_version" -ge 18 ]; then
        echo "✅ Node.js version: $(node --version)"
        
        # Setup frontend if directory exists
        if [ -d "frontend" ]; then
            echo "🎨 Setting up frontend..."
            cd frontend
            if [ ! -d "node_modules" ]; then
                echo "📦 Installing frontend dependencies..."
                npm install
                echo "✅ Frontend dependencies installed"
            else
                echo "✅ Frontend dependencies already installed"
            fi
            cd ..
        fi
    else
        echo "⚠️  Node.js 18+ recommended for frontend. Found: $(node --version)"
    fi
else
    echo "⚠️  Node.js not found. Frontend setup skipped."
    echo "Install Node.js 18+ from https://nodejs.org/ to run the frontend"
fi

# Run basic tests to verify setup
echo "🧪 Running basic tests..."
if python -m pytest tests/test_config_settings.py -v; then
    echo "✅ Basic tests passed"
else
    echo "⚠️  Some tests failed - check your configuration"
fi

echo ""
echo "🎉 Development environment setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your PingOne and OpenAI configuration:"
echo "   nano .env"
echo ""
echo "2. Start the backend:"
echo "   source venv/bin/activate"
echo "   python src/main.py"
echo ""
if [ -d "frontend" ]; then
echo "3. Start the frontend (in another terminal):"
echo "   cd frontend"
echo "   npm start"
echo ""
fi
echo "4. Test the setup:"
echo "   curl http://localhost:8080/health"
echo ""
echo "📚 For detailed setup instructions, see SETUP.md"
echo "🐛 For troubleshooting, see docs/DEPLOYMENT.md"

# Show configuration reminder
echo ""
echo "⚠️  IMPORTANT: Before running the application, make sure to:"
echo "   - Configure your PingOne tenant URLs in .env"
echo "   - Add your OpenAI API key to .env"
echo "   - Verify all required environment variables are set"
echo ""
echo "🔐 Your encryption keys have been generated automatically."
echo "Keep your .env file secure and never commit it to version control!"