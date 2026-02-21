import { test, expect } from '@playwright/test';

test('debug registration flow', async ({ page }) => {
  // Capture console messages
  page.on('console', msg => {
    console.log('BROWSER:', msg.type(), msg.text());
  });
  
  // Capture page errors
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  await page.goto('http://localhost:3002');
  await page.waitForTimeout(2000);
  
  // Take initial screenshot
  await page.screenshot({ path: '/tmp/debug-1-initial.png' });
  
  // Get page content
  const content = await page.content();
  console.log('Page has CONNECT WALLET:', content.includes('CONNECT WALLET'));
  console.log('Page has REGISTER:', content.includes('REGISTER'));
  console.log('Page has SCAN MESSAGES:', content.includes('SCAN MESSAGES'));
  
  // Click Connect Wallet button
  const connectButtons = page.locator('button:has-text("CONNECT WALLET")');
  const count = await connectButtons.count();
  console.log('Connect buttons found:', count);
  
  if (count > 0) {
    // Click the first connect button (injected wallet)
    await connectButtons.first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/debug-2-after-connect.png' });
    
    // Check if wallet connected
    console.log('Page has REGISTER after connect:', (await page.content()).includes('REGISTER'));
    console.log('Page has SCAN MESSAGES after connect:', (await page.content()).includes('SCAN MESSAGES'));
  }
});
