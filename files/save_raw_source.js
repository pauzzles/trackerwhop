const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  const rawHtml = await page.content();
  await browser.close();

  fs.writeFileSync(path.join(__dirname, 'raw_discover_source.html'), rawHtml, 'utf8');
  console.log(`Saved raw HTML (${rawHtml.length} bytes) to raw_discover_source.html!`);
})();
