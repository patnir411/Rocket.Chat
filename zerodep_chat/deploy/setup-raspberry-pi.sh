#!/bin/bash
#
# ZeroDep Chat - Raspberry Pi Deployment Script
# Supports Raspberry Pi 3B+, 4, and 5 with Raspberry Pi OS (Debian 11/12)
#

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/var/www/zerodep_chat"
APP_USER="www-data"
DOMAIN=""

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_raspberry_pi() {
    if [ ! -f /proc/device-tree/model ]; then
        log_error "This script is designed for Raspberry Pi"
        exit 1
    fi

    local model=$(cat /proc/device-tree/model)
    log_info "Detected: $model"

    # Check if ARMv7 or ARMv8 (Pi 3 and newer)
    local arch=$(uname -m)
    if [[ "$arch" != "armv7l" && "$arch" != "aarch64" ]]; then
        log_error "This requires Raspberry Pi 3 or newer (ARMv7/ARMv8)"
        exit 1
    fi

    log_success "Raspberry Pi detected and compatible"
}

check_node_version() {
    if ! command -v node &> /dev/null; then
        log_warning "Node.js not found"
        return 1
    fi

    local node_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$node_version" -lt 22 ]; then
        log_warning "Node.js version $node_version is too old (need 22+)"
        return 1
    fi

    log_success "Node.js v$(node -v) is installed"
    return 0
}

install_node() {
    log_info "Installing Node.js 22.x..."

    # Install using NodeSource repository
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs

    log_success "Node.js $(node -v) installed"
}

install_dependencies() {
    log_info "Installing system dependencies..."

    sudo apt-get update
    sudo apt-get install -y \
        nginx \
        certbot \
        python3-certbot-nginx \
        git \
        curl

    log_success "System dependencies installed"
}

setup_app() {
    log_info "Setting up application..."

    # Create app directory
    sudo mkdir -p "$APP_DIR"

    # Copy application files
    log_info "Copying application files..."
    sudo cp -r ./server "$APP_DIR/"
    sudo cp -r ./client "$APP_DIR/"
    sudo cp ./package.json "$APP_DIR/"
    sudo mkdir -p "$APP_DIR/data"

    # Set permissions
    sudo chown -R $APP_USER:$APP_USER "$APP_DIR"
    sudo chmod 755 "$APP_DIR"
    sudo chmod 755 "$APP_DIR/server"
    sudo chmod 755 "$APP_DIR/client"
    sudo chmod 700 "$APP_DIR/data"  # Restrict database directory

    log_success "Application files copied"
}

generate_jwt_secret() {
    if command -v openssl &> /dev/null; then
        openssl rand -hex 32
    else
        # Fallback to /dev/urandom
        head -c 32 /dev/urandom | xxd -p -c 32
    fi
}

setup_systemd() {
    log_info "Setting up systemd service..."

    # Generate JWT secret
    local jwt_secret=$(generate_jwt_secret)

    # Create systemd service file
    sudo tee /etc/systemd/system/zerodep-chat.service > /dev/null <<EOF
[Unit]
Description=ZeroDep Chat - Zero-dependency chat application
Documentation=https://github.com/yourusername/zerodep-chat
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=10

# Environment variables
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=JWT_SECRET=$jwt_secret

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/data
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictRealtime=true
RestrictNamespaces=true

# Resource limits (conservative for Raspberry Pi)
LimitNOFILE=4096
LimitNPROC=256

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zerodep-chat

[Install]
WantedBy=multi-user.target
EOF

    # Save JWT secret for reference
    echo "$jwt_secret" | sudo tee "$APP_DIR/.jwt-secret" > /dev/null
    sudo chmod 600 "$APP_DIR/.jwt-secret"
    sudo chown $APP_USER:$APP_USER "$APP_DIR/.jwt-secret"

    # Reload systemd
    sudo systemctl daemon-reload
    sudo systemctl enable zerodep-chat

    log_success "Systemd service created"
    log_info "JWT secret saved to $APP_DIR/.jwt-secret (keep this safe!)"
}

