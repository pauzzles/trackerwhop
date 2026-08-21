const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  let campaignApiData = null;
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('campaign') || url.includes('discover') || url.includes('api')) {
      try {
        const text = await res.text();
        if (text.includes('ROOBET') || text.includes('MUTUUM') || text.includes('approval')) {
          console.log('Found API Response URL:', url);
          fs.writeFileSync('api_response_sample.json', text.slice(0, 50000));
        }
      } catch (e) {}
    }
  });

  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(4000);

  // Inspect window data or script tags
  const data = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerText);
    const withData = scripts.filter(s => s.includes('ROOBET') || s.includes('MUTUUM') || s.includes('cpm'));
    return {
      withDataCount: withData.length,
      sampleScript: withData[0] ? withData[0].slice(0, 5000) : null
    };
  });

  console.log('Script inspection:', data.withDataCount);
  if (data.sampleScript) {
    fs.writeFileSync('script_sample.txt', data.sampleScript);
  }

  await browser.close();
})();
