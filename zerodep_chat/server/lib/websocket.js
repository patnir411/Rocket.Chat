/**
 * Zero-Dependency WebSocket Implementation (RFC 6455)
 * Built using only node:crypto and node:events
 */

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// WebSocket opcodes
const OPCODES = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xA,
};

class WebSocketConnection extends EventEmitter {
  constructor(socket, id) {
    super();
    this.socket = socket;
    this.id = id;
    this.readyState = 1; // OPEN
    this.buffer = Buffer.alloc(0);

    this.socket.on('data', (data) => this.handleData(data));
    this.socket.on('close', () => this.handleClose());
    this.socket.on('error', (err) => this.emit('error', err));

    // Ping interval to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.readyState === 1) {
        this.sendFrame(OPCODES.PING, Buffer.from('ping'));
      }
    }, 30000);
  }

  handleData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= 2) {
      // Parse frame header
      const byte1 = this.buffer[0];
      const byte2 = this.buffer[1];

      const fin = (byte1 & 0x80) !== 0;
      const opcode = byte1 & 0x0F;
      const masked = (byte2 & 0x80) !== 0;
      let payloadLength = byte2 & 0x7F;

      let offset = 2;

      // Extended payload length
      if (payloadLength === 126) {
        if (this.buffer.length < 4) return; // Need more data
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return; // Need more data
        // Read 64-bit length (we'll limit to 32-bit for safety)
        const high = this.buffer.readUInt32BE(2);
        const low = this.buffer.readUInt32BE(6);
        if (high !== 0) {
          this.close(1009, 'Message too large');
          return;
        }
        payloadLength = low;
        offset = 10;
      }

      // Masking key (if masked)
      let maskingKey;
      if (masked) {
        if (this.buffer.length < offset + 4) return; // Need more data
        maskingKey = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      // Check if we have the full payload
      if (this.buffer.length < offset + payloadLength) return;

      // Extract payload
      let payload = this.buffer.slice(offset, offset + payloadLength);

      // Unmask if needed
      if (masked && maskingKey) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskingKey[i % 4];
        }
      }

      // Move buffer forward
      this.buffer = this.buffer.slice(offset + payloadLength);

      // Handle frame based on opcode
      this.handleFrame(opcode, payload, fin);
    }
  }

  handleFrame(opcode, payload, fin) {
    switch (opcode) {
      case OPCODES.TEXT:
        this.emit('message', payload.toString('utf8'));
        break;

      case OPCODES.BINARY:
        this.emit('message', payload);
        break;

      case OPCODES.CLOSE:
        this.close();
        break;

      case OPCODES.PING:
        this.sendFrame(OPCODES.PONG, payload);
        break;

      case OPCODES.PONG:
        // Received pong, connection is alive
        break;

      default:
        // Unknown opcode
        break;
    }
  }

  sendFrame(opcode, payload) {
    if (this.readyState !== 1) return;

    const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const payloadLength = payloadBuffer.length;

    let frame;
    let offset = 0;

    // Determine frame size
    if (payloadLength < 126) {
      frame = Buffer.allocUnsafe(2 + payloadLength);
      frame[1] = payloadLength;
      offset = 2;
    } else if (payloadLength < 65536) {
      frame = Buffer.allocUnsafe(4 + payloadLength);
      frame[1] = 126;
      frame.writeUInt16BE(payloadLength, 2);
      offset = 4;
    } else {
      frame = Buffer.allocUnsafe(10 + payloadLength);
      frame[1] = 127;
      frame.writeUInt32BE(0, 2); // High 32 bits
      frame.writeUInt32BE(payloadLength, 6); // Low 32 bits
      offset = 10;
    }

    // Set FIN and opcode
    frame[0] = 0x80 | opcode;

    // Copy payload
    payloadBuffer.copy(frame, offset);

    try {
      this.socket.write(frame);
    } catch (err) {
      this.emit('error', err);
    }
  }

  send(message) {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    this.sendFrame(OPCODES.TEXT, payload);
  }

  close(code = 1000, reason = '') {
    if (this.readyState !== 1) return;

    this.readyState = 2; // CLOSING

    // Send close frame
    const buf = Buffer.allocUnsafe(2 + Buffer.byteLength(reason));
    buf.writeUInt16BE(code, 0);
    buf.write(reason, 2);
    this.sendFrame(OPCODES.CLOSE, buf);

    // Close socket
    clearInterval(this.pingInterval);
    this.socket.end();
    this.readyState = 3; // CLOSED
  }

  handleClose() {
    clearInterval(this.pingInterval);
    this.readyState = 3; // CLOSED
    this.emit('close');
  }
}

class WebSocketServer extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.nextId = 1;
  }

  handleUpgrade(req, socket, head) {
    // Check for WebSocket upgrade request
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    // Compute accept key
    const hash = crypto.createHash('sha1');
    hash.update(key + WS_MAGIC_STRING);
    const acceptKey = hash.digest('base64');

    // Send upgrade response
    const response = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      '',
    ].join('\r\n');

    socket.write(response);

    // Create WebSocket connection
    const ws = new WebSocketConnection(socket, this.nextId++);
    this.clients.set(ws.id, ws);

    ws.on('close', () => {
      this.clients.delete(ws.id);
    });

    this.emit('connection', ws, req);
  }

  broadcast(message, exclude = null) {
    for (const [id, client] of this.clients) {
      if (exclude && id === exclude) continue;
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  close() {
    for (const client of this.clients.values()) {
      client.close();
    }
    this.clients.clear();
  }
}

module.exports = { WebSocketServer, WebSocketConnection };
