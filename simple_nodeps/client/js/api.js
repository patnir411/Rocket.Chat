// API Client - SimplChat

class API {
  constructor() {
    this.baseURL = window.location.origin + '/api';
    this.token = localStorage.getItem('token');
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

    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // Auth
  async login(username, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: { username, password },
    });
  }

  async register(username, email, password, displayName) {
    return this.request('/auth/register', {
      method: 'POST',
      body: { username, email, password, displayName },
    });
  }

  async logout() {
    return this.request('/auth/logout', { method: 'POST' });
  }

  async getMe() {
    return this.request('/auth/me');
  }

  // Rooms
  async getRooms() {
    return this.request('/rooms');
  }

  async createRoom(name, type, topic, description) {
    return this.request('/rooms', {
      method: 'POST',
      body: { name, type, topic, description },
    });
  }

  async createDM(userId) {
    return this.request('/rooms/dm', {
      method: 'POST',
      body: { userId },
    });
  }

  async getRoomMessages(roomId, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/rooms/${roomId}/messages${query ? '?' + query : ''}`);
  }

  async sendMessage(roomId, content, replyTo = null, threadId = null) {
    return this.request(`/rooms/${roomId}/messages`, {
      method: 'POST',
      body: { content, replyTo, threadId },
    });
  }

  async markRoomAsRead(roomId) {
    return this.request(`/rooms/${roomId}/read`, { method: 'POST' });
  }

  async joinRoom(roomId) {
    return this.request(`/rooms/${roomId}/join`, { method: 'POST' });
  }

  // Messages
  async updateMessage(messageId, content) {
    return this.request(`/messages/${messageId}`, {
      method: 'PUT',
      body: { content },
    });
  }

  async deleteMessage(messageId) {
    return this.request(`/messages/${messageId}`, { method: 'DELETE' });
  }

  async addReaction(messageId, emoji) {
    return this.request(`/messages/${messageId}/react`, {
      method: 'POST',
      body: { emoji },
    });
  }

  async searchMessages(query, roomId = null) {
    const params = new URLSearchParams({ q: query });
    if (roomId) params.append('roomId', roomId);
    return this.request(`/messages/search?${params}`);
  }

  // Users
  async updateStatus(status) {
    return this.request('/users/me/status', {
      method: 'PUT',
      body: { status },
    });
  }

  async searchUsers(query) {
    return this.request(`/users/search?q=${encodeURIComponent(query)}`);
  }
}

const api = new API();
