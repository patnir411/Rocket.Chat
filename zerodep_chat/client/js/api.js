/**
 * Zero-Dependency API Client
 * Pure vanilla JavaScript, no frameworks
 */

class API {
  constructor(baseURL = '') {
    this.baseURL = baseURL;
    this.token = localStorage.getItem('token') || null;
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const config = {
      ...options,
      headers,
    };

    if (options.body) {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (err) {
      console.error('API Error:', err);
      throw err;
    }
  }

  // Auth
  async register(username, email, displayName, password) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: { username, email, display_name: displayName, password },
    });
  }

  async login(username, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    if (data.token) {
      this.setToken(data.token);
    }
    return data;
  }

  async logout() {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } finally {
      this.setToken(null);
    }
  }

  // Users
  async getMe() {
    return this.request('/api/users/me');
  }

  async updateProfile(updates) {
    return this.request('/api/users/me', {
      method: 'PUT',
      body: updates,
    });
  }

  async updateStatus(status, statusText) {
    return this.request('/api/users/me/status', {
      method: 'PUT',
      body: { status, statusText },
    });
  }

  async searchUsers(query, limit = 20) {
    return this.request(`/api/users/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async getUser(username) {
    return this.request(`/api/users/${username}`);
  }

  // Rooms
  async getRooms() {
    return this.request('/api/rooms');
  }

  async getRoom(roomId) {
    return this.request(`/api/rooms/${roomId}`);
  }

  async createRoom(name, type, description, members = []) {
    return this.request('/api/rooms', {
      method: 'POST',
      body: { name, type, description, members },
    });
  }

  async updateRoom(roomId, updates) {
    return this.request(`/api/rooms/${roomId}`, {
      method: 'PUT',
      body: updates,
    });
  }

  async joinRoom(roomId) {
    return this.request(`/api/rooms/${roomId}/join`, { method: 'POST' });
  }

  async leaveRoom(roomId) {
    return this.request(`/api/rooms/${roomId}/leave`, { method: 'POST' });
  }

  async getRoomMembers(roomId) {
    return this.request(`/api/rooms/${roomId}/members`);
  }

  async markRoomAsRead(roomId) {
    return this.request(`/api/rooms/${roomId}/read`, { method: 'POST' });
  }

  async getOrCreateDM(userId) {
    return this.request('/api/rooms/dm', {
      method: 'POST',
      body: { userId },
    });
  }

  // Messages
  async getMessages(roomId, limit = 50, before = null) {
    let url = `/api/rooms/${roomId}/messages?limit=${limit}`;
    if (before) {
      url += `&before=${encodeURIComponent(before)}`;
    }
    return this.request(url);
  }

  async sendMessage(roomId, content, replyTo = null, threadId = null) {
    return this.request(`/api/rooms/${roomId}/messages`, {
      method: 'POST',
      body: { content, replyTo, threadId },
    });
  }

  async updateMessage(messageId, content) {
    return this.request(`/api/messages/${messageId}`, {
      method: 'PUT',
      body: { content },
    });
  }

  async deleteMessage(messageId) {
    return this.request(`/api/messages/${messageId}`, { method: 'DELETE' });
  }

  async addReaction(messageId, emoji) {
    return this.request(`/api/messages/${messageId}/reactions`, {
      method: 'POST',
      body: { emoji },
    });
  }

  async removeReaction(messageId, emoji) {
    return this.request(`/api/messages/${messageId}/reactions/${emoji}`, {
      method: 'DELETE',
    });
  }

  async searchMessages(roomId, query, limit = 50) {
    return this.request(
      `/api/rooms/${roomId}/messages/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
  }
}

// Export global instance
const api = new API();
