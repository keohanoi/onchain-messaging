import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.test.js'], // Exclude Hardhat/Mocha tests
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Exclude files not in unit test scope:
      // - index.ts: barrel export only
      // - types.ts: type definitions only
      // - circomlibjs.d.ts: type definitions
      // - client.ts: integration code (requires network)
      // - storage.ts: IPFS/Arweave integration (requires network)
      exclude: [
        'src/index.ts',
        'src/types.ts',
        'src/circomlibjs.d.ts',
        'src/client.ts',
        'src/storage.ts'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70 // Lower due to some edge cases in ratchet/zkProof
      }
    },
    testTimeout: 30000 // Increase for crypto operations
  }
});
