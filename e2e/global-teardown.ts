import { FullConfig } from '@playwright/test';
import { teardownTestEnvironment } from './test-utils';

export default async function globalTeardown(config: FullConfig) {
  console.log('\n=== E2E Test Global Teardown ===\n');
  await teardownTestEnvironment();
}
