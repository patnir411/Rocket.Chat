/**
 * Zero-Dependency Chat Application
 * Pure vanilla JavaScript, no frameworks
 */

const app = {
  currentUser: null,
  rooms: [],
  currentRoom: null,
  messages: [],
  typingUsers: new Map(),
  typingTimeout: null,
  lastTypingTime: 0,
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initWebSocket();
});

function initAuth() {
  const token = localStorage.getItem('token');

  if (token) {
    // Try to load user
    loadUser();
  } else {
    showLoginScreen();
  }

  // Auth form handlers
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

  document.getElementById('login-form-element').addEventListener('submit', handleLogin);
  document.getElementById('register-form-element').addEventListener('submit', handleRegister);

  // Logout
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Status change
  document.getElementById('status-select').addEventListener('change', (e) => {
    updateStatus(e.target.value);
  });
}

function initWebSocket() {
  ws.on('authenticated', () => {
    console.log('WebSocket authenticated');
  });

  ws.on('message', handleIncomingMessage);
  ws.on('message_updated', handleMessageUpdated);
  ws.on('message_deleted', handleMessageDeleted);
  ws.on('typing', handleTypingIndicator);
  ws.on('user_status', handleUserStatus);
  ws.on('reaction_added', handleReactionAdded);
  ws.on('reaction_removed', handleReactionRemoved);

  ws.on('error', (err) => {
    showToast(err.message, 'error');
  });
}

// ============================================================================
// AUTH HANDLERS
// ============================================================================

