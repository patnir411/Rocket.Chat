/**
 * Test Runner - Zero Dependencies
 * Uses only node:test and node:assert (Node.js 18+)
 */

const { run } = require('node:test');
const { spec } = require('node:test/reporters');
const { glob } = require('node:fs');

// Run all test files
run({
  files: [
    'tests/unit/**/*.test.js',
    'tests/integration/**/*.test.js',
    'tests/e2e/**/*.test.js'
  ],
  concurrency: 1, // Run sequentially for database tests
})
  .on('test:fail', () => {
    process.exitCode = 1;
  })
  .compose(spec)
  .pipe(process.stdout);
