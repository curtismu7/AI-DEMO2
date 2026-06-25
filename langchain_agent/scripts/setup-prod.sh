#!/bin/bash

# Production Environment Setup Script for LangChain MCP OAuth Agent

set -e

echo "🚀 Setting up LangChain MCP OAuth Agent production environment..."

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "⚠️  Running as root. Consider using a dedicated user for production."
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required for production deployment"
    echo "Please install Docker from https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is required for production deployment"
    echo "Please install Docker Compose from https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"

# Create production directories
echo "📁 Creating production directories..."
mkdir -p logs data config

# Create production .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating production .env file..."
    python3 -c "
import sys
sys.path.append('src')
from config.settings import ConfigManager
from pathlib import Path

manager = ConfigManager()
manager.export_config_template('production', Path('.env'))
print('Created .env file with production defaults')
"
    echo "⚠️  Please edit .env file with your actual production configuration values"
    echo "⚠️  Ensure all required secrets are set before starting the service"
else
    echo "✅ .env file already exists"
fi

# Validate required environment variables
echo "🔍 Validating environment configuration..."
if [ -f ".env" ]; then
    source .env
    
    required_vars=(
        "PINGONE_BASE_URL"
        "PINGONE_CLIENT_REGISTRATION_ENDPOINT"
        "PINGONE_TOKEN_ENDPOINT"
        "PINGONE_AUTHORIZATION_ENDPOINT"
        "PINGONE_REDIRECT_URI"
        "ENCRYPTION_MASTER_KEY"
        "ENCRYPTION_SALT"
        "OPENAI_API_KEY"
    )
    
    missing_vars=()
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ] || [[ "${!var}" == *"your-"* ]] || [[ "${!var}" == *"here"* ]]; then
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -ne 0 ]; then
        echo "❌ The following required environment variables are not properly set:"
        printf '%s\n' "${missing_vars[@]}"
        echo "Please update your .env file before proceeding"
        exit 1
    fi
    
    echo "✅ All required environment variables are set"
fi

# Build Docker image
echo "🏗️ Building Docker image..."
docker build -t langchain-mcp-agent:latest .

# Create systemd service file (optional)
if command -v systemctl &> /dev/null; then
    echo "📋 Creating systemd service file..."
    cat > /tmp/langchain-mcp-agent.service << EOF
[Unit]
Description=LangChain MCP OAuth Agent
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
    
    echo "To install the systemd service:"
    echo "sudo cp /tmp/langchain-mcp-agent.service /etc/systemd/system/"
    echo "sudo systemctl daemon-reload"
    echo "sudo systemctl enable langchain-mcp-agent"
    echo "sudo systemctl start langchain-mcp-agent"
fi

# Set up log rotation
echo "📝 Setting up log rotation..."
cat > /tmp/langchain-mcp-agent-logrotate << EOF
$(pwd)/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 $(whoami) $(whoami)
    postrotate
        docker-compose restart langchain-mcp-agent
    endscript
}
EOF

echo "To install log rotation:"
echo "sudo cp /tmp/langchain-mcp-agent-logrotate /etc/logrotate.d/langchain-mcp-agent"

# Create backup script
echo "💾 Creating backup script..."
cat > scripts/backup.sh << 'EOF'
#!/bin/bash

# Backup script for LangChain MCP OAuth Agent

BACKUP_DIR="/var/backups/langchain-mcp-agent"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Backup configuration
tar -czf "$BACKUP_DIR/config_$DATE.tar.gz" .env docker-compose.yml

# Backup data directory
if [ -d "data" ]; then
    tar -czf "$BACKUP_DIR/data_$DATE.tar.gz" data/
fi

# Backup logs (last 7 days)
if [ -d "logs" ]; then
    find logs/ -name "*.log" -mtime -7 -exec tar -czf "$BACKUP_DIR/logs_$DATE.tar.gz" {} +
fi

# Clean old backups (keep 30 days)
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR"
EOF

chmod +x scripts/backup.sh

echo ""
echo "🎉 Production environment setup complete!"
echo ""
echo "Next steps:"
echo "1. Review and update .env file with production values"
echo "2. Start the service: docker-compose up -d"
echo "3. Check logs: docker-compose logs -f"
echo "4. Monitor health: curl http://localhost:8080/health"
echo ""
echo "Production commands:"
echo "- Start service: docker-compose up -d"
echo "- Stop service: docker-compose down"
echo "- View logs: docker-compose logs -f"
echo "- Update service: docker-compose pull && docker-compose up -d"
echo "- Backup data: ./scripts/backup.sh"