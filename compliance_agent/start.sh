#!/bin/bash

# Compliance Agent Startup Script
# Starts the Python Pydantic AI compliance checking service

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting Compliance Agent (Pydantic AI)...${NC}"

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from .env.example..."
    cp .env.example .env
    echo "📝 Please update .env with your ANTHROPIC_API_KEY"
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.11+"
    exit 1
fi

# Check if venv exists, create if not
if [ ! -d venv ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate venv
source venv/bin/activate

# Install/upgrade dependencies
echo "📦 Installing dependencies..."
pip install -q -r requirements.txt

# Run the service
PORT="${COMPLIANCE_PORT:-3007}"
echo -e "${GREEN}✓ Starting on port ${PORT}${NC}"
echo ""
python main.py
