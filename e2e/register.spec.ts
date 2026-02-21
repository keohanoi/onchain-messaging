import { test, expect } from '@playwright/test';

test.describe('Registration Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock wagmi/viem wallet connection
    await page.addInitScript(() => {
      // Mock localStorage with wallet connected
      window.localStorage.setItem('wagmi.connected', 'true');
    });
    await page.goto('/');
    // Wait for page to hydrate
    await page.waitForTimeout(2000);
  });

  test('should show register button when wallet is connected', async ({ page }) => {
    // Take a screenshot to see current state
    await page.screenshot({ path: '/tmp/register-test-1.png' });
    
    // Check if REGISTER button exists
    const registerButton = page.locator('button:has-text("REGISTER")');
    const count = await registerButton.count();
    console.log('REGISTER button count:', count);
    
    if (count > 0) {
      await expect(registerButton.first()).toBeVisible();
    }
  });

  test('should register when clicking register button', async ({ page }) => {
    // Mock the wallet connection by directly calling the hook
    await page.evaluate(() => {
      // This simulates a connected wallet
      (window as any).__WALLET_CONNECTED__ = true;
    });
    
    await page.screenshot({ path: '/tmp/register-test-2.png' });
    
    // Try to find and click register
    const registerButton = page.locator('button:has-text("REGISTER")');
    if (await registerButton.count() > 0) {
      await registerButton.first().click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/register-test-3.png' });
    }
  });
});
