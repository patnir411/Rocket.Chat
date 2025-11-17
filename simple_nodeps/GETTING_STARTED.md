# Getting Started with SimplChat

## Quick Start (5 minutes)

### Option 1: Docker (Recommended)

```bash
# 1. Clone or navigate to the project
cd simple_nodeps

# 2. Start with Docker Compose
docker-compose up -d

# 3. Open your browser
open http://localhost:3000
```

That's it! SimplChat is now running.

### Option 2: Local Development

```bash
# 1. Navigate to server directory
cd simple_nodeps/server

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env

# 4. Run database migrations
npm run migrate

# 5. Start the server
npm start
```

Server will start at `http://localhost:3000`

## First Steps

### 1. Create Your First Account

1. Open `http://localhost:3000`
2. Click "Register"
3. Enter:
   - Username: `admin`
   - Password: `password123` (change this!)
   - Email: (optional)
4. Click "Create Account"
5. Sign in with your credentials

### 2. Create Your First Room

1. After logging in, click the `+` button in the sidebar
2. Enter room name: `general`
3. Select type: `channel` (public) or `private`
4. Click "Create"

### 3. Invite Team Members

Share the URL with your team: `http://localhost:3000` (or your domain)

Each person can register their own account.

## Configuration

### Environment Variables

Edit `server/.env`:

```bash
# Required
JWT_SECRET=your-random-secret-here  # CHANGE THIS!

# Optional
PORT=3000
ENABLE_REGISTRATION=true
MAX_FILE_SIZE=10485760  # 10MB
```

### Generate Secure JWT Secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output to `JWT_SECRET` in `.env`

## Deployment

### Production Checklist

- [ ] Change `JWT_SECRET` to a random value
- [ ] Set `NODE_ENV=production`
- [ ] Configure firewall (allow port 3000 or your port)
- [ ] Set up HTTPS reverse proxy (nginx/Caddy)
- [ ] Set up backups for database file
- [ ] Consider PostgreSQL for high concurrency

### Deploy to VPS

```bash
# 1. Copy files to server
scp -r simple_nodeps user@your-server:/opt/

# 2. SSH into server
ssh user@your-server

# 3. Navigate to directory
cd /opt/simple_nodeps

# 4. Start with Docker Compose
docker-compose up -d

# 5. Set up reverse proxy (optional but recommended)
# Example nginx config:

server {
    listen 80;
    server_name chat.your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Free Deployment Options

#### 1. Fly.io (Easiest)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Deploy
cd simple_nodeps
fly launch
fly deploy
```

#### 2. Railway

1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Set environment variables
5. Deploy!

#### 3. Oracle Cloud (Always Free Tier)

- 2 VMs (1GB RAM each)
- 200GB storage
- Completely free forever

Follow VPS instructions above.

## Database Options

### SQLite (Default)

**Pros:**
- Zero setup
- Single file
- Perfect for < 100 users

**Cons:**
- Limited concurrent writes
- No replication

**Use when:** Small team, single server

### PostgreSQL (Recommended for Production)

**Pros:**
- High performance
- Unlimited concurrent users
- Replication support
- JSON queries

**Setup:**

1. Install PostgreSQL
2. Create database:

```sql
CREATE DATABASE simplchat;
CREATE USER simplchat WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE simplchat TO simplchat;
```

3. Update `.env`:

```bash
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://simplchat:yourpassword@localhost:5432/simplchat
```

4. Install pg driver:

```bash
npm install pg
```

5. Run migrations:

```bash
npm run migrate
```

## Backup & Restore

### SQLite

**Backup:**

```bash
# Copy database file
cp server/chat.db backups/chat-$(date +%Y%m%d).db

# Or with Docker
docker cp <container-id>:/data/chat.db ./backup.db
```

**Restore:**

```bash
# Copy backup to server
cp backup.db server/chat.db

# Restart server
docker-compose restart
```

### Automated Backups

Add to crontab:

```bash
0 2 * * * cd /opt/simple_nodeps && docker exec simplchat_simplchat_1 sqlite3 /data/chat.db ".backup /data/backup-$(date +\%Y\%m\%d).db"
```

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok",
  "uptime": 12345,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Metrics

```bash
curl http://localhost:3000/metrics
```

Returns Prometheus-compatible metrics.

### Logs

```bash
# Docker logs
docker-compose logs -f

# Follow logs
tail -f /var/log/simplchat/app.log
```

## Troubleshooting

### Database locked error

**Cause:** Multiple servers accessing same SQLite file

**Solution:** Use PostgreSQL or ensure only one server instance

### WebSocket connection fails

**Cause:** Reverse proxy not configured for WebSocket

**Solution:** Add to nginx:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### Can't send messages

**Cause:** Not authenticated or not a room member

**Solution:**
1. Check browser console for errors
2. Verify JWT token in localStorage
3. Ensure you joined the room

### High memory usage

**Cause:** Too many WebSocket connections

**Solution:**
- Increase server RAM
- Add more server instances with load balancer
- Optimize connection pool

## Scaling

### Horizontal Scaling

SimplChat is designed for single-server deployments but can scale:

1. **Database:** Use PostgreSQL with connection pooling
2. **File Storage:** Use S3-compatible storage
3. **WebSocket:** Use sticky sessions in load balancer
4. **Caching:** Add Redis for session storage (future feature)

### Performance Tuning

**SQLite:**

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;  -- 64MB
```

**PostgreSQL:**

```sql
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
```

## Security Best Practices

1. **Change JWT_SECRET** - Use a strong random value
2. **Use HTTPS** - Set up SSL certificate (Let's Encrypt)
3. **Firewall** - Only expose ports 80/443
4. **Updates** - Keep Node.js and dependencies updated
5. **Backups** - Automated daily backups
6. **Rate Limiting** - Already built-in, tune if needed
7. **Monitoring** - Set up uptime monitoring

## Next Steps

1. ✅ Install and run SimplChat
2. ✅ Create your first account
3. ✅ Create rooms and invite team
4. 📖 Read [API Documentation](./docs/API.md)
5. 🎨 Customize theme in `client/css/variables.css`
6. 🔧 Explore advanced features
7. 🚀 Deploy to production

## Support

- **Issues:** Create a GitHub issue
- **Discussions:** Use GitHub Discussions
- **Documentation:** Check `/docs` folder

## Comparison

| Feature | SimplChat | Rocket.Chat | Slack |
|---------|-----------|-------------|-------|
| Cost | $0 | $0-$7/user/mo | $7.25/user/mo |
| Dependencies | 10 | 100+ | N/A |
| Setup Time | 5 min | 30-60 min | N/A |
| Self-hosted | ✅ | ✅ | ❌ |
| Open Source | ✅ | ✅ | ❌ |
| RAM Usage | 50-200MB | 500MB-2GB | N/A |
| Best For | Small teams | Enterprise | Cloud teams |

---

**Welcome to SimplChat!** 🚀

Built with ❤️ for zero-cost corporate communication.
