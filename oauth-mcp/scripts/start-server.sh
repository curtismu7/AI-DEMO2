#!/bin/bash
# Banking MCP Server Startup Script
# Handles environment setup, validation, and server startup

set -e  # Exit on any error

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="${PROJECT_DIR}/logs/startup.log"

# Default values
ENVIRONMENT="${NODE_ENV:-production}"
CONFIG_FILE=""
VALIDATE_CONFIG=true
HEALTH_CHECK=true
DAEMON_MODE=false
PID_FILE="${PROJECT_DIR}/banking-mcp-server.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Create logs directory if it doesn't exist
    mkdir -p "$(dirname "$LOG_FILE")"
    
    # Log to file
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
    
    # Log to console with colors
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
        "DEBUG")
            echo -e "${BLUE}[DEBUG]${NC} $message"
            ;;
        *)
            echo "[$level] $message"
            ;;
    esac
}

# Help function
show_help() {
    cat << EOF
Banking MCP Server Startup Script

Usage: $0 [OPTIONS]

Options:
    -e, --environment ENV    Set environment (development, staging, production)
    -c, --config FILE        Use specific configuration file
    -d, --daemon             Run in daemon mode (background)
    --no-validate           Skip configuration validation
    --no-health-check       Skip health check after startup
    -h, --help              Show this help message

Environment Variables:
    NODE_ENV                Set the environment (default: production)
    CONFIG_FILE             Path to configuration file
    SKIP_VALIDATION         Skip configuration validation (true/false)
    SKIP_HEALTH_CHECK       Skip health check (true/false)

Examples:
    $0                                          # Start with default settings
    $0 -e development                           # Start in development mode
    $0 -c .env.production -d                    # Start with config file in daemon mode
    $0 --no-validate --no-health-check         # Start without validation or health check

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -c|--config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        -d|--daemon)
            DAEMON_MODE=true
            shift
            ;;
        --no-validate)
            VALIDATE_CONFIG=false
            shift
            ;;
        --no-health-check)
            HEALTH_CHECK=false
            shift
            ;;
        -h|--help)
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

# Check if server is already running
check_running() {
    if [[ -f "$PID_FILE" ]]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log "ERROR" "Server is already running with PID $pid"
            exit 1
        else
            log "WARN" "Stale PID file found, removing..."
            rm -f "$PID_FILE"
        fi
    fi
}

# Validate environment
validate_environment() {
    log "INFO" "Validating environment: $ENVIRONMENT"
    
    case $ENVIRONMENT in
        development|staging|production|test)
            export NODE_ENV="$ENVIRONMENT"
            ;;
        *)
            log "ERROR" "Invalid environment: $ENVIRONMENT"
            log "ERROR" "Valid environments: development, staging, production, test"
            exit 1
            ;;
    esac
}

# Load configuration file
load_config() {
    if [[ -n "$CONFIG_FILE" ]]; then
        if [[ -f "$CONFIG_FILE" ]]; then
            log "INFO" "Loading configuration from: $CONFIG_FILE"
            set -a  # Export all variables
            source "$CONFIG_FILE"
            set +a  # Stop exporting
        else
            log "ERROR" "Configuration file not found: $CONFIG_FILE"
            exit 1
        fi
    elif [[ -f ".env.$ENVIRONMENT" ]]; then
        log "INFO" "Loading environment configuration: .env.$ENVIRONMENT"
        set -a
        source ".env.$ENVIRONMENT"
        set +a
    elif [[ -f ".env" ]]; then
        log "INFO" "Loading default configuration: .env"
        set -a
        source ".env"
        set +a
    else
        log "WARN" "No configuration file found, using environment variables only"
    fi
}

# Validate configuration
validate_config() {
    if [[ "$VALIDATE_CONFIG" == "true" ]]; then
        log "INFO" "Validating configuration..."
        
        if ! node "$SCRIPT_DIR/validate-config.js" 2>&1 | tee -a "$LOG_FILE"; then
            log "ERROR" "Configuration validation failed"
            exit 1
        fi
        
        log "INFO" "Configuration validation passed"
    else
        log "INFO" "Skipping configuration validation"
    fi
}

