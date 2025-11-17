const fs = require('fs');
const path = require('path');
const { getDb } = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

/**
 * Ensure migrations table exists
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Get list of executed migrations
 */
function getExecutedMigrations(db) {
  const rows = db.prepare('SELECT name FROM migrations ORDER BY id').all();
  return rows.map((row) => row.name);
}

/**
 * Get list of pending migrations
 */
function getPendingMigrations(db) {
  const executed = getExecutedMigrations(db);

  // Ensure migrations directory exists
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    return [];
  }

  const allMigrations = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  return allMigrations.filter((migration) => !executed.includes(migration));
}

/**
 * Execute a single migration
 */
function executeMigration(db, migrationName) {
  const migrationPath = path.join(MIGRATIONS_DIR, migrationName);
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log(`  ⚡ Executing migration: ${migrationName}`);

  // Split by semicolon and execute each statement
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const transaction = db.transaction(() => {
    for (const statement of statements) {
      db.exec(statement);
    }

    // Record migration
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
  });

  transaction();
  console.log(`  ✓ Migration completed: ${migrationName}`);
}

/**
 * Run all pending migrations
 */
function runMigrations() {
  const db = getDb();

  console.log('🔧 Running database migrations...');

  ensureMigrationsTable(db);

  const pending = getPendingMigrations(db);

  if (pending.length === 0) {
    console.log('✓ No pending migrations');
    return;
  }

  console.log(`📋 Found ${pending.length} pending migration(s)`);

  for (const migration of pending) {
    executeMigration(db, migration);
  }

  console.log('✓ All migrations completed successfully');
}

/**
 * Rollback last migration (if down.sql exists)
 */
function rollbackMigration() {
  const db = getDb();

  ensureMigrationsTable(db);

  const executed = getExecutedMigrations(db);

  if (executed.length === 0) {
    console.log('No migrations to rollback');
    return;
  }

  const lastMigration = executed[executed.length - 1];
  const rollbackPath = path.join(
    MIGRATIONS_DIR,
    lastMigration.replace('.sql', '.down.sql')
  );

  if (!fs.existsSync(rollbackPath)) {
    console.error(`Rollback file not found: ${rollbackPath}`);
    return;
  }

  console.log(`Rolling back: ${lastMigration}`);

  const sql = fs.readFileSync(rollbackPath, 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const transaction = db.transaction(() => {
    for (const statement of statements) {
      db.exec(statement);
    }

    db.prepare('DELETE FROM migrations WHERE name = ?').run(lastMigration);
  });

  transaction();
  console.log('✓ Rollback completed');
}

// Run migrations if this script is executed directly
if (require.main === module) {
  try {
    runMigrations();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

module.exports = {
  runMigrations,
  rollbackMigration,
  getPendingMigrations,
  getExecutedMigrations,
};
