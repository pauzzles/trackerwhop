const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  const fileUrl = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(fileUrl, { waitUntil: 'load' });
  await page.waitForTimeout(1000);

  // Scroll down to cards grid
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(500);

  const screenshotPath = path.join(__dirname, 'cards_grid_verified.png');
  await page.screenshot({ path: screenshotPath });
  console.log('Cards grid screenshot saved to:', screenshotPath);

  await browser.close();
})();
