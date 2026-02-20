import { FullConfig } from '@playwright/test';
import { setupTestEnvironment, teardownTestEnvironment } from './test-utils';

export default async function globalSetup(config: FullConfig) {
  console.log('\n=== E2E Test Global Setup ===\n');

  try {
    await setupTestEnvironment();
    console.log('\n=== E2E Test Environment Ready ===\n');
  } catch (error) {
    console.error('Failed to setup test environment:', error);
    throw error;
  }
}
