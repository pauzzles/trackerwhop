const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => {
    const rawHtml = document.documentElement.innerHTML;
    // Find all UUID patterns like 694c6333-7e7a-4ce3-b21d-42372c440721
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const allMatches = Array.from(new Set(rawHtml.match(uuidRegex) || []));

    // Check Next.js state or React internal props
    const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerText);
    const stateScripts = scripts.filter(s => s.includes('campaign') || s.includes('discover'));

    // Check DOM elements
    const elementsWithHref = Array.from(document.querySelectorAll('*'))
      .filter(el => {
        const href = el.getAttribute('href') || '';
        const onclick = el.getAttribute('onclick') || '';
        return href.includes('discover/') || onclick.includes('discover/');
      })
      .map(el => ({
        tag: el.tagName,
        href: el.getAttribute('href'),
        text: el.innerText ? el.innerText.slice(0, 40) : ''
      }));

    return {
      uuidCount: allMatches.length,
      sampleUuids: allMatches.slice(0, 15),
      elementsWithHref: elementsWithHref.slice(0, 10),
      scriptCount: scripts.length
    };
  });

  console.log('UUID Extraction Results:', JSON.stringify(result, null, 2));

  // Let's also click on a card to observe how the URL changes in Playwright!
  const cards = await page.locator('div:has-text("Join Campaign")').all();
  console.log('Found card containers:', cards.length);

  await browser.close();
})();
