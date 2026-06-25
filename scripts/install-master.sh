#!/usr/bin/env bash
# ==============================================================
# AI-Demo Master Bootstrap Script (ULTIMATE FINAL VERSION)
# Usage: ./install-master.sh
# Description: Runs the entire setup sequence for new machines,
#              handling prerequisites, dependencies, and Docker startup.
# ==============================================================

set -e # Exit immediately if a command exits with a non-zero status.

echo "--- 🚀 AI Demo Master Bootstrap Script Starting ---"

# --- Phase 1: Dependency Check & Installation (Prerequisites) ---
echo ""
echo ">> PHASE 1/4: Checking and installing system prerequisites..."

if ! command -v brew &> /dev/null; then
    echo "  [!] Homebrew not found. Installing Homebrew..."
    # This must be run as root or using sudo for the shell to handle user changes correctly
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Check Node and NPM versions (Using a portable check)
if ! command -v node &> /dev/null || [[ $(node -v | grep -q "v20") == false ]]; then
    echo "  [!] Node.js v20+ required. Attempting installation via Homebrew..."
    brew install node@20
fi

# Check Python version (This is a simplification; robust checks are complex)
if ! command -v python3 &> /dev/null || [[ $(python3 --version | grep -q "Python 3.10") == false ]]; then
    echo "  [!] Python 3.12+ required. Attempting installation via Homebrew..."
    brew install python@3.12
fi

# --- Phase 2: Project Dependencies Installation & Update ---
echo ""
echo ">> PHASE 2/4: Installing and UPDATING project dependencies..."

if [ -f "package.json" ]; then
    echo "  [!] Running npm ci in root directory to lock build tooling."
    npm ci --legacy-peer-deps
    echo "  [!] Running npm update for general dependency updates..."
    npm update # <--- Runs 'npm update' here
else
    echo "  [?] package.json not found in the root. Skipping general NPM install."
fi

# --- Phase 3: Certificate & Config Setup (One-Time Run) ---
echo ""
echo ">> PHASE 3/4: Setting up local HTTPS certificates and initial configs..."

if command -v mkcert &> /dev/null; then
    echo "  [i] Running mkcert setup for local dev environment..."
    mkcert -install # Trust the local CA
else
    echo "  [!] WARNING: 'mkcert' not found. Cannot establish local HTTPS certificates."
fi

# Execute the master launcher script which handles file creation and dependency installation artifacts
echo "  Running ./run.sh to install necessary artifacts (e.g., dummy .env files)..."
./run.sh

echo ""
echo "============================================="
echo "✅ SETUP COMPLETE: All basic configuration files are in place."
echo "Next, you MUST manually verify and fill out ALL placeholder credentials in the various *.env files."
echo "============================================="