setup_nginx() {
    log_info "Setting up Nginx reverse proxy..."

    # Create Nginx configuration
    sudo tee /etc/nginx/sites-available/zerodep-chat > /dev/null <<'EOF'
upstream zerodep_chat {
    server 127.0.0.1:3000;
    keepalive 32;  # Reduced for Raspberry Pi
}

limit_req_zone $binary_remote_addr zone=chat_general:5m rate=5r/s;
limit_req_zone $binary_remote_addr zone=chat_api:5m rate=15r/s;

server {
    listen 80;
    listen [::]:80;
    server_name _;

    client_max_body_size 10M;

    # WebSocket support
    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
    }

    location / {
        limit_req zone=chat_general burst=10 nodelay;

        proxy_pass http://zerodep_chat;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /api/ {
        limit_req zone=chat_api burst=30 nodelay;

        proxy_pass http://zerodep_chat;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://zerodep_chat/health;
        access_log off;
    }
}
EOF

    # Enable site
    sudo ln -sf /etc/nginx/sites-available/zerodep-chat /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default  # Remove default site

    # Test configuration
    sudo nginx -t

    # Restart Nginx
    sudo systemctl restart nginx
    sudo systemctl enable nginx

    log_success "Nginx configured and started"
}

setup_ssl() {
    if [ -z "$DOMAIN" ]; then
        log_warning "No domain specified, skipping SSL setup"
        log_info "To setup SSL later, run: sudo certbot --nginx -d your-domain.com"
        return
    fi

    log_info "Setting up SSL with Let's Encrypt..."

    # Update Nginx config with domain
    sudo sed -i "s/server_name _;/server_name $DOMAIN;/" /etc/nginx/sites-available/zerodep-chat
    sudo nginx -t && sudo systemctl reload nginx

    # Get SSL certificate
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect

    log_success "SSL certificate installed for $DOMAIN"
}

setup_firewall() {
    log_info "Setting up firewall (ufw)..."

    # Install ufw if not present
    if ! command -v ufw &> /dev/null; then
        sudo apt-get install -y ufw
    fi

    # Configure firewall
    sudo ufw --force reset
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    sudo ufw allow 22/tcp comment 'SSH'
    sudo ufw allow 80/tcp comment 'HTTP'
    sudo ufw allow 443/tcp comment 'HTTPS'
    sudo ufw --force enable

    log_success "Firewall configured"
}

setup_backups() {
    log_info "Setting up automatic backups..."

    # Create backup directory
    sudo mkdir -p /var/backups/zerodep-chat
    sudo chown $APP_USER:$APP_USER /var/backups/zerodep-chat

    # Create backup script
    sudo tee /usr/local/bin/backup-zerodep-chat > /dev/null <<'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/zerodep-chat"
DB_FILE="/var/www/zerodep_chat/data/chat.db"
DATE=$(date +%Y%m%d-%H%M%S)

# Create backup
cp "$DB_FILE" "$BACKUP_DIR/chat-$DATE.db"

# Keep only last 14 days
find "$BACKUP_DIR" -name "chat-*.db" -mtime +14 -delete

# Compress old backups (older than 2 days)
find "$BACKUP_DIR" -name "chat-*.db" -mtime +2 ! -name "*.gz" -exec gzip {} \;
EOF

    sudo chmod +x /usr/local/bin/backup-zerodep-chat

    # Add cron job (daily at 2 AM)
    echo "0 2 * * * $APP_USER /usr/local/bin/backup-zerodep-chat" | sudo tee /etc/cron.d/zerodep-chat-backup > /dev/null

    log_success "Automatic daily backups configured"
}

