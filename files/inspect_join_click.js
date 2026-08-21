const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  const btns = await page.locator('button:has-text("Join Campaign")').all();
  console.log(`Found ${btns.length} Join Campaign buttons.`);

  if (btns.length > 0) {
    const beforeUrl = page.url();
    await btns[0].click();
    await page.waitForTimeout(3000);
    const afterUrl = page.url();
    console.log('Before click URL:', beforeUrl);
    console.log('After click URL:', afterUrl);

    const inspection = await page.evaluate(() => {
      const allText = document.body.innerText;
      const dialog = document.querySelector('[role="dialog"], .modal, [class*="modal"], [class*="dialog"], [class*="drawer"]');
      const dialogText = dialog ? dialog.innerText : null;
      return {
        url: window.location.href,
        hasDialog: !!dialog,
        dialogSnippet: dialogText ? dialogText.slice(0, 500) : null
      };
    });
    console.log('Inspection result:', JSON.stringify(inspection, null, 2));
  }
  await browser.close();
})();
