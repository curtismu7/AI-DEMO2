#!/bin/bash
# Script to update ANTHROPIC_API_KEY in .env file

if [ -z "$1" ]; then
  echo "Usage: ./update-anthropic-key.sh <your_anthropic_api_key>"
  exit 1
fi

sed -i '' "s/^ANTHROPIC_API_KEY=.*/ANTHROPIC_API_KEY=$1/" .env
echo "✅ ANTHROPIC_API_KEY updated in .env"
