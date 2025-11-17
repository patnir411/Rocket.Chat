// WebSocket Client - SimplChat

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.handlers = new Map();
    this.connected = false;
    this.authenticated = false;
  }

  connect(token) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    console.log('Connecting to WebSocket:', wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('✓ WebSocket connected');
      this.connected = true;
      this.reconnectAttempts = 0;

      // Authenticate
      this.send({
        type: 'auth',
        token,
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.connected = false;
      this.authenticated = false;

      // Attempt reconnection
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        setTimeout(() => this.connect(token), delay);
      }
    };
  }

  handleMessage(data) {
    const { type } = data;

    // Handle authentication response
    if (type === 'auth') {
      if (data.success) {
        console.log('✓ WebSocket authenticated');
        this.authenticated = true;
        this.emit('authenticated', data);
      } else {
        console.error('Authentication failed');
      }
      return;
    }

    // Emit event to registered handlers
    this.emit(type, data);
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket not connected');
    }
  }

  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);
  }

  off(event, handler) {
    if (this.handlers.has(event)) {
      const handlers = this.handlers.get(event);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.handlers.has(event)) {
      this.handlers.get(event).forEach(handler => handler(data));
    }
  }

  // Send typing indicator
  sendTyping(roomId, isTyping) {
    this.send({
      type: 'typing',
      roomId,
      isTyping,
    });
  }

  // Update presence status
  updatePresence(status) {
    this.send({
      type: 'presence',
      status,
    });
  }

  // Subscribe to room updates
  subscribeRoom(roomId) {
    this.send({
      type: 'subscribe_room',
      roomId,
    });
  }

  // Unsubscribe from room updates
  unsubscribeRoom(roomId) {
    this.send({
      type: 'unsubscribe_room',
      roomId,
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

const ws = new WebSocketClient();
