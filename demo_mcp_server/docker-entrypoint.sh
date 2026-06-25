#!/bin/sh

# Banking MCP Server Docker Entrypoint
# Handles graceful shutdown and environment setup

# Function to handle graceful shutdown
graceful_shutdown() {
    echo "Received shutdown signal, gracefully shutting down MCP server..."
    if [ -n "$PID" ]; then
        kill -TERM "$PID"
        wait "$PID"
    fi
    echo "MCP server shutdown complete"
    exit 0
}

# Set up signal handlers
trap graceful_shutdown SIGTERM SIGINT

# Create necessary directories
mkdir -p /app/data/tokens /app/logs

# Set proper permissions
chown -R appuser:appgroup /app/data /app/logs

# Validate environment variables
if [ -z "$NODE_ENV" ]; then
    export NODE_ENV=production
fi

if [ -z "$MCP_SERVER_HOST" ]; then
    export MCP_SERVER_HOST=0.0.0.0
fi

if [ -z "$PORT" ]; then
    export PORT=8080
fi

# Log startup information
echo "Starting Banking MCP Server..."
echo "Node Environment: $NODE_ENV"
echo "Host: $MCP_SERVER_HOST"
echo "Port: $PORT"
echo "User: $(whoami)"

# Start the application
exec "$@" &

# Capture the PID
PID=$!

# Wait for the process
wait $PID