async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  try {
    const data = await api.login(username, password);
    app.currentUser = data.user;
    showChatScreen();
    showToast('Logged in successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleRegister(e) {
  e.preventDefault();

  const username = document.getElementById('register-username').value;
  const email = document.getElementById('register-email').value;
  const displayName = document.getElementById('register-display-name').value;
  const password = document.getElementById('register-password').value;

  try {
    await api.register(username, email, displayName, password);
    showToast('Registration successful! Please login.', 'success');
    document.getElementById('show-login').click();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleLogout() {
  try {
    await api.logout();
    ws.disconnect();
    app.currentUser = null;
    app.rooms = [];
    app.currentRoom = null;
    showLoginScreen();
    showToast('Logged out successfully', 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadUser() {
  try {
    const data = await api.getMe();
    app.currentUser = data.user;
    showChatScreen();
  } catch (err) {
    console.error('Failed to load user:', err);
    localStorage.removeItem('token');
    showLoginScreen();
  }
}

async function updateStatus(status) {
  try {
    await api.updateStatus(status);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// SCREEN MANAGEMENT
// ============================================================================

function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('chat-screen').style.display = 'none';
}

function showChatScreen() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'block';

  // Set user info
  document.getElementById('current-user-name').textContent =
    app.currentUser.display_name || app.currentUser.username;
  document.getElementById('current-user-avatar').textContent = getInitials(
    app.currentUser.display_name || app.currentUser.username
  );
  document.getElementById('status-select').value = app.currentUser.status || 'online';

  // Load rooms
  loadRooms();

  // Connect WebSocket
  ws.connect(api.token);

  // Initialize chat UI
  initChatUI();
}

function initChatUI() {
  // New room buttons
  document.getElementById('new-channel-btn').addEventListener('click', showNewChannelModal);
  document.getElementById('new-dm-btn').addEventListener('click', showNewDMModal);

  // Message input
  const messageInput = document.getElementById('message-input');
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  messageInput.addEventListener('input', handleTyping);

  document.getElementById('send-btn').addEventListener('click', sendMessage);
}

// ============================================================================
// ROOMS
// ============================================================================

async function loadRooms() {
  try {
    const data = await api.getRooms();
    app.rooms = data.rooms;
    renderRooms();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderRooms() {
  const roomsList = document.getElementById('rooms-list');
  roomsList.innerHTML = '';

  for (const room of app.rooms) {
    const roomEl = createRoomElement(room);
    roomsList.appendChild(roomEl);
  }
}

function createRoomElement(room) {
  const div = document.createElement('div');
  div.className = 'room-item';
  if (app.currentRoom && app.currentRoom.id === room.id) {
    div.classList.add('active');
  }

  const roomName = room.type === 'dm' ? (room.dm_user?.display_name || room.dm_user?.username || 'DM') : room.name;
  const roomType = room.type === 'channel' ? '#' : room.type === 'private' ? '🔒' : '💬';

  div.innerHTML = `
    <div class="room-item-info">
      <div class="room-item-header">
        <span class="room-type">${roomType}</span>
        <span class="room-name">${escapeHtml(roomName)}</span>
      </div>
    </div>
    ${room.unread_count > 0 ? `<span class="room-badge">${room.unread_count}</span>` : ''}
  `;

  div.addEventListener('click', () => selectRoom(room));

  return div;
}

async function selectRoom(room) {
  app.currentRoom = room;
  app.messages = [];

  // Update UI
  renderRooms();
  document.getElementById('welcome-view').style.display = 'none';
  document.getElementById('room-view').style.display = 'flex';

  const roomName = room.type === 'dm' ? (room.dm_user?.display_name || room.dm_user?.username || 'DM') : room.name;
  document.getElementById('room-name').textContent = roomName;
  document.getElementById('room-description').textContent = room.description || '';

  // Subscribe to room via WebSocket
  ws.subscribe(room.id);

  // Load messages
  try {
    const data = await api.getMessages(room.id);
    app.messages = data.messages;
    renderMessages();

    // Mark as read
    await api.markRoomAsRead(room.id);
    room.unread_count = 0;
    renderRooms();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showNewChannelModal() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h3>Create Channel</h3>
    <form id="new-channel-form">
      <div class="form-group">
        <label>Channel Name</label>
        <input type="text" id="channel-name" required minlength="3">
      </div>
      <div class="form-group">
        <label>Type</label>
        <select id="channel-type">
          <option value="channel">Public Channel</option>
          <option value="private">Private Channel</option>
        </select>
      </div>
      <div class="form-group">
        <label>Description (optional)</label>
        <textarea id="channel-description" rows="3"></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create</button>
      </div>
    </form>
  `;

  document.getElementById('new-channel-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('channel-name').value;
    const type = document.getElementById('channel-type').value;
    const description = document.getElementById('channel-description').value;

    try {
      const data = await api.createRoom(name, type, description);
      app.rooms.push(data.room);
      renderRooms();
      selectRoom(data.room);
      closeModal();
      showToast('Channel created!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  showModal();
}

async function showNewDMModal() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h3>New Direct Message</h3>
    <form id="new-dm-form">
      <div class="form-group">
        <label>Search Users</label>
        <input type="text" id="user-search" placeholder="Type to search...">
      </div>
      <div id="user-results"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      </div>
    </form>
  `;

  const searchInput = document.getElementById('user-search');
  const resultsDiv = document.getElementById('user-results');

  let searchTimeout;
  searchInput.addEventListener('input', async (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();

    if (query.length < 2) {
      resultsDiv.innerHTML = '';
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        const data = await api.searchUsers(query);
        resultsDiv.innerHTML = data.users
          .filter(u => u.id !== app.currentUser.id)
          .map(
            u => `
          <div class="user-result" style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--border);" data-user-id="${u.id}">
            <strong>${escapeHtml(u.display_name || u.username)}</strong>
            <span style="color: var(--text-secondary);">@${escapeHtml(u.username)}</span>
          </div>
        `
          )
          .join('');

        // Add click handlers
        resultsDiv.querySelectorAll('.user-result').forEach(el => {
          el.addEventListener('click', async () => {
            const userId = el.dataset.userId;
            try {
              const data = await api.getOrCreateDM(userId);
              const existingRoom = app.rooms.find(r => r.id === data.room.id);
              if (!existingRoom) {
                app.rooms.push(data.room);
                renderRooms();
              }
              selectRoom(data.room);
              closeModal();
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        });
      } catch (err) {
        showToast(err.message, 'error');
      }
    }, 300);
  });

  showModal();
}

// ============================================================================
// MESSAGES
// ============================================================================

function renderMessages() {
  const messagesList = document.getElementById('messages-list');
  messagesList.innerHTML = '';

  for (const message of app.messages) {
    const messageEl = createMessageElement(message);
    messagesList.appendChild(messageEl);
  }

  scrollToBottom();
}

function createMessageElement(message) {
  const div = document.createElement('div');
  div.className = 'message';
  div.dataset.messageId = message.id;

  const author = message.display_name || message.username;
  const time = formatTime(message.created_at);
  const content = formatMessageContent(message.content);

  const reactionsHtml =
    message.reactions && message.reactions.length > 0
      ? `
    <div class="message-reactions">
      ${message.reactions.map(r => `<span class="reaction">${r.emoji} ${r.count}</span>`).join('')}
    </div>
  `
      : '';

  div.innerHTML = `
    <div class="message-avatar">${getInitials(author)}</div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-author">${escapeHtml(author)}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-text">${content}</div>
      ${reactionsHtml}
    </div>
  `;

  return div;
}

async function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();

  if (!content || !app.currentRoom) return;

  try {
    // Clear input immediately for better UX
    input.value = '';
    input.style.height = 'auto';

    // Stop typing indicator
    if (app.currentRoom) {
      ws.sendTyping(app.currentRoom.id, false);
    }

    // Send message
    await api.sendMessage(app.currentRoom.id, content);
  } catch (err) {
    showToast(err.message, 'error');
    input.value = content; // Restore on error
  }
}

function handleIncomingMessage(message) {
  // Add to messages if in current room
  if (app.currentRoom && message.room_id === app.currentRoom.id) {
    app.messages.push(message);
    const messageEl = createMessageElement(message);
    document.getElementById('messages-list').appendChild(messageEl);
    scrollToBottom();
  } else {
    // Update unread count
    const room = app.rooms.find(r => r.id === message.room_id);
    if (room) {
      room.unread_count = (room.unread_count || 0) + 1;
      renderRooms();
    }
  }
}

function handleMessageUpdated(message) {
  const messageEl = document.querySelector(`[data-message-id="${message.id}"]`);
  if (messageEl) {
    const newEl = createMessageElement(message);
    messageEl.replaceWith(newEl);
  }
}

function handleMessageDeleted(messageId) {
  const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageEl) {
    messageEl.remove();
  }
  app.messages = app.messages.filter(m => m.id !== messageId);
}

function handleReactionAdded(data) {
  const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (messageEl) {
    // Update message in app.messages
    const message = app.messages.find(m => m.id === data.messageId);
    if (message) {
      message.reactions = data.reactions;
      const newEl = createMessageElement(message);
      messageEl.replaceWith(newEl);
    }
  }
}

function handleReactionRemoved(data) {
  handleReactionAdded(data); // Same update logic
}

function handleTyping(e) {
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

  // Auto-resize textarea
  e.target.style.height = 'auto';
  e.target.style.height = e.target.scrollHeight + 'px';
}

function handleTypingIndicator(data) {
  if (!app.currentRoom || data.roomId !== app.currentRoom.id) return;

  if (data.userId === app.currentUser.id) return; // Ignore own typing

  if (data.isTyping) {
    app.typingUsers.set(data.userId, true);
  } else {
    app.typingUsers.delete(data.userId);
  }

  updateTypingIndicator();
}

function updateTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  const usersSpan = document.getElementById('typing-users');

  if (app.typingUsers.size === 0) {
    indicator.style.display = 'none';
  } else {
    const count = app.typingUsers.size;
    usersSpan.textContent = count === 1 ? 'Someone is' : `${count} people are`;
    indicator.style.display = 'block';
  }
}

function handleUserStatus(data) {
  // Update user status in rooms list if it's a DM
  for (const room of app.rooms) {
    if (room.type === 'dm' && room.dm_user && room.dm_user.id === data.userId) {
      room.dm_user.status = data.status;
      renderRooms();
    }
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function showModal() {
  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

// Make closeModal global for onclick handlers
window.closeModal = closeModal;

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function scrollToBottom() {
  const container = document.getElementById('messages-container');
  container.scrollTop = container.scrollHeight;
}

function getInitials(name) {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;

  // Less than 1 day ago, show time
  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Less than 7 days ago, show day and time
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // Otherwise show date
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMessageContent(content) {
  // Escape HTML
  let formatted = escapeHtml(content);

  // Format mentions
  formatted = formatted.replace(/@([\w-]+)/g, '<span class="mention">@$1</span>');

  // Format line breaks
  formatted = formatted.replace(/\n/g, '<br>');

  return formatted;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