optimize_raspberry_pi() {
    log_info "Optimizing for Raspberry Pi..."

    # Increase swap if needed (for Pis with 1-2GB RAM)
    local ram=$(free -m | awk '/^Mem:/{print $2}')
    if [ "$ram" -lt 2048 ]; then
        log_info "Increasing swap space for low RAM system..."

        # Check current swap
        local current_swap=$(free -m | awk '/^Swap:/{print $2}')
        if [ "$current_swap" -lt 1024 ]; then
            sudo dphys-swapfile swapoff || true
            sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
            sudo dphys-swapfile setup
            sudo dphys-swapfile swapon
            log_success "Swap increased to 1GB"
        fi
    fi

    # Set nice level for better responsiveness
    sudo mkdir -p /etc/systemd/system/zerodep-chat.service.d/
    sudo tee /etc/systemd/system/zerodep-chat.service.d/nice.conf > /dev/null <<EOF
[Service]
Nice=-5
EOF

    sudo systemctl daemon-reload

    log_success "Raspberry Pi optimizations applied"
}

start_services() {
    log_info "Starting services..."

    sudo systemctl start zerodep-chat
    sleep 2

    # Check if service is running
    if sudo systemctl is-active --quiet zerodep-chat; then
        log_success "ZeroDep Chat is running"
    else
        log_error "Failed to start ZeroDep Chat"
        sudo journalctl -u zerodep-chat --no-pager -n 50
        exit 1
    fi
}

print_summary() {
    local ip=$(hostname -I | awk '{print $1}')

    echo
    echo "═══════════════════════════════════════════════════════════════════"
    echo -e "${GREEN}✓ ZeroDep Chat has been successfully deployed!${NC}"
    echo "═══════════════════════════════════════════════════════════════════"
    echo
    echo "Access your chat application at:"
    echo -e "  ${BLUE}http://$ip${NC}"
    if [ -n "$DOMAIN" ]; then
        echo -e "  ${BLUE}https://$DOMAIN${NC}"
    fi
    echo
    echo "Service management:"
    echo "  Status:  sudo systemctl status zerodep-chat"
    echo "  Logs:    sudo journalctl -u zerodep-chat -f"
    echo "  Restart: sudo systemctl restart zerodep-chat"
    echo "  Stop:    sudo systemctl stop zerodep-chat"
    echo
    echo "Database location: $APP_DIR/data/chat.db"
    echo "Backup location: /var/backups/zerodep-chat/"
    echo "JWT secret: $APP_DIR/.jwt-secret"
    echo
    echo "═══════════════════════════════════════════════════════════════════"
}

# Main installation
main() {
    echo "═══════════════════════════════════════════════════════════════════"
    echo "  ZeroDep Chat - Raspberry Pi Deployment"
    echo "  Zero-dependency chat application using only Node.js core modules"
    echo "═══════════════════════════════════════════════════════════════════"
    echo

    # Check if running as root
    if [ "$EUID" -eq 0 ]; then
        log_error "Please run this script as a normal user (not root)"
        log_info "The script will use sudo when needed"
        exit 1
    fi

    # Ask for domain (optional)
    read -p "Enter your domain name (optional, press Enter to skip): " DOMAIN

    # Confirm
    echo
    log_warning "This script will:"
    echo "  - Install Node.js 22.x"
    echo "  - Install Nginx, Certbot, and other dependencies"
    echo "  - Deploy ZeroDep Chat to $APP_DIR"
    echo "  - Configure systemd service"
    echo "  - Setup Nginx reverse proxy"
    if [ -n "$DOMAIN" ]; then
        echo "  - Setup SSL for $DOMAIN"
    fi
    echo "  - Configure firewall"
    echo "  - Setup automatic backups"
    echo
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Installation cancelled"
        exit 0
    fi

    # Run installation steps
    check_raspberry_pi
    install_dependencies

    if ! check_node_version; then
        install_node
    fi

    setup_app
    setup_systemd
    setup_nginx
    setup_ssl
    setup_firewall
    setup_backups
    optimize_raspberry_pi
    start_services
    print_summary
}

# Run main function
main "$@"
