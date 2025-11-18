# Raspberry Pi Deployment Guide
## ZeroDep Chat - Zero-Dependency Production Deployment

Complete guide for deploying ZeroDep Chat on Raspberry Pi (3B+, 4, or 5) for 500-1,000 concurrent users.

---

## Table of Contents

1. [Hardware Requirements](#hardware-requirements)
2. [Quick Start](#quick-start)
3. [Manual Installation](#manual-installation)
4. [Configuration](#configuration)
5. [Monitoring](#monitoring)
6. [Maintenance](#maintenance)
7. [Performance Tuning](#performance-tuning)
8. [Troubleshooting](#troubleshooting)

---

## Hardware Requirements

### Minimum (100-300 users)
- **Raspberry Pi 3B+** or newer
- **2GB RAM**
- **16GB SD card** (Class 10 or UHS-I)
- **Stable power supply** (2.5A minimum)
- **Wired Ethernet** (recommended)

### Recommended (500-1,000 users)
- **Raspberry Pi 4 (4GB RAM)** or **Raspberry Pi 5 (4GB RAM)**
- **32GB SD card** (Class 10 or UHS-I, or NVMe SSD for Pi 5)
- **Active cooling** (fan or heatsink case)
- **Wired Gigabit Ethernet**
- **UPS** (optional but recommended)

### Storage Recommendations
- **SD Card**: Good for small deployments (<100 users)
- **USB SSD**: Better for production (500+ users)
- **NVMe SSD** (Pi 5 only): Best performance

---

## Quick Start

### Automated Installation (Recommended)

```bash
# 1. Download the project
git clone <your-repo-url>
cd zerodep_chat

# 2. Make installation script executable
chmod +x deploy/setup-raspberry-pi.sh

# 3. Run installation script
./deploy/setup-raspberry-pi.sh

# 4. Follow the prompts
# - Enter your domain (or leave blank for IP-only access)
# - Confirm installation

# 5. Wait for installation to complete (~5-10 minutes)

# Done! Access your chat at http://your-pi-ip or https://your-domain.com
```

That's it! The script handles everything:
- ✅ Installs Node.js 22.x
- ✅ Installs Nginx
- ✅ Deploys application
- ✅ Configures systemd service
- ✅ Sets up reverse proxy
- ✅ Configures SSL (if domain provided)
- ✅ Enables firewall
- ✅ Sets up automatic backups
- ✅ Optimizes for Raspberry Pi

---

## Manual Installation

If you prefer manual installation or want to customize:

### Step 1: Prepare Raspberry Pi

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y curl git nginx certbot python3-certbot-nginx

# Reboot
sudo reboot
```

### Step 2: Install Node.js 22.x

```bash
# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -

# Install Node.js
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should be v22.x.x
```

### Step 3: Deploy Application

```bash
# Create application directory
sudo mkdir -p /var/www/zerodep_chat

# Copy files (from your local machine or git clone)
sudo cp -r server /var/www/zerodep_chat/
sudo cp -r client /var/www/zerodep_chat/
sudo cp package.json /var/www/zerodep_chat/

# Create data directory
sudo mkdir -p /var/www/zerodep_chat/data

# Set permissions
sudo chown -R www-data:www-data /var/www/zerodep_chat
sudo chmod 700 /var/www/zerodep_chat/data
```

### Step 4: Configure Systemd Service

```bash
# Generate JWT secret
JWT_SECRET=$(openssl rand -hex 32)

# Create systemd service
sudo tee /etc/systemd/system/zerodep-chat.service > /dev/null <<EOF
[Unit]
Description=ZeroDep Chat
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/zerodep_chat
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=10

Environment=NODE_ENV=production
Environment=PORT=3000
Environment=JWT_SECRET=$JWT_SECRET

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/www/zerodep_chat/data

[Install]
WantedBy=multi-user.target
EOF

# Save JWT secret for reference
echo "$JWT_SECRET" | sudo tee /var/www/zerodep_chat/.jwt-secret > /dev/null
sudo chmod 600 /var/www/zerodep_chat/.jwt-secret

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable zerodep-chat
sudo systemctl start zerodep-chat

# Check status
sudo systemctl status zerodep-chat
```

### Step 5: Configure Nginx

```bash
# Use provided configuration
sudo cp deploy/nginx/zerodep-chat.conf /etc/nginx/sites-available/

# Enable site
sudo ln -s /etc/nginx/sites-available/zerodep-chat /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # Remove default site

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### Step 6: Setup SSL (Optional)

```bash
# Replace 'chat.yourdomain.com' with your actual domain
DOMAIN="chat.yourdomain.com"

# Update Nginx config with your domain
sudo sed -i "s/server_name _;/server_name $DOMAIN;/" /etc/nginx/sites-available/zerodep-chat
sudo nginx -t && sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d $DOMAIN

# Certbot will automatically configure HTTPS redirect
```

### Step 7: Configure Firewall

```bash
# Install and configure ufw
sudo apt install -y ufw

# Configure firewall rules
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

### Step 8: Setup Automatic Backups

```bash
# Create backup directory
sudo mkdir -p /var/backups/zerodep-chat
sudo chown www-data:www-data /var/backups/zerodep-chat

# Create backup script
sudo tee /usr/local/bin/backup-zerodep-chat > /dev/null <<'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/zerodep-chat"
DB_FILE="/var/www/zerodep_chat/data/chat.db"
DATE=$(date +%Y%m%d-%H%M%S)

# Backup database
cp "$DB_FILE" "$BACKUP_DIR/chat-$DATE.db"

# Keep only last 14 days
find "$BACKUP_DIR" -name "chat-*.db" -mtime +14 -delete

# Compress old backups (older than 2 days)
find "$BACKUP_DIR" -name "chat-*.db" -mtime +2 ! -name "*.gz" -exec gzip {} \;
EOF

sudo chmod +x /usr/local/bin/backup-zerodep-chat

# Add cron job (daily at 2 AM)
echo "0 2 * * * www-data /usr/local/bin/backup-zerodep-chat" | sudo tee /etc/cron.d/zerodep-chat-backup
```

---

## Configuration

### Environment Variables

Edit systemd service to change configuration:

```bash
sudo nano /etc/systemd/system/zerodep-chat.service
```

Available variables:
- `PORT=3000` - Port to listen on (default: 3000)
- `NODE_ENV=production` - Environment
- `JWT_SECRET=<random>` - JWT signing secret (REQUIRED)
- `CORS_ORIGIN=*` - CORS allowed origin

After editing, reload:
```bash
sudo systemctl daemon-reload
sudo systemctl restart zerodep-chat
```

### Nginx Rate Limiting

Edit `/etc/nginx/sites-available/zerodep-chat` to adjust:

```nginx
# Increase rate limits for busy servers
limit_req_zone $binary_remote_addr zone=chat_general:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=chat_api:10m rate=30r/s;
```

---

## Monitoring

### Service Status

```bash
# Check if service is running
sudo systemctl status zerodep-chat

# View real-time logs
sudo journalctl -u zerodep-chat -f

# View last 100 lines
sudo journalctl -u zerodep-chat -n 100
```

### Resource Usage

```bash
# CPU and memory usage
htop

# or
top

# Disk usage
df -h

# Database size
ls -lh /var/www/zerodep_chat/data/chat.db
```

### System Metrics

```bash
# Temperature (important for Raspberry Pi!)
vcgencmd measure_temp

# Voltage (should be ~1.2-1.4V)
vcgencmd measure_volts

# Clock speed
vcgencmd measure_clock arm
```

### Nginx Logs

```bash
# Access log
sudo tail -f /var/log/nginx/zerodep-chat-access.log

# Error log
sudo tail -f /var/log/nginx/zerodep-chat-error.log
```

---

## Maintenance

### Updating the Application

```bash
# 1. Stop service
sudo systemctl stop zerodep-chat

# 2. Backup database
sudo cp /var/www/zerodep_chat/data/chat.db ~/chat-backup-$(date +%Y%m%d).db

# 3. Update application files
cd /path/to/new/version
sudo cp -r server client /var/www/zerodep_chat/

# 4. Set permissions
sudo chown -R www-data:www-data /var/www/zerodep_chat

# 5. Start service
sudo systemctl start zerodep-chat

# 6. Check status
sudo systemctl status zerodep-chat
```

### Database Maintenance

```bash
# Vacuum database (reclaim space, optimize)
sudo -u www-data sqlite3 /var/www/zerodep_chat/data/chat.db "VACUUM;"

# Check database integrity
sudo -u www-data sqlite3 /var/www/zerodep_chat/data/chat.db "PRAGMA integrity_check;"

# View database size
sudo du -h /var/www/zerodep_chat/data/chat.db
```

### Backup and Restore

**Manual Backup:**
```bash
# Backup database
sudo cp /var/www/zerodep_chat/data/chat.db ~/backup-$(date +%Y%m%d-%H%M%S).db

# Compress backup
gzip ~/backup-*.db
```

**Restore from Backup:**
```bash
# 1. Stop service
sudo systemctl stop zerodep-chat

# 2. Restore database
sudo gunzip -c backup-YYYYMMDD-HHMMSS.db.gz | sudo tee /var/www/zerodep_chat/data/chat.db > /dev/null

# 3. Fix permissions
sudo chown www-data:www-data /var/www/zerodep_chat/data/chat.db

# 4. Start service
sudo systemctl start zerodep-chat
```

### SSL Certificate Renewal

Let's Encrypt certificates auto-renew. To manually renew:

```bash
sudo certbot renew

# Test renewal (dry run)
sudo certbot renew --dry-run
```

---

## Performance Tuning

### For Raspberry Pi 3B+ (2GB RAM)

```bash
# 1. Increase swap
sudo dphys-swapfile swapoff
sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
sudo dphys-swapfile setup
sudo dphys-swapfile swapon

# 2. Reduce Nginx worker processes
sudo nano /etc/nginx/nginx.conf
# Set: worker_processes 2;

# 3. Limit concurrent connections
# Edit zerodep-chat.service:
Environment=LIMIT_CONNECTIONS=100
```

### For Raspberry Pi 4/5 (4GB+ RAM)

```bash
# 1. Increase file descriptors
sudo nano /etc/systemd/system/zerodep-chat.service
# Add: LimitNOFILE=8192

# 2. Enable all CPU cores for Nginx
sudo nano /etc/nginx/nginx.conf
# Set: worker_processes 4;  # For Pi 4
# Or: worker_processes 4;   # For Pi 5

# 3. Increase Nginx worker connections
sudo nano /etc/nginx/nginx.conf
# Add in events {}:
# worker_connections 2048;

sudo systemctl daemon-reload
sudo systemctl restart zerodep-chat nginx
```

### Database Optimizations

Add to systemd service environment:

```ini
# Increase SQLite cache
Environment=PRAGMA_CACHE_SIZE=-128000

# Use memory for temporary tables
Environment=PRAGMA_TEMP_STORE=MEMORY
```

### Cooling

For sustained load:
- **Pi 3B+**: Heatsink required, fan recommended
- **Pi 4**: Active cooling (fan) required
- **Pi 5**: Active cooling mandatory

Monitor temperature:
```bash
watch -n 1 vcgencmd measure_temp
```

Should stay below 80°C under load.

---

## Troubleshooting

### Service Won't Start

```bash
# Check logs
sudo journalctl -u zerodep-chat -n 100 --no-pager

# Common issues:
# 1. Port already in use
sudo lsof -i :3000

# 2. Permission issues
sudo chown -R www-data:www-data /var/www/zerodep_chat

# 3. Database corruption
sudo -u www-data sqlite3 /var/www/zerodep_chat/data/chat.db "PRAGMA integrity_check;"
```

### High CPU Usage

```bash
# Check what's using CPU
top

# If Node.js is using 100% CPU:
# 1. Check for infinite loops in logs
sudo journalctl -u zerodep-chat -f

# 2. Restart service
sudo systemctl restart zerodep-chat

# 3. Check temperature
vcgencmd measure_temp  # Should be <80°C
```

### Out of Memory

```bash
# Check memory usage
free -h

# If out of memory:
# 1. Increase swap (see Performance Tuning)
# 2. Reduce concurrent connections
# 3. Restart service to clear memory
sudo systemctl restart zerodep-chat
```

### WebSocket Connection Issues

```bash
# 1. Check Nginx WebSocket configuration
sudo nginx -t

# 2. Test WebSocket endpoint
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:3000/

# 3. Check firewall
sudo ufw status
```

### Database Locked Errors

```bash
# 1. Check for multiple processes accessing database
sudo lsof /var/www/zerodep_chat/data/chat.db

# 2. Ensure WAL mode is enabled
sudo -u www-data sqlite3 /var/www/zerodep_chat/data/chat.db "PRAGMA journal_mode;"
# Should return: wal

# 3. Restart service
sudo systemctl restart zerodep-chat
```

### SSL Certificate Issues

```bash
# 1. Check certificate status
sudo certbot certificates

# 2. Test renewal
sudo certbot renew --dry-run

# 3. Force renewal
sudo certbot renew --force-renewal

# 4. Check Nginx configuration
sudo nginx -t
```

---

## Capacity Planning

### Expected Performance by Raspberry Pi Model

| Model | RAM | Concurrent Users | WebSocket Connections | Messages/sec |
|-------|-----|------------------|---------------------|--------------|
| Pi 3B+ | 1GB | 100-200 | 200 | 50 |
| Pi 4 (2GB) | 2GB | 300-500 | 500 | 100 |
| Pi 4 (4GB) | 4GB | 500-800 | 800 | 200 |
| Pi 4 (8GB) | 8GB | 800-1,200 | 1,200 | 300 |
| Pi 5 (4GB) | 4GB | 600-1,000 | 1,000 | 250 |
| Pi 5 (8GB) | 8GB | 1,000-1,500 | 1,500 | 400 |

**Notes:**
- Numbers assume active cooling and wired Ethernet
- WiFi reduces capacity by ~30%
- SD card reduces capacity by ~20% vs SSD

---

## Support

For issues or questions:
1. Check logs: `sudo journalctl -u zerodep-chat -f`
2. Review this guide
3. Open an issue on GitHub

---

**ZeroDep Chat on Raspberry Pi - True zero-dependency production deployment! 🎉**