# Check dependencies
check_dependencies() {
    log "INFO" "Checking dependencies..."
    
    # Check Node.js version
    local node_version=$(node --version | sed 's/v//')
    local required_version="20.0.0"
    
    if ! node -e "process.exit(require('semver').gte('$node_version', '$required_version') ? 0 : 1)" 2>/dev/null; then
        log "ERROR" "Node.js version $node_version is not supported. Required: >= $required_version"
        exit 1
    fi
    
    # Check if build exists
    if [[ ! -d "$PROJECT_DIR/dist" ]]; then
        log "INFO" "Build directory not found, building application..."
        npm run build
    fi
    
    # Check if node_modules exists
    if [[ ! -d "$PROJECT_DIR/node_modules" ]]; then
        log "INFO" "Dependencies not installed, installing..."
        npm ci --production
    fi
}

# Create necessary directories
create_directories() {
    log "INFO" "Creating necessary directories..."
    
    local token_path="${TOKEN_STORAGE_PATH:-./data/tokens}"
    local audit_log_dir=$(dirname "${AUDIT_LOG_PATH:-./logs/audit.log}")
    local security_log_dir=$(dirname "${SECURITY_LOG_PATH:-./logs/security.log}")
    
    mkdir -p "$token_path" "$audit_log_dir" "$security_log_dir"
    
    # Set proper permissions
    chmod 700 "$token_path"
    chmod 755 "$audit_log_dir" "$security_log_dir"
}

# Start server
start_server() {
    log "INFO" "Starting Banking MCP Server..."
    log "INFO" "Environment: $ENVIRONMENT"
    log "INFO" "PID file: $PID_FILE"
    
    if [[ "$DAEMON_MODE" == "true" ]]; then
        log "INFO" "Starting in daemon mode..."
        nohup node "$PROJECT_DIR/dist/index.js" > "$PROJECT_DIR/logs/server.log" 2>&1 &
        local pid=$!
        echo $pid > "$PID_FILE"
        log "INFO" "Server started with PID: $pid"
    else
        log "INFO" "Starting in foreground mode..."
        # Store PID for cleanup
        echo $$ > "$PID_FILE"
        
        # Trap signals for graceful shutdown
        trap 'log "INFO" "Received shutdown signal, stopping server..."; rm -f "$PID_FILE"; exit 0' SIGTERM SIGINT
        
        exec node "$PROJECT_DIR/dist/index.js"
    fi
}

# Health check
perform_health_check() {
    if [[ "$HEALTH_CHECK" == "true" ]]; then
        log "INFO" "Performing health check..."
        
        local max_attempts=30
        local attempt=1
        local host="${MCP_SERVER_HOST:-localhost}"
        local port="${MCP_SERVER_PORT:-8080}"
        
        while [[ $attempt -le $max_attempts ]]; do
            if node "$SCRIPT_DIR/health-check.js" "$host" "$port" "/health" 2>/dev/null; then
                log "INFO" "Health check passed"
                return 0
            fi
            
            log "INFO" "Health check attempt $attempt/$max_attempts failed, retrying in 2 seconds..."
            sleep 2
            ((attempt++))
        done
        
        log "ERROR" "Health check failed after $max_attempts attempts"
        
        if [[ "$DAEMON_MODE" == "true" && -f "$PID_FILE" ]]; then
            local pid=$(cat "$PID_FILE")
            log "ERROR" "Stopping server due to failed health check..."
            kill "$pid" 2>/dev/null || true
            rm -f "$PID_FILE"
        fi
        
        exit 1
    else
        log "INFO" "Skipping health check"
    fi
}

# Cleanup function
cleanup() {
    if [[ -f "$PID_FILE" ]]; then
        rm -f "$PID_FILE"
    fi
}

# Main execution
main() {
    log "INFO" "Banking MCP Server startup initiated"
    log "INFO" "Script: $0"
    log "INFO" "Arguments: $*"
    log "INFO" "Working directory: $(pwd)"
    
    # Change to project directory
    cd "$PROJECT_DIR"
    
    # Setup cleanup
    trap cleanup EXIT
    
    # Execute startup sequence
    check_running
    validate_environment
    load_config
    validate_config
    check_dependencies
    create_directories
    start_server
    
    # Health check (only for daemon mode)
    if [[ "$DAEMON_MODE" == "true" ]]; then
        sleep 5  # Give server time to start
        perform_health_check
        log "INFO" "Server startup completed successfully"
    fi
}

# Execute main function
main "$@"