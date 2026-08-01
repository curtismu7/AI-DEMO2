#!/bin/bash
# Banking MCP Server Stop Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="${PROJECT_DIR}/banking-mcp-server.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case $level in
        "ERROR")
            echo -e "${RED}[ERROR]${NC} $message" >&2
            ;;
        "WARN")
            echo -e "${YELLOW}[WARN]${NC} $message"
            ;;
        "INFO")
            echo -e "${GREEN}[INFO]${NC} $message"
            ;;
        *)
            echo "[$level] $message"
            ;;
    esac
}

stop_server() {
    log "INFO" "Stopping Banking MCP Server..."
    
    # Check if PID file exists
    if [[ -f "$PID_FILE" ]]; then
        local pid=$(cat "$PID_FILE")
        log "INFO" "Found PID file with PID: $pid"
        
        # Check if process is running
        if kill -0 "$pid" 2>/dev/null; then
            log "INFO" "Sending SIGTERM to process $pid..."
            kill "$pid"
            
            # Wait for graceful shutdown
            local count=0
            while kill -0 "$pid" 2>/dev/null && [[ $count -lt 30 ]]; do
                sleep 1
                ((count++))
                if [[ $((count % 5)) -eq 0 ]]; then
                    log "INFO" "Waiting for graceful shutdown... (${count}s)"
                fi
            done
            
            # Check if process is still running
            if kill -0 "$pid" 2>/dev/null; then
                log "WARN" "Process didn't stop gracefully, sending SIGKILL..."
                kill -9 "$pid" 2>/dev/null || true
                sleep 2
            fi
            
            # Verify process is stopped
            if kill -0 "$pid" 2>/dev/null; then
                log "ERROR" "Failed to stop process $pid"
                return 1
            else
                log "INFO" "Process $pid stopped successfully"
            fi
        else
            log "WARN" "Process $pid is not running"
        fi
        
        # Remove PID file
        rm -f "$PID_FILE"
        log "INFO" "Removed PID file"
    else
        log "WARN" "No PID file found at $PID_FILE"
    fi
    
    # Check for any remaining processes (more comprehensive search)
    local remaining_pids=$(pgrep -f "banking.*mcp.*server\|banking_mcp_server.*dist/index\.js\|dist/index\.js.*banking" 2>/dev/null || true)
    if [[ -n "$remaining_pids" ]]; then
        log "WARN" "Found additional Banking MCP Server processes: $remaining_pids"
        log "INFO" "Stopping additional processes..."
        echo "$remaining_pids" | xargs -r kill 2>/dev/null || true
        sleep 2
        
        # Force kill if still running
        remaining_pids=$(pgrep -f "banking-mcp-server\|dist/index\.js" 2>/dev/null || true)
        if [[ -n "$remaining_pids" ]]; then
            log "WARN" "Force killing remaining processes: $remaining_pids"
            echo "$remaining_pids" | xargs -r kill -9 2>/dev/null || true
        fi
    fi
    
    # Check if port is still in use and kill processes using it
    local port_check=$(lsof -ti :8100 2>/dev/null || true)
    if [[ -n "$port_check" ]]; then
        log "WARN" "Port 8100 is still in use by process(es): $port_check"
        log "INFO" "Attempting to free port 8100..."
        
        # Check if these are likely our server processes
        for pid in $port_check; do
            local cmd=$(ps -p "$pid" -o command= 2>/dev/null || echo "unknown")
            if [[ "$cmd" == *"dist/index.js"* ]] || [[ "$cmd" == *"banking"* ]]; then
                log "INFO" "Killing banking server process $pid: $cmd"
                kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
            else
                log "WARN" "Process $pid doesn't appear to be our server: $cmd"
            fi
        done
        
        sleep 2
        port_check=$(lsof -ti :8100 2>/dev/null || true)
        if [[ -n "$port_check" ]]; then
            log "WARN" "Port 8100 is still in use by: $port_check"
            log "INFO" "You may need to manually investigate these processes"
        else
            log "INFO" "Port 8100 is now free"
        fi
    else
        log "INFO" "Port 8100 is now free"
    fi
    
    log "INFO" "Banking MCP Server stopped successfully"
}

# Show help
show_help() {
    cat << EOF
Banking MCP Server Stop Script

Usage: $0 [OPTIONS]

Options:
    --force, -f     Force stop (send SIGKILL immediately)
    --help, -h      Show this help message

Examples:
    $0              # Graceful stop
    $0 --force      # Force stop

EOF
}

# Parse arguments
FORCE_STOP=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --force|-f)
            FORCE_STOP=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            log "ERROR" "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
main() {
    log "INFO" "Banking MCP Server stop script initiated"
    
    if [[ "$FORCE_STOP" == "true" ]]; then
        log "WARN" "Force stop mode enabled"
        # Kill all processes immediately
        pkill -9 -f "banking-mcp-server\|dist/index\.js" 2>/dev/null || true
        rm -f "$PID_FILE"
        log "INFO" "Force stop completed"
    else
        stop_server
    fi
    
    log "INFO" "Stop script completed"
}

# Execute main function
main "$@"