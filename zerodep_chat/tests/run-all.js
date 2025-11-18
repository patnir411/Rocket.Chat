#!/usr/bin/env node
/**
 * Test Runner - Zero Dependencies
 * Uses only node:test (Node.js 18+)
 */

console.log('🧪 Running ZeroDep Chat Test Suite\n');
console.log('═'.repeat(60));

// Run tests in order
const tests = [
  './unit/auth.test.js',
  './unit/database.test.js',
  './integration/services.test.js',
  './e2e/user-flow.test.js',
];

let hasFailures = false;

(async () => {
  for (const testFile of tests) {
    console.log(`\n📝 Running: ${testFile}`);
    console.log('─'.repeat(60));

    try {
      // Import and run test
      require(testFile);
    } catch (err) {
      console.error(`❌ Error loading ${testFile}:`, err.message);
      hasFailures = true;
    }
  }

  // Wait a bit for async tests to complete
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n' + '═'.repeat(60));
  if (hasFailures) {
    console.log('❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
    process.exit(0);
  }
})();
