// Main Application - SimplChat

const app = {
  currentUser: null,
  currentRoom: null,
  rooms: [],
  typingTimeout: null,
  lastTypingTime: 0,
};

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  console.log('SimplChat initializing...');

  // Check if already logged in
  const token = localStorage.getItem('token');
  if (token) {
    try {
      api.setToken(token);
      const { user } = await api.getMe();
      app.currentUser = user;
      showChatScreen();
      ws.connect(token);
      await loadRooms();
    } catch (error) {
      console.error('Auto-login failed:', error);
      localStorage.removeItem('token');
      showLoginScreen();
    }
  } else {
    showLoginScreen();
  }

  setupEventListeners();
});

// Show/hide screens
function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('chat-screen').style.display = 'none';
}

function showChatScreen() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';
  document.getElementById('user-name').textContent = app.currentUser?.username || 'User';
  document.getElementById('user-avatar').textContent = (app.currentUser?.username || 'U')[0].toUpperCase();
}

// Event Listeners
function setupEventListeners() {
  // Auth
  document.getElementById('show-register').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
  });

  document.getElementById('show-login').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
  });

  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('register-btn').addEventListener('click', handleRegister);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Message input
  const messageInput = document.getElementById('message-input');
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    } else {
      handleTyping();
    }
  });

  messageInput.addEventListener('input', autoResize);
  document.getElementById('send-btn').addEventListener('click', sendMessage);

  // Status selector
  document.getElementById('status-selector').addEventListener('change', async (e) => {
    try {
      await api.updateStatus(e.target.value);
      ws.updatePresence(e.target.value);
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  });

  // WebSocket events
  ws.on('message', handleIncomingMessage);
  ws.on('typing', handleTypingIndicator);
  ws.on('presence', handlePresenceUpdate);
}

// Authentication
async function handleLogin() {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  try {
    const { token, user } = await api.login(username, password);
    api.setToken(token);
    app.currentUser = user;
    showChatScreen();
    ws.connect(token);
    await loadRooms();
  } catch (error) {
    showError('Login failed: ' + error.message);
  }
}

async function handleRegister() {
  const username = document.getElementById('register-username').value;
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const displayName = document.getElementById('register-displayname').value;

  try {
    await api.register(username, email, password, displayName);
    showSuccess('Account created! Please sign in.');
    document.getElementById('show-login').click();
  } catch (error) {
    showError('Registration failed: ' + error.message);
  }
}

async function handleLogout() {
  try {
    await api.logout();
  } catch (error) {
    console.error('Logout error:', error);
  }
  localStorage.removeItem('token');
  ws.disconnect();
  app.currentUser = null;
  app.currentRoom = null;
  app.rooms = [];
  showLoginScreen();
}

// Load rooms
async function loadRooms() {
  try {
    const { rooms } = await api.getRooms();
    app.rooms = rooms;
    renderRooms();
  } catch (error) {
    console.error('Failed to load rooms:', error);
  }
}

// Render rooms list
function renderRooms() {
  const container = document.getElementById('rooms-list');
  container.innerHTML = app.rooms.map(room => `
    <div class="room-item ${room.id === app.currentRoom?.id ? 'active' : ''}"
         data-room-id="${room.id}"
         onclick="selectRoom('${room.id}')">
      <div class="room-avatar">${getRoomAvatar(room)}</div>
      <div class="room-details">
        <div class="room-name">${escapeHtml(room.name || 'Direct Message')}</div>
        ${room.unread_count > 0 ? `<span class="unread-badge">${room.unread_count}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// Select room
async function selectRoom(roomId) {
  const room = app.rooms.find(r => r.id === roomId);
  if (!room) return;

  app.currentRoom = room;
  document.getElementById('no-room-selected').style.display = 'none';
  document.getElementById('room-view').style.display = 'flex';
  document.getElementById('room-name').textContent = room.name || 'Direct Message';
  document.getElementById('room-topic').textContent = room.topic || '';

  // Mark active in sidebar
  renderRooms();

  // Load messages
  await loadMessages(roomId);

  // Mark as read
  await api.markRoomAsRead(roomId);

  // Subscribe to room updates
  ws.subscribeRoom(roomId);
}

// Load messages
async function loadMessages(roomId) {
  try {
    const { messages } = await api.getRoomMessages(roomId, { limit: 50 });
    renderMessages(messages);
  } catch (error) {
    console.error('Failed to load messages:', error);
  }
}

// Render messages
function renderMessages(messages) {
  const container = document.getElementById('messages-list');
  container.innerHTML = messages.map(msg => createMessageHTML(msg)).join('');
  scrollToBottom();
}

// Create message HTML
function createMessageHTML(msg) {
  const isOwn = msg.user_id === app.currentUser?.id;
  return `
    <div class="message ${isOwn ? 'message-own' : ''}" data-message-id="${msg.id}">
      <div class="message-avatar">${(msg.username || 'U')[0].toUpperCase()}</div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-author">${escapeHtml(msg.username)}</span>
          <span class="message-time">${formatTime(msg.created_at)}</span>
        </div>
        <div class="message-text">${escapeHtml(msg.content)}</div>
      </div>
    </div>
  `;
}

// Send message
async function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();

  if (!content || !app.currentRoom) return;

  try {
    input.value = '';
    autoResize({ target: input });
    await api.sendMessage(app.currentRoom.id, content);

    // Stop typing indicator
    ws.sendTyping(app.currentRoom.id, false);
  } catch (error) {
    console.error('Failed to send message:', error);
    showError('Failed to send message');
  }
}

// Handle incoming WebSocket message
function handleIncomingMessage(data) {
  if (!app.currentRoom || data.message.room_id !== app.currentRoom.id) {
    // Update unread count
    const room = app.rooms.find(r => r.id === data.message.room_id);
    if (room) {
      room.unread_count = (room.unread_count || 0) + 1;
      renderRooms();
    }
    return;
  }

  // Append message to current room
  const container = document.getElementById('messages-list');
  container.insertAdjacentHTML('beforeend', createMessageHTML(data.message));
  scrollToBottom();
}

// Typing indicator
function handleTyping() {
  if (!app.currentRoom) return;

  const now = Date.now();
  if (now - app.lastTypingTime < 3000) return; // Throttle to once per 3s

  app.lastTypingTime = now;
  ws.sendTyping(app.currentRoom.id, true);

  // Auto-stop typing after 5s
  clearTimeout(app.typingTimeout);
  app.typingTimeout = setTimeout(() => {
    ws.sendTyping(app.currentRoom.id, false);
  }, 5000);
}

function handleTypingIndicator(data) {
  // Implementation for showing typing indicators
  console.log('Typing:', data);
}

function handlePresenceUpdate(data) {
  // Implementation for updating user presence
  console.log('Presence:', data);
}

// Utility functions
function autoResize(e) {
  e.target.style.height = 'auto';
  e.target.style.height = e.target.scrollHeight + 'px';
}

function scrollToBottom() {
  const container = document.getElementById('messages-scroll');
  container.scrollTop = container.scrollHeight;
}

function getRoomAvatar(room) {
  return (room.name || 'D')[0].toUpperCase();
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showError(message) {
  const errorEl = document.getElementById('auth-error');
  errorEl.textContent = message;
  errorEl.style.display = 'block';
  setTimeout(() => errorEl.style.display = 'none', 5000);
}

function showSuccess(message) {
  console.log('Success:', message);
  // Could implement toast notification
}
