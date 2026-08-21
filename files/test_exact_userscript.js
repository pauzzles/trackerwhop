const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log("Navigating to contentrewards.com/discover...");
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(2000);

  const query = "CapCut";

  // Execute the exact userscript injection logic inside the browser
  const result = await page.evaluate(async (searchTerm) => {
    const input = document.querySelector('input[placeholder*="Campaigns" i], input[type="text"]');
    if (!input) return { error: "No input found" };

    input.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, searchTerm);

    if (input._valueTracker) {
      input._valueTracker.setValue('');
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for cards to update
    await new Promise(r => setTimeout(r, 800));

    // Find cards matching the term
    const allDivs = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, div, span'));
    const matched = allDivs.find(el => el.textContent && el.textContent.toLowerCase().includes(searchTerm.toLowerCase()));

    if (matched) {
      const card = matched.closest('div[class*="cursor-pointer"], a, div') || matched;
      card.click();
      return { success: true, matchedText: matched.textContent.slice(0, 50) };
    }
    return { error: "Card not found after filtering" };
  }, query);

  console.log("Evaluation Result:", result);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'auto_click_playwright_test.png' });

  await browser.close();
})();
