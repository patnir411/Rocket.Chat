/**
 * Zero-Dependency HTTP Server with Routing
 * Built using only node:http and node:url
 */

const http = require('node:http');
const { URL } = require('node:url');

class HttpServer {
  constructor() {
    this.routes = { GET: new Map(), POST: new Map(), PUT: new Map(), DELETE: new Map() };
    this.middlewares = [];
  }

  use(middleware) {
    this.middlewares.push(middleware);
  }

  get(path, handler) {
    this.routes.GET.set(path, handler);
  }

  post(path, handler) {
    this.routes.POST.set(path, handler);
  }

  put(path, handler) {
    this.routes.PUT.set(path, handler);
  }

  delete(path, handler) {
    this.routes.DELETE.set(path, handler);
  }

  async parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
        // Prevent memory attacks
        if (body.length > 10e6) {
          req.connection.destroy();
          reject(new Error('Request body too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  async handleRequest(req, res) {
    // Add helper methods to response
    res.json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    res.error = (message, status = 500) => {
      res.json({ error: message }, status);
    };

    try {
      // Parse URL
      const url = new URL(req.url, `http://${req.headers.host}`);
      req.path = url.pathname;
      req.query = Object.fromEntries(url.searchParams);

      // Parse body for POST/PUT
      if (req.method === 'POST' || req.method === 'PUT') {
        req.body = await this.parseBody(req);
      }

      // Run middlewares
      for (const middleware of this.middlewares) {
        const result = await new Promise((resolve) => {
          middleware(req, res, () => resolve(true));
        });
        if (!result || res.writableEnded) return;
      }

      // Find route
      const routes = this.routes[req.method];
      if (!routes) {
        return res.error('Method not allowed', 405);
      }

      // Match exact path
      let handler = routes.get(req.path);

      // Match path parameters (simple pattern: /path/:id)
      if (!handler) {
        for (const [pattern, h] of routes.entries()) {
          const match = this.matchPath(pattern, req.path);
          if (match) {
            req.params = match;
            handler = h;
            break;
          }
        }
      }

      if (!handler) {
        return res.error('Not found', 404);
      }

      await handler(req, res);

    } catch (error) {
      console.error('Request error:', error);
      if (!res.writableEnded) {
        res.error(error.message, error.status || 500);
      }
    }
  }

  matchPath(pattern, path) {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);

    if (patternParts.length !== pathParts.length) return null;

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }

    return Object.keys(params).length > 0 ? params : null;
  }

  listen(port, callback) {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(port, callback);
    return this.server;
  }

  close() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }
}

module.exports = { HttpServer };
