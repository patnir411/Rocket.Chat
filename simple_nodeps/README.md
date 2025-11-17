# SimplChat - Minimal Dependency Group Chat

A production-ready, zero-cost corporate chat application built with minimal dependencies, inspired by Rocket.Chat's architecture patterns.

## 🎯 Features

- ✅ **Real-time messaging** via WebSocket
- ✅ **Multiple room types** (public channels, private groups, direct messages)
- ✅ **User authentication** with JWT tokens
- ✅ **Presence tracking** (online/offline/away status)
- ✅ **Typing indicators** with debouncing
- ✅ **Message threading** and replies
- ✅ **File uploads** with image thumbnails
- ✅ **User mentions** (@username)
- ✅ **Message search** with full-text indexing
- ✅ **Unread count tracking** per room
- ✅ **Message editing and deletion**
- ✅ **Emoji reactions**
- ✅ **Role-based permissions** (admin, moderator, user)
- ✅ **Rate limiting** to prevent abuse
- ✅ **Health checks** and metrics
- ✅ **Database migrations** system

## 🚀 Technology Stack

### Backend (10 core dependencies)
- **Express.js** - HTTP server and routing
- **ws** - WebSocket server
- **better-sqlite3** - SQLite database (or `pg` for PostgreSQL)
- **bcrypt** - Password hashing
- **jsonwebtoken** - JWT authentication
- **multer** - File upload handling
- **helmet** - Security headers
- **cors** - Cross-origin resource sharing
- **compression** - Response compression
- **dotenv** - Environment configuration

### Frontend (Zero dependencies)
- **Vanilla JavaScript** - No framework overhead
- **CSS Variables** - Theming support
- **Native WebSocket API** - Built-in browser support
- **LocalStorage** - Client-side caching

## 📦 Installation

### Prerequisites
- Node.js 14+
- npm or yarn

### Quick Start

```bash
# Clone and navigate
cd simple_nodeps

# Install server dependencies
cd server
npm install

# Setup database
npm run migrate

# Start server
npm start
```

The application will be available at `http://localhost:3000`

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_TYPE=sqlite        # or 'postgres'
DATABASE_PATH=./chat.db     # for SQLite
# DATABASE_URL=postgresql://user:pass@localhost:5432/chat  # for PostgreSQL

# Security
JWT_SECRET=your-secret-key-change-this
JWT_EXPIRES_IN=7d

# File Upload
MAX_FILE_SIZE=10485760      # 10MB in bytes
UPLOAD_DIR=./uploads

# Features
ENABLE_REGISTRATION=true
REQUIRE_EMAIL_VERIFICATION=false
```

## 🐳 Docker Deployment

```bash
# Build and run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## 📊 Architecture

```
┌─────────────────────────────────────────┐
│         Client (Browser)                 │
│  - Vanilla JS                            │
│  - WebSocket connection                  │
│  - Local state management                │
└─────────────────┬───────────────────────┘
                  │ WebSocket + REST
                  ↓
┌─────────────────────────────────────────┐
│      Express.js Server                   │
│  ├─ REST API (auth, rooms, messages)    │
│  ├─ WebSocket Server (real-time)        │
│  ├─ JWT Authentication                   │
│  ├─ Rate Limiting                        │
│  └─ File Upload Handling                 │
└─────────────────┬───────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────┐
│      SQLite / PostgreSQL                 │
│  ├─ users                                │
│  ├─ rooms                                │
│  ├─ room_members                         │
│  ├─ messages                             │
│  ├─ reactions                            │
│  └─ sessions                             │
└─────────────────────────────────────────┘
```

## 🔒 Security Features

- **Password Hashing**: bcrypt with salt rounds
- **JWT Authentication**: Stateless, secure tokens
- **Rate Limiting**: Prevents brute force attacks
- **Input Validation**: Sanitizes all user input
- **SQL Injection Protection**: Parameterized queries
- **XSS Prevention**: Content sanitization
- **CORS**: Configurable origin restrictions
- **Security Headers**: Helmet.js integration

## 📈 Scaling

| Users | Setup | Database | Estimated Cost |
|-------|-------|----------|----------------|
| 1-100 | Single server + SQLite | SQLite file | $0/month (self-host) |
| 100-1,000 | Single server + PostgreSQL | PostgreSQL | $0-25/month |
| 1,000-10,000 | Load balanced + PostgreSQL | Managed PostgreSQL | $50-200/month |

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run in development mode (auto-reload)
npm run dev

# Run database migrations
npm run migrate

# Create new migration
npm run migrate:create add_feature_name

# Run tests
npm test

# Lint code
npm run lint
```

## 📚 API Documentation

### Authentication
- `POST /api/register` - Create new user account
- `POST /api/login` - Authenticate and get JWT token
- `POST /api/logout` - Invalidate current session

### Rooms
- `GET /api/rooms` - List user's rooms
- `POST /api/rooms` - Create new room
- `GET /api/rooms/:id` - Get room details
- `PUT /api/rooms/:id` - Update room
- `DELETE /api/rooms/:id` - Delete room
- `POST /api/rooms/:id/join` - Join room
- `POST /api/rooms/:id/leave` - Leave room
- `POST /api/rooms/:id/invite` - Invite user to room

### Messages
- `GET /api/rooms/:id/messages` - Get messages (paginated)
- `POST /api/rooms/:id/messages` - Send message
- `PUT /api/messages/:id` - Edit message
- `DELETE /api/messages/:id` - Delete message
- `POST /api/messages/:id/react` - Add emoji reaction
- `GET /api/messages/search` - Search messages

### Users
- `GET /api/users/me` - Get current user profile
- `PUT /api/users/me` - Update profile
- `GET /api/users/search` - Search users
- `GET /api/users/:id` - Get user profile

### WebSocket Events

#### Client → Server
- `auth` - Authenticate WebSocket connection
- `message` - Send chat message
- `typing` - Send typing indicator
- `presence` - Update presence status

#### Server → Client
- `message` - New message received
- `typing` - User typing notification
- `presence` - User presence update
- `room_update` - Room information changed
- `error` - Error notification

## 🎨 Customization

### Theming

Edit `client/css/variables.css` to customize colors:

```css
:root {
  --primary: #007bff;
  --secondary: #6c757d;
  --success: #28a745;
  --danger: #dc3545;
  --warning: #ffc107;
  --info: #17a2b8;

  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --text-primary: #212529;
  --text-secondary: #6c757d;
}
```

### Dark Mode

Dark mode is automatically detected from system preferences and can be toggled manually.

## 🔧 Troubleshooting

### Database locked error (SQLite)
- Ensure only one server instance is running
- Check file permissions on database file
- Consider switching to PostgreSQL for concurrent access

### WebSocket connection fails
- Check firewall allows WebSocket connections
- Verify `ROOT_URL` matches your deployment URL
- Check browser console for CORS errors

### File uploads not working
- Verify `UPLOAD_DIR` directory exists and is writable
- Check `MAX_FILE_SIZE` is appropriate
- Ensure disk space is available

## 📄 License

MIT License - Free for personal and commercial use

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

- Documentation: See `/docs` folder
- Issues: Create a GitHub issue
- Discussions: Use GitHub Discussions

## 🙏 Acknowledgments

Architecture patterns inspired by Rocket.Chat, simplified for minimal dependencies and maximum efficiency.

---

**Built with ❤️ for zero-cost corporate communication**
