#!/bin/bash
# Banking MCP Server Installation Script
# Installs and configures the Banking MCP Server on Linux systems

set -e

# Configuration
SERVICE_NAME="banking-mcp-server"
SERVICE_USER="banking-mcp"
SERVICE_GROUP="banking-mcp"
INSTALL_DIR="/opt/banking-mcp-server"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging
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
        "DEBUG")
            echo -e "${BLUE}[DEBUG]${NC} $message"
            ;;
    esac
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log "ERROR" "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Check system requirements
check_requirements() {
    log "INFO" "Checking system requirements..."
    
    # Check OS
    if [[ ! -f /etc/os-release ]]; then
        log "ERROR" "Cannot determine OS version"
        exit 1
    fi
    
    source /etc/os-release
    log "INFO" "OS: $PRETTY_NAME"
    
    # Check systemd
    if ! command -v systemctl &> /dev/null; then
        log "ERROR" "systemd is required but not found"
        exit 1
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log "ERROR" "Node.js is required but not found"
        log "INFO" "Please install Node.js 20.x or higher"
        exit 1
    fi
    
    local node_version=$(node --version | sed 's/v//')
    log "INFO" "Node.js version: $node_version"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        log "ERROR" "npm is required but not found"
        exit 1
    fi
    
    local npm_version=$(npm --version)
    log "INFO" "npm version: $npm_version"
}

# Create service user
create_user() {
    log "INFO" "Creating service user and group..."
    
    if ! getent group "$SERVICE_GROUP" > /dev/null 2>&1; then
        groupadd --system "$SERVICE_GROUP"
        log "INFO" "Created group: $SERVICE_GROUP"
    else
        log "INFO" "Group already exists: $SERVICE_GROUP"
    fi
    
    if ! getent passwd "$SERVICE_USER" > /dev/null 2>&1; then
        useradd --system \
            --gid "$SERVICE_GROUP" \
            --home-dir "$INSTALL_DIR" \
            --no-create-home \
            --shell /bin/false \
            --comment "Banking MCP Server" \
            "$SERVICE_USER"
        log "INFO" "Created user: $SERVICE_USER"
    else
        log "INFO" "User already exists: $SERVICE_USER"
    fi
}

# Create directories
create_directories() {
    log "INFO" "Creating directories..."
    
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/data/tokens"
    mkdir -p "$INSTALL_DIR/logs"
    
    # Set ownership and permissions
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
    chmod 755 "$INSTALL_DIR"
    chmod 700 "$INSTALL_DIR/data/tokens"
    chmod 755 "$INSTALL_DIR/logs"
    
    log "INFO" "Created directories with proper permissions"
}

# Install application
install_application() {
    log "INFO" "Installing application to $INSTALL_DIR..."
    
    # Copy application files
    cp -r dist "$INSTALL_DIR/"
    cp -r node_modules "$INSTALL_DIR/"
    cp package*.json "$INSTALL_DIR/"
    cp -r scripts "$INSTALL_DIR/"
    
    # Make scripts executable
    chmod +x "$INSTALL_DIR/scripts/"*.sh
    chmod +x "$INSTALL_DIR/scripts/"*.js
    
    # Set ownership
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
    
    log "INFO" "Application installed successfully"
}

# Install systemd service
install_service() {
    log "INFO" "Installing systemd service..."
    
    # Copy service file
    cp "scripts/${SERVICE_NAME}.service" "$SERVICE_FILE"
    
    # Reload systemd
    systemctl daemon-reload
    
    log "INFO" "Systemd service installed"
}

# Configure application
configure_application() {
    log "INFO" "Configuring application..."
    
    # Generate example configuration
    cd "$INSTALL_DIR"
    node scripts/create-example-config.js production .env.production --generate-keys
    
    # Set proper permissions for config file
    chown "$SERVICE_USER:$SERVICE_GROUP" .env.production
    chmod 600 .env.production
    
    log "WARN" "Configuration file created: $INSTALL_DIR/.env.production"
    log "WARN" "Please edit this file with your actual configuration before starting the service"
}

# Setup log rotation
setup_logrotate() {
    log "INFO" "Setting up log rotation..."
    
    cat > /etc/logrotate.d/banking-mcp-server << EOF
$INSTALL_DIR/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 $SERVICE_USER $SERVICE_GROUP
    postrotate
        systemctl reload $SERVICE_NAME > /dev/null 2>&1 || true
    endscript
}
EOF
    
    log "INFO" "Log rotation configured"
}

# Show post-installation instructions
show_instructions() {
    log "INFO" "Installation completed successfully!"
    echo
    echo "Next steps:"
    echo "1. Edit the configuration file: $INSTALL_DIR/.env.production"
    echo "2. Validate the configuration: cd $INSTALL_DIR && npm run config:validate"
    echo "3. Enable the service: systemctl enable $SERVICE_NAME"
    echo "4. Start the service: systemctl start $SERVICE_NAME"
    echo "5. Check service status: systemctl status $SERVICE_NAME"
    echo "6. View logs: journalctl -u $SERVICE_NAME -f"
    echo
    echo "Configuration file location: $INSTALL_DIR/.env.production"
    echo "Service file location: $SERVICE_FILE"
    echo "Application directory: $INSTALL_DIR"
    echo
    echo "Service management commands:"
    echo "  Start:   systemctl start $SERVICE_NAME"
    echo "  Stop:    systemctl stop $SERVICE_NAME"
    echo "  Restart: systemctl restart $SERVICE_NAME"
    echo "  Status:  systemctl status $SERVICE_NAME"
    echo "  Logs:    journalctl -u $SERVICE_NAME"
}

# Uninstall function
uninstall() {
    log "INFO" "Uninstalling Banking MCP Server..."
    
    # Stop and disable service
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        systemctl stop "$SERVICE_NAME"
    fi
    
    if systemctl is-enabled --quiet "$SERVICE_NAME"; then
        systemctl disable "$SERVICE_NAME"
    fi
    
    # Remove service file
    if [[ -f "$SERVICE_FILE" ]]; then
        rm "$SERVICE_FILE"
        systemctl daemon-reload
    fi
    
    # Remove application directory
    if [[ -d "$INSTALL_DIR" ]]; then
        rm -rf "$INSTALL_DIR"
    fi
    
    # Remove user and group
    if getent passwd "$SERVICE_USER" > /dev/null 2>&1; then
        userdel "$SERVICE_USER"
    fi
    
    if getent group "$SERVICE_GROUP" > /dev/null 2>&1; then
        groupdel "$SERVICE_GROUP"
    fi
    
    # Remove log rotation
    if [[ -f "/etc/logrotate.d/banking-mcp-server" ]]; then
        rm "/etc/logrotate.d/banking-mcp-server"
    fi
    
    log "INFO" "Uninstallation completed"
}

# Main function
main() {
    local action="${1:-install}"
    
    case $action in
        install)
            log "INFO" "Starting Banking MCP Server installation..."
            check_root
            check_requirements
            create_user
            create_directories
            install_application
            install_service
            configure_application
            setup_logrotate
            show_instructions
            ;;
        uninstall)
            log "INFO" "Starting Banking MCP Server uninstallation..."
            check_root
            uninstall
            ;;
        *)
            echo "Usage: $0 [install|uninstall]"
            exit 1
            ;;
    esac
}

# Execute main function
main "$@"