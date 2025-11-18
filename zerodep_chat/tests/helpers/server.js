/**
 * Test Server Helper - Zero Dependencies
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Use random available port

const TEST_DB_PATH = path.join(__dirname, '../tmp/test-server.db');

// Clean up test database
function cleanDatabase() {
  const dir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  // Also remove WAL files
  if (fs.existsSync(TEST_DB_PATH + '-shm')) {
    fs.unlinkSync(TEST_DB_PATH + '-shm');
  }
  if (fs.existsSync(TEST_DB_PATH + '-wal')) {
    fs.unlinkSync(TEST_DB_PATH + '-wal');
  }
}

// Override database path for tests
const originalRequire = require('node:module').prototype.require;
require('node:module').prototype.require = function(id) {
  if (id === '../../server/db/database' || id.endsWith('/server/db/database')) {
    const { Database } = originalRequire.apply(this, arguments);

    // Singleton for test database
    let testInstance = null;

    return {
      Database,
      getDatabase: () => {
        if (!testInstance) {
          testInstance = new Database(TEST_DB_PATH);
        }
        return testInstance;
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

let server = null;
let serverUrl = null;

async function startServer() {
  cleanDatabase();

  // Import server after cleaning database
  const serverModule = require('../../server/index.js');

  // Wait for server to start
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });

  // Get actual server instance (it's exported or we can get it from the module)
  // For now, we'll make HTTP requests to localhost
  const port = process.env.PORT || 3000;
  serverUrl = `http://localhost:${port}`;

  return serverUrl;
}

async function stopServer() {
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
    server = null;
  }

  // Clean up
  cleanDatabase();
}

async function request(method, path, options = {}) {
  const url = new URL(path, serverUrl);

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {};
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data,
          });
        } catch (err) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: body,
          });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

module.exports = {
  startServer,
  stopServer,
  request,
  cleanDatabase,
};
