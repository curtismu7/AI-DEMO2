#!/bin/sh

# Banking API Server Docker Entrypoint
# Handles graceful shutdown and environment setup

# Function to handle graceful shutdown
graceful_shutdown() {
    echo "Received shutdown signal, gracefully shutting down..."
    if [ -n "$PID" ]; then
        kill -TERM "$PID"
        wait "$PID"
    fi
    echo "Shutdown complete"
    exit 0
}

# Set up signal handlers
trap graceful_shutdown SIGTERM SIGINT

# Create data directory if it doesn't exist
mkdir -p /app/data

# Set proper permissions
chown -R appuser:appgroup /app/data

# Validate environment variables
if [ -z "$NODE_ENV" ]; then
    export NODE_ENV=production
fi

if [ -z "$PORT" ]; then
    export PORT=3001
fi

# Log startup information
echo "Starting Banking API Server..."
echo "Node Environment: $NODE_ENV"
echo "Port: $PORT"
echo "User: $(whoami)"

# Start the application
exec "$@" &

# Capture the PID
PID=$!

# Wait for the process
wait $PID
