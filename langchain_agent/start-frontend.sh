#!/bin/bash

# Start the frontend development server

echo "🎨 Starting React frontend development server..."
echo "📍 Frontend will be available at: http://localhost:3000"
echo "🔗 Backend WebSocket: ws://localhost:8080"
echo "📋 Backend Health Check: http://localhost:8081/health"
echo ""
echo "Press Ctrl+C to stop the frontend server"
echo ""

cd frontend && npm start