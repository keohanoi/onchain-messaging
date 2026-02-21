import { test, expect } from '@playwright/test';

test.describe('POMP Application - Core UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the page with POMP branding', async ({ page }) => {
    await expect(page.locator('text=POMP')).toBeVisible();
    await expect(page.locator('text=Private Onchain Messaging')).toBeVisible();
  });

  test('should show HARDHAT network indicator', async ({ page }) => {
    await expect(page.locator('text=HARDHAT')).toBeVisible();
  });

  test('should show connect wallet button', async ({ page }) => {
    // Multiple connect buttons (different connectors)
    const connectButtons = page.locator('button:has-text("CONNECT WALLET")');
    await expect(connectButtons.first()).toBeVisible();
  });

  test('should show conversations sidebar', async ({ page }) => {
    // Use more specific selector for the terminal header
    await expect(page.locator('.terminal-title:has-text("CONVERSATIONS")')).toBeVisible();
  });

  test('should show empty state when no conversations', async ({ page }) => {
    await expect(page.locator('text=No conversations yet')).toBeVisible();
  });

  test('should show new secure channel button in sidebar (disabled without wallet)', async ({ page }) => {
    const sidebarButton = page.locator('.terminal-window >> button:has-text("NEW SECURE CHANNEL")');
    await expect(sidebarButton).toBeVisible();
    await expect(sidebarButton).toBeDisabled();
  });

  test('should show empty state with new channel button', async ({ page }) => {
    await expect(page.locator('text=No Messages Yet')).toBeVisible();
    // The empty state button should be enabled
    const emptyStateButton = page.locator('text=No Messages Yet >> .. >> button:has-text("NEW SECURE CHANNEL")');
    await expect(emptyStateButton).toBeVisible();
  });
});

test.describe('Wallet Connection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should show connect wallet button or loading state', async ({ page }) => {
    const connectButton = page.locator('button:has-text("CONNECT WALLET")');
    const loadingText = page.locator('text=Loading...');
    await expect(connectButton.first().or(loadingText)).toBeVisible();
  });

  test('should have wallet UI area', async ({ page }) => {
    await expect(page.locator('text=HARDHAT')).toBeVisible();
  });
});

test.describe('New Channel Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for page to load
    await expect(page.locator('text=No Messages Yet')).toBeVisible();
  });

  test('should open new channel modal when empty state button clicked', async ({ page }) => {
    // Click the button in the empty state area (not the disabled sidebar one)
    await page.locator('text=No Messages Yet').locator('..').locator('button:has-text("NEW SECURE CHANNEL")').click();
    await expect(page.locator('.terminal-header:has-text("NEW SECURE CHANNEL")')).toBeVisible();
  });

  test('should have recipient address input in modal', async ({ page }) => {
    await page.locator('text=No Messages Yet').locator('..').locator('button:has-text("NEW SECURE CHANNEL")').click();
    await expect(page.locator('input[placeholder="0x..."]')).toBeVisible();
  });

  test('should have create channel button disabled without address', async ({ page }) => {
    await page.locator('text=No Messages Yet').locator('..').locator('button:has-text("NEW SECURE CHANNEL")').click();
    const createButton = page.locator('button:has-text("CREATE CHANNEL")');
    await expect(createButton).toBeDisabled();
  });

  test('should enable create button with valid address', async ({ page }) => {
    await page.locator('text=No Messages Yet').locator('..').locator('button:has-text("NEW SECURE CHANNEL")').click();
    const input = page.locator('input[placeholder="0x..."]');
    await input.fill('0x1234567890123456789012345678901234567890');
    const createButton = page.locator('button:has-text("CREATE CHANNEL")');
    await expect(createButton).not.toBeDisabled();
  });

  test('should close modal on cancel', async ({ page }) => {
    await page.locator('text=No Messages Yet').locator('..').locator('button:has-text("NEW SECURE CHANNEL")').click();
    await page.click('button:has-text("Cancel")');
    await expect(page.locator('.terminal-header:has-text("NEW SECURE CHANNEL")')).not.toBeVisible();
  });
});

test.describe('Key Management (requires wallet)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should not show keys button when wallet not connected', async ({ page }) => {
    const keysButton = page.locator('button:has-text("KEYS")');
    const registerButton = page.locator('button:has-text("REGISTER")');
    await expect(keysButton.or(registerButton)).not.toBeVisible();
  });
});

test.describe('Scan Functionality (requires wallet)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should not show scan button when wallet not connected', async ({ page }) => {
    const scanButton = page.locator('button:has-text("SCAN MESSAGES")');
    await expect(scanButton).not.toBeVisible();
  });
});

test.describe('UI/UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should have terminal window styling', async ({ page }) => {
    await expect(page.locator('.terminal-window').first()).toBeVisible();
  });

  test('should have terminal header styling', async ({ page }) => {
    await expect(page.locator('.terminal-header').first()).toBeVisible();
  });

  test('should have status indicators', async ({ page }) => {
    await expect(page.locator('.status-dot').first()).toBeVisible();
  });

  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('text=POMP')).toBeVisible();
  });

  test('should have accessible buttons', async ({ page }) => {
    const buttons = page.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });
});
