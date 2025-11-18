/**
 * Zero-Dependency WebSocket Client
 * Pure vanilla JavaScript WebSocket connection
 */

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.token = null;
  }

  connect(token) {
    this.token = token;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.connected = true;
      this.reconnectAttempts = 0;

      // Authenticate
      this.send({ type: 'auth', token: this.token });

      this.emit('open');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.connected = false;
      this.authenticated = false;
      this.emit('close');

      // Attempt reconnection
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);
        setTimeout(() => this.connect(this.token), delay);
      } else {
        console.error('Max reconnection attempts reached');
        this.emit('error', new Error('Failed to reconnect'));
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    };
  }

  handleMessage(data) {
    switch (data.type) {
      case 'authenticated':
        this.authenticated = true;
        console.log('WebSocket authenticated');
        this.emit('authenticated', data);
        break;

      case 'auth_error':
        console.error('WebSocket auth error:', data.error);
        this.emit('auth_error', data);
        break;

      case 'message':
        this.emit('message', data.message);
        break;

      case 'message_updated':
        this.emit('message_updated', data.message);
        break;

      case 'message_deleted':
        this.emit('message_deleted', data.messageId);
        break;

      case 'reaction_added':
        this.emit('reaction_added', data);
        break;

      case 'reaction_removed':
        this.emit('reaction_removed', data);
        break;

      case 'typing':
        this.emit('typing', data);
        break;

      case 'user_status':
        this.emit('user_status', data);
        break;

      case 'subscribed':
        this.emit('subscribed', data.roomId);
        break;

      case 'unsubscribed':
        this.emit('unsubscribed', data.roomId);
        break;

      case 'pong':
        // Heartbeat response
        break;

      case 'error':
        console.error('WebSocket error:', data.error);
        this.emit('error', new Error(data.error));
        break;

      default:
        console.log('Unknown message type:', data.type);
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket not connected, cannot send:', data);
    }
  }

  subscribe(roomId) {
    this.send({ type: 'subscribe', roomId });
  }

  unsubscribe(roomId) {
    this.send({ type: 'unsubscribe', roomId });
  }

  sendTyping(roomId, isTyping) {
    this.send({ type: 'typing', roomId, isTyping });
  }

  ping() {
    this.send({ type: 'ping' });
  }

  disconnect() {
    if (this.ws) {
      this.maxReconnectAttempts = 0; // Prevent reconnection
      this.ws.close();
      this.ws = null;
    }
  }

  // Event emitter
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;

    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  emit(event, data) {
    if (!this.listeners.has(event)) return;

    const callbacks = this.listeners.get(event);
    for (const callback of callbacks) {
      try {
        callback(data);
      } catch (err) {
        console.error(`Error in ${event} listener:`, err);
      }
    }
  }
}

// Export global instance
const ws = new WebSocketClient();
