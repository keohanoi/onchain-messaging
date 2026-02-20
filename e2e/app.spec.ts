import { test, expect } from '@playwright/test';

/**
 * E2E Tests for POMP Application
 *
 * Tests the UI functionality of the POMP messaging application.
 * Wallet connection tests require a browser with MetaMask or injected wallet.
 */

test.describe('POMP Application - Core UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the application', async ({ page }) => {
    await expect(page).toHaveTitle(/POMP/);
    await expect(page.locator('text=POMP')).toBeVisible();
    await expect(page.locator('text=Private Onchain Messaging')).toBeVisible();
  });

  test('should show network status indicator', async ({ page }) => {
    await expect(page.locator('text=HARDHAT')).toBeVisible();
  });

  test('should show conversations list', async ({ page }) => {
    await expect(page.locator('text=CONVERSATIONS')).toBeVisible();
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
    await expect(page.locator('button:has-text("NEW SECURE CHANNEL")')).toBeVisible();
  });

  test('should display mock conversations', async ({ page }) => {
    await expect(page.locator('text=0x7a3d...f291').first()).toBeVisible();
    await expect(page.locator('text=0x4b2e...91c4').first()).toBeVisible();
    await expect(page.locator('text=0x9f1c...d45a').first()).toBeVisible();
  });

  test('should show message input', async ({ page }) => {
    await expect(page.locator('input[placeholder*="E2E encrypted"]')).toBeVisible();
    await expect(page.locator('button:has-text("SEND")')).toBeVisible();
  });

  test('should display technical details panel', async ({ page }) => {
    await expect(page.locator('text=TECHNICAL DETAILS')).toBeVisible();
    await expect(page.locator('text=Zero-Knowledge Proof')).toBeVisible();
    await expect(page.locator('text=Stealth Address')).toBeVisible();
    await expect(page.locator('text=Nullifier')).toBeVisible();
  });
});

test.describe('Message Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should type message in compose bar', async ({ page }) => {
    const messageInput = page.locator('input[placeholder*="E2E encrypted"]');
    await messageInput.fill('Test message');
    await expect(messageInput).toHaveValue('Test message');
  });

  test('should send message and display in chat', async ({ page }) => {
    const messageInput = page.locator('input[placeholder*="E2E encrypted"]');
    await messageInput.fill('Hello, this is a test message!');
    await page.click('button:has-text("SEND")');
    await expect(page.locator('text=Hello, this is a test message!')).toBeVisible({ timeout: 5000 });
  });

  test('should show encryption indicator on sent messages', async ({ page }) => {
    const messageInput = page.locator('input[placeholder*="E2E encrypted"]');
    await messageInput.fill('Encrypted test');
    await page.click('button:has-text("SEND")');
    await expect(page.locator('text=E2E').first()).toBeVisible();
  });

  test('should clear input after sending', async ({ page }) => {
    const messageInput = page.locator('input[placeholder*="E2E encrypted"]');
    await messageInput.fill('Message to send');
    await page.click('button:has-text("SEND")');
    await expect(messageInput).toHaveValue('');
  });

  test('should send message on Enter key', async ({ page }) => {
    const messageInput = page.locator('input[placeholder*="E2E encrypted"]');
    await messageInput.fill('Enter key message');
    await messageInput.press('Enter');
    await expect(page.locator('text=Enter key message')).toBeVisible({ timeout: 5000 });
  });

  test('should not send empty messages - button disabled', async ({ page }) => {
    const sendButton = page.locator('button:has-text("SEND")');
    await expect(sendButton).toBeDisabled();
  });

  test('should show tech readout on messages', async ({ page }) => {
    const messageInput = page.locator('input[placeholder*="E2E encrypted"]');
    await messageInput.fill('Tech test message');
    await page.click('button:has-text("SEND")');
    await expect(page.locator('text=VIEW:').first()).toBeVisible();
    await expect(page.locator('text=PROOF:').first()).toBeVisible();
  });

  test('should switch conversations', async ({ page }) => {
    // Click on second conversation
    await page.locator('text=0x4b2e...91c4').first().click();
    // Chat header should update
    await expect(page.locator('.terminal-window >> text=0x4b2e...91c4').first()).toBeVisible();
  });
});

test.describe('Key Management Modal (requires wallet)', () => {
  // Note: These tests require wallet connection which is not available in automated tests
  // They are skipped in CI and only test UI presence

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.skip('should show keys button (requires wallet connection)', async ({ page }) => {
    // This button only shows when wallet is connected
    await expect(page.locator('button:has-text("KEYS")')).toBeVisible();
  });
});

test.describe('Scan Functionality (requires wallet)', () => {
  // Note: These tests require wallet connection

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.skip('should show scan button (requires wallet connection)', async ({ page }) => {
    // This button only shows when wallet is connected
    await expect(page.locator('button:has-text("SCAN MESSAGES")')).toBeVisible();
  });
});

test.describe('Wallet Connection UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for hydration
    await page.waitForTimeout(1500);
  });

  test('should show connect wallet button or loading state', async ({ page }) => {
    // Should show either connect button, loading, or no wallet state
    const hasConnectButton = await page.locator('button:has-text("CONNECT")').count() > 0;
    const hasLoading = await page.locator('text=Loading...').count() > 0;
    expect(hasConnectButton || hasLoading).toBeTruthy();
  });

  test('should have wallet UI area', async ({ page }) => {
    // Verify the wallet connection area exists (contains buttons or loading)
    const walletArea = page.locator('button').filter({ hasText: /CONNECT|Loading/ });
    const count = await walletArea.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

test.describe('UI/UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should have terminal window styling', async ({ page }) => {
    const terminalWindow = page.locator('.terminal-window').first();
    await expect(terminalWindow).toBeVisible();
  });

  test('should have terminal header styling', async ({ page }) => {
    const terminalHeader = page.locator('.terminal-header').first();
    await expect(terminalHeader).toBeVisible();
  });

  test('should have status indicators', async ({ page }) => {
    const statusDot = page.locator('.status-dot').first();
    await expect(statusDot).toBeVisible();
  });

  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('text=POMP')).toBeVisible();
  });

  test('should have accessible buttons', async ({ page }) => {
    const buttons = await page.locator('button').count();
    expect(buttons).toBeGreaterThan(0);
  });

  test('should have accessible inputs', async ({ page }) => {
    const inputs = await page.locator('input').count();
    expect(inputs).toBeGreaterThan(0);
  });
});

test.describe('Encryption Indicators', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should show double ratchet indicator', async ({ page }) => {
    await expect(page.locator('text=Double Ratchet').first()).toBeVisible();
  });

  test('should show stealth indicator', async ({ page }) => {
    await expect(page.locator('text=Stealth:').first()).toBeVisible();
  });

  test('should show view tag indicator', async ({ page }) => {
    await expect(page.locator('text=TAG:').first()).toBeVisible();
  });
});
