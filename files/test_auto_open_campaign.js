const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false }); // or headless: true
  const page = await browser.newPage();
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(2000);

  // Let's test searching for a campaign and clicking it automatically
  const targetTitle = "MUTUUM";
  console.log(`Searching for "${targetTitle}" in Content Rewards search bar...`);

  const searchInput = page.locator('input[placeholder*="Campaigns"], input[type="text"]').first();
  await searchInput.fill(targetTitle);
  await page.waitForTimeout(1500);

  // Check what cards are visible
  const card = page.locator(`text="${targetTitle}"`).first();
  if (await card.isVisible()) {
    console.log(`Found card for "${targetTitle}", clicking it...`);
    await card.click();
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    console.log("Current URL after modal opens:", currentUrl);
    await page.screenshot({ path: 'modal_opened_after_click.png' });
  }

  await browser.close();
})();
