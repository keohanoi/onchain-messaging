import { test, expect } from '@playwright/test';

test.describe('Full Registration Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Listen for console messages
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('useRegisterKeys') || msg.text().includes('register()')) {
        console.log(`[BROWSER ${msg.type().toUpperCase()}]`, msg.text());
      }
    });
    
    await page.goto('/');
    await page.waitForTimeout(1000);
  });

  test('page loads with correct elements', async ({ page }) => {
    await expect(page.locator('text=POMP')).toBeVisible();
    await expect(page.locator('text=HARDHAT')).toBeVisible();
    await expect(page.locator('button:has-text("CONNECT WALLET")')).toBeVisible();
  });

  test('connect wallet and register flow', async ({ page }) => {
    // Take screenshot before connecting
    await page.screenshot({ path: '/tmp/test-1-initial.png' });
    
    // Click connect wallet - try injected first
    const connectButtons = page.locator('button:has-text("CONNECT WALLET")');
    const count = await connectButtons.count();
    console.log(`Found ${count} connect buttons`);
    
    if (count > 0) {
      // Click first connect button (injected wallet)
      await connectButtons.first().click();
      await page.waitForTimeout(2000);
      
      await page.screenshot({ path: '/tmp/test-2-after-connect-click.png' });
      
      // Check if wallet connected by looking for SCAN MESSAGES or REGISTER button
      const scanButton = page.locator('button:has-text("SCAN MESSAGES")');
      const registerButton = page.locator('button:has-text("REGISTER")');
      
      const hasScanButton = await scanButton.count() > 0;
      const hasRegisterButton = await registerButton.count() > 0;
      
      console.log(`Has SCAN MESSAGES button: ${hasScanButton}`);
      console.log(`Has REGISTER button: ${hasRegisterButton}`);
      
      if (hasRegisterButton) {
        // Click REGISTER to open modal
        await registerButton.first().click();
        await page.waitForTimeout(500);
        
        await page.screenshot({ path: '/tmp/test-3-modal-open.png' });
        
        // Check modal content
        const modalTitle = page.locator('text=KEY MANAGEMENT');
        await expect(modalTitle).toBeVisible();
        
        // Check for register button in modal
        const registerKeysButton = page.locator('button:has-text("REGISTER KEYS ON-CHAIN")');
        const hasRegisterKeysButton = await registerKeysButton.count() > 0;
        console.log(`Has REGISTER KEYS ON-CHAIN button: ${hasRegisterKeysButton}`);
        
        if (hasRegisterKeysButton) {
          await page.screenshot({ path: '/tmp/test-4-before-register-click.png' });
          
          // Click register
          await registerKeysButton.click();
          await page.waitForTimeout(3000);
          
          await page.screenshot({ path: '/tmp/test-5-after-register-click.png' });
          
          // Check for any error messages
          const errorText = await page.locator('text=/error|Error|ERROR/i').count();
          console.log(`Error text count: ${errorText}`);
        }
      }
    }
    
    await page.screenshot({ path: '/tmp/test-final.png' });
  });
});
