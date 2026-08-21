const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  const fileUrl = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
  console.log('Visiting:', fileUrl);
  await page.goto(fileUrl, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const screenshotPath = path.join(__dirname, 'polished_ui_verified.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log('Screenshot saved to:', screenshotPath);

  await browser.close();
})();
