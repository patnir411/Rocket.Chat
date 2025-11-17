const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

let db = null;

/**
 * Get database connection (singleton pattern)
 */
function getDb() {
  if (!db) {
    const dbPath = path.resolve(config.database.path);

    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(dbPath, {
      verbose: config.nodeEnv === 'development' ? console.log : null,
    });

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Performance optimizations
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000'); // 64MB cache

    console.log(`📦 Database connected: ${dbPath}`);
  }

  return db;
}

/**
 * Close database connection
 */
function closeDb() {
  if (db) {
    db.close();
    db = null;
    console.log('📦 Database closed');
  }
}

/**
 * Execute a database query
 */
function query(sql, params = []) {
  const database = getDb();
  return database.prepare(sql).all(params);
}

/**
 * Execute a database query and return single row
 */
function queryOne(sql, params = []) {
  const database = getDb();
  return database.prepare(sql).get(params);
}

/**
 * Execute an insert/update/delete query
 */
function execute(sql, params = []) {
  const database = getDb();
  return database.prepare(sql).run(params);
}

/**
 * Run a transaction
 */
function transaction(callback) {
  const database = getDb();
  return database.transaction(callback)();
}

module.exports = {
  getDb,
  closeDb,
  query,
  queryOne,
  execute,
  transaction,
};
